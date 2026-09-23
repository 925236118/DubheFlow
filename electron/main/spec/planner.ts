// Planner —— 工作流生成(规划层)
// 对齐设计 §7:Planner 接任务 → 产出 spec
// 核心纪律:Planner 只能组合注册表内的原语,不能发明新节点
// 系统提示由注册表自动生成(每个原语的 schema + 描述 + 可用 capability + 全局变量)
import type { WorkflowSpec } from './types'
import { listPrimitives, type PrimitiveDef } from './primitives'
import { BUILTIN_GLOBAL_KEYS } from './dataflow'
import { validateSpec, type ValidationResult } from './validator'
import type { Capability, ChatMessage, InvokeRequest } from '../providers/types'

// ===== 从注册表自动生成 Planner 系统提示 =====
export function buildPlannerPrompt(
  primitives: PrimitiveDef[],
  capabilities: Capability[],
  globals: readonly string[]
): string {
  // 原语清单
  const primList = primitives
    .map((p) => {
      const args = Object.entries(p.args)
        .map(([k, v]) => `${k}(${v.type}${v.required ? ',必填' : ''}${v.default !== undefined ? `,默认${JSON.stringify(v.default)}` : ''})`)
        .join(', ')
      const outputs = p.outputs
        ? Object.entries(p.outputs)
            .map(([k, v]) => `${k}:${v.type}`)
            .join(', ')
        : '无'
      return `- ${p.type} [${p.category}]: ${p.description}\n  args: ${args}\n  outputs: ${outputs}`
    })
    .join('\n')

  // 能力清单
  const capList = capabilities.join(' / ')

  // 全局变量
  const globalList = globals.join(', ')

  return `你是天枢工作站的流程规划器(Planner)。根据用户任务描述,生成一条工作流 spec(JSON)。

# 可用原语(只能用这些,不能发明新节点)
${primList}

# 可用能力(capability,spec 里写这个,不写模型名)
${capList}

# 内置全局变量(只读,{{ ALL_CAPS }} 引用)
${globalList}

# 数据流语法
- {{ input.x }} 引用运行输入
- {{ n3.output.text }} 引用节点 n3 的产出
- {{ SCRIPT_DIR }} 引用全局变量
- { "$ref": "n3.output" } 整体引用(保留类型,不做字符串化)
- 路径类变量(SCRIPT_DIR/ART_DIR/AUDIO_DIR)让并行分支天然各写各的目录

# 规则
1. 节点 id 用 n1, n2, n3... 线性编号
2. edges 用 ["from","to"] 元组
3. budget 必须含 max_cost(成本上限 USD)
4. llm_generate 节点写 capability,不写模型名
5. verify 节点声明 on_fail 和(如需回溯)rollback_targets
6. 有 fanout 就要有 join,join 声明失败策略
7. 尽量简洁,3-6 个节点为宜

# 输出格式
输出一条合法的 JSON(不要 markdown 代码块,直接输出 JSON):
{
  "id": "wf_xxx",
  "version": 1,
  "goal": "目标描述",
  "inputs": { "theme": { "type": "string", "required": true } },
  "nodes": [ { "id": "n1", "type": "...", "args": { ... } } ],
  "edges": [ ["n1","n2"] ],
  "budget": { "max_model_calls": 10, "max_seconds": 600, "max_cost": 1.0 }
}`
}

// ===== 生成 spec =====
export interface PlannerResult {
  spec: WorkflowSpec | null
  validation: ValidationResult
  rawResponse: string
}

/**
 * 调用模型生成 spec → 解析 JSON → 静态校验
 * 校验不过时可带 errors 反馈重试
 */
export async function generateSpec(
  task: string,
  invokeProvider: (req: InvokeRequest) => Promise<AsyncIterable<{ delta?: string }>>,
  capabilities: Capability[],
  maxRetries = 2
): Promise<PlannerResult> {
  const primitives = listPrimitives()
  const systemPrompt = buildPlannerPrompt(primitives, capabilities, BUILTIN_GLOBAL_KEYS)

  let lastRaw = ''
  let lastResult: PlannerResult | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ]

    // 如果是重试,附上上次校验错误让模型修正
    if (lastResult?.validation.errors.length) {
      const feedback = lastResult.validation.errors
        .map((e) => `- [${e.severity}] ${e.message}`)
        .join('\n')
      messages.push({
        role: 'assistant',
        content: lastRaw
      })
      messages.push({
        role: 'user',
        content: `上次生成的 spec 校验失败,请修正以下问题后重新输出完整 JSON:\n${feedback}`
      })
    }

    // 调用模型,收集完整响应
    const req: InvokeRequest = {
      capability: 'reasoning',
      messages,
      temperature: 0,
      maxTokens: 8192,
      json: true,
      stream: true
    }

    const stream = await invokeProvider(req)
    let raw = ''
    for await (const chunk of stream) {
      if (chunk.delta) raw += chunk.delta
    }
    lastRaw = raw

    // 解析 JSON(容错:提取代码块中的 JSON)
    const spec = tryParseSpec(raw)
    if (!spec) {
      lastResult = {
        spec: null,
        validation: {
          ok: false,
          errors: [
            {
              severity: 'error',
              message: `模型输出无法解析为 JSON(第 ${attempt + 1} 次)`
            }
          ]
        },
        rawResponse: raw
      }
      continue
    }

    // 静态校验
    const validation = validateSpec(spec)
    lastResult = { spec, validation, rawResponse: raw }

    if (validation.ok) {
      return lastResult
    }
    // 校验不过 → 带错误重试
  }

  return lastResult ?? {
    spec: null,
    validation: { ok: false, errors: [{ severity: 'error', message: '生成失败' }] },
    rawResponse: lastRaw
  }
}

// ===== JSON 解析(容错)=====
function tryParseSpec(raw: string): WorkflowSpec | null {
  // 去掉 markdown 代码块
  let json = raw.trim()
  if (json.startsWith('```')) {
    const lines = json.split('\n')
    // 去首行(```json)和末行(```)
    lines.shift()
    if (lines[lines.length - 1].trim() === '```') lines.pop()
    json = lines.join('\n')
  }

  // 尝试直接解析
  try {
    return JSON.parse(json) as WorkflowSpec
  } catch {
    // 尝试提取第一个 {...} 块
    const start = json.indexOf('{')
    const end = json.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(json.slice(start, end + 1)) as WorkflowSpec
      } catch {
        return null
      }
    }
    return null
  }
}
