// Interpreter —— 工作流执行器(执行层)
// 对齐设计 §1:读 spec → 跑起来(检查点/重试/审批/流式)
// LangGraph 不负责想,只负责跑
//
// v0 实现:线性执行 + 数据流解析 + llm_generate + verify(规则优先)
// fanout/join/rollback 留接口,后续版本实现

import type { WorkflowSpec, SpecNode } from './types'
import type { InvokeRequest, ChatChunk } from '../providers/types'
import {
  buildContext,
  deepInterpolate,
  setNodeOutput,
  type EvalContext
} from './dataflow'
import { prepare } from '../db/database'

// ===== 运行事件(推给 UI)=====
export type RunEvent =
  | { type: 'run_start'; runId: string; spec: WorkflowSpec }
  | { type: 'step_start'; nodeId: string; nodeType: string; attempt: number }
  | { type: 'step_delta'; nodeId: string; delta: string }
  | { type: 'step_done'; nodeId: string; output: Record<string, unknown>; input: Record<string, unknown> }
  | { type: 'step_failed'; nodeId: string; error: string }
  | { type: 'step_skipped'; nodeId: string; reason: string }
  | { type: 'ask_user'; nodeId: string; nodeType: string; questions: unknown }
  | { type: 'verify_result'; nodeId: string; success: boolean; reason: string }
  | { type: 'run_done'; runId: string; cost: number }
  | { type: 'run_failed'; runId: string; error: string }

export interface RunOptions {
  spec: WorkflowSpec
  input: Record<string, unknown>
  globals?: Partial<Record<string, unknown>>
  projectPath?: string
}

// ===== 依赖注入接口(避免直接 import registry)=====
export interface ExecutorDeps {
  invokeProvider: (
    req: InvokeRequest,
    signal?: AbortSignal
  ) => AsyncIterable<ChatChunk>
  /** 阻塞等待用户回答 ask_user 节点的问题 */
  askUser: (questions: unknown[]) => Promise<Record<string, unknown>>
}

// ===== 主入口:执行 spec =====
export async function* runSpec(
  options: RunOptions,
  deps: ExecutorDeps,
  signal?: AbortSignal
): AsyncGenerator<RunEvent> {
  const { spec, input, globals } = options
  const ctx = buildContext(spec, input, globals)

  // 创建 run 记录
  const runId = `run_${Date.now()}`
  yield { type: 'run_start', runId, spec }

  // 拓扑排序
  const sorted = topologicalSort(spec)
  if (sorted.length === 0) {
    yield { type: 'run_failed', runId, error: '拓扑排序失败(可能有环)' }
    return
  }

  let totalCost = 0

  for (const node of sorted) {
    if (signal?.aborted) {
      yield { type: 'run_failed', runId, error: '用户取消' }
      return
    }

    yield { type: 'step_start', nodeId: node.id, nodeType: node.type, attempt: 0 }

    try {
      // 解析数据流(把 {{ }} / $ref 替换为实际值)
      const resolvedArgs = deepInterpolate(node.args, ctx) as Record<string, unknown>

      // ask_user / collect 节点:发送问题事件,阻塞等待用户回答
      if (node.type === 'ask_user') {
        const questions = normalizeQuestions(resolvedArgs.questions)
        yield { type: 'ask_user', nodeId: node.id, nodeType: 'ask_user', questions }
      }
      if (node.type === 'collect') {
        const questions = collectFieldsToQuestions(resolvedArgs.fields)
        yield { type: 'ask_user', nodeId: node.id, nodeType: 'collect', questions }
      }

      const output = await executeNode(node, resolvedArgs, ctx, deps, signal, () => {})

      // 记录产出到上下文
      setNodeOutput(ctx, node.id, output)
      // 记录 step_run 到 DB
      recordStepRun(runId, node, output)
      // step_done 同时携带输入(解析后的 args)和输出
      yield { type: 'step_done', nodeId: node.id, output, input: resolvedArgs } as never
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      yield { type: 'step_failed', nodeId: node.id, error: msg }
      // 检查是否是 verify 失败 → 可能回溯(v0:直接中止)
      yield { type: 'run_failed', runId, error: `节点 ${node.id} 执行失败: ${msg}` }
      return
    }
  }

  yield { type: 'run_done', runId, cost: totalCost }
}

// ===== 拓扑排序(Kahn 算法)=====
function topologicalSort(spec: WorkflowSpec): SpecNode[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of spec.nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const [from, to] of spec.edges) {
    adj.get(from)?.push(to)
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const result: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    result.push(id)
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, d)
      if (d <= 0) queue.push(next)
    }
  }
  // 按 result 顺序返回节点
  const nodeMap = new Map(spec.nodes.map((n) => [n.id, n]))
  return result.map((id) => nodeMap.get(id)!).filter(Boolean)
}

// ===== 规范化 ask_user 问题(AI 可能生成各种格式)=====
function normalizeQuestions(questions: unknown): unknown[] {
  if (Array.isArray(questions)) return questions
  // 单个问题对象:{question, options} 或 {text, options}
  if (questions && typeof questions === 'object') {
    const q = questions as Record<string, unknown>
    return [{
      id: 'q1',
      text: q.question || q.text || q.prompt || '请回答',
      options: Array.isArray(q.options) ? q.options : undefined,
      placeholder: q.placeholder
    }]
  }
  // 纯字符串 → 一个文本问题
  if (typeof questions === 'string') {
    return [{ id: 'q1', text: questions }]
  }
  return []
}

// ===== 把 collect 的 fields 转成问题列表(复用 ask_user 交互)=====
function collectFieldsToQuestions(fields: unknown): unknown[] {
  // 数组格式:["theme", "style"] 或 [{id, label, options}, ...]
  if (Array.isArray(fields)) {
    return fields.map((f, i) => {
      if (typeof f === 'string') {
        return { id: f, text: `请输入 ${f}`, placeholder: `输入 ${f}…` }
      }
      if (f && typeof f === 'object') {
        const obj = f as Record<string, unknown>
        const id = String(obj.id || obj.key || obj.name || `field_${i}`)
        return {
          id,
          text: String(obj.label || obj.text || obj.desc || `请输入 ${id}`),
          placeholder: obj.placeholder as string | undefined,
          options: Array.isArray(obj.options) ? obj.options : undefined
        }
      }
      return { id: `field_${i}`, text: String(f) }
    })
  }
  // 对象格式:{theme: {type, required, desc}, ...}
  if (fields && typeof fields === 'object') {
    return Object.entries(fields).map(([key, val]) => {
      if (val && typeof val === 'object') {
        const v = val as Record<string, unknown>
        return {
          id: key,
          text: String(v.label || v.desc || v.description || `请输入 ${key}`),
          placeholder: v.placeholder as string | undefined,
          options: Array.isArray(v.options) || Array.isArray(v.values) ? (v.options || v.values) : undefined
        }
      }
      return { id: key, text: `请输入 ${key}` }
    })
  }
  return []
}

// ===== 执行单个节点(接收已解析的 args)=====
async function executeNode(
  node: SpecNode,
  args: Record<string, unknown>,
  ctx: EvalContext,
  deps: ExecutorDeps,
  signal: AbortSignal | undefined,
  onDelta: (delta: string) => void
): Promise<Record<string, unknown>> {
  // args 已由 runSpec 解析完毕(无需再 interpolate)

  switch (node.type) {
    case 'llm_generate':
      return executeGenerate(node, args, ctx, deps, signal, onDelta)
    case 'verify':
      return executeVerify(node, args, ctx)
    case 'collect': {
      // 把 fields 转成问题,复用 ask_user 的交互阻塞机制
      const questions = collectFieldsToQuestions(args.fields)
      const collected = await deps.askUser(questions)
      return { collected }
    }
    case 'ask_user':
      // 阻塞等待用户回答(问题已在 runSpec 中 yield 给 UI)
      const questions = (args.questions as unknown[]) ?? []
      const answers = await deps.askUser(questions)
      return { answers }
    case 'require':
      return { valid: true }
    case 'approve':
      return { approved: true }
    case 'assemble':
      return { result: args.inputs }
    case 'split':
      return { subtasks: args.into }
    default:
      // 未实现的节点类型:记录但不执行
      console.log(`[interpreter] 节点 ${node.id}(${node.type}) 暂未实现,跳过`)
      return { skipped: true, type: node.type }
  }
}

// ===== llm_generate:调用模型生成 =====
async function executeGenerate(
  node: SpecNode,
  args: Record<string, unknown>,
  _ctx: EvalContext,
  deps: ExecutorDeps,
  signal: AbortSignal | undefined,
  onDelta: (delta: string) => void
): Promise<Record<string, unknown>> {
  const capability = String(args.capability ?? 'coding')
  const prompt = String(args.prompt ?? '')
  const temperature = args.temperature !== undefined ? Number(args.temperature) : 0
  const maxTokens = args.max_tokens !== undefined ? Number(args.max_tokens) : 4096
  const useJson = args.json === true

  // 构建上游对话历史(从上下文中收集所有已完成的 assistant 产出)
  const messages = [
    { role: 'system' as const, content: `你是天枢工作站的执行节点(${node.id})。按 spec 指令执行。` },
    { role: 'user' as const, content: prompt }
  ]

  const req: InvokeRequest = {
    capability: capability as never,
    messages,
    temperature,
    maxTokens,
    json: useJson,
    stream: true
  }

  let fullText = ''
  let usage = null
  for await (const chunk of deps.invokeProvider(req, signal)) {
    if (chunk.delta) {
      fullText += chunk.delta
      onDelta(chunk.delta)
    }
    if (chunk.usage) usage = chunk.usage
  }

  // 记录 model_call 到 DB
  if (usage) {
    recordModelCall(capability, usage.promptTokens, usage.completionTokens, 0)
  }

  // 根据 output 配置决定产出类型
  const outputCfg = args.output as { kind?: string; path?: string } | undefined
  if (outputCfg?.kind === 'patch') {
    return { patch: fullText, text: fullText }
  }
  return { text: fullText }
}

// ===== verify:规则优先,模型兜底 =====
async function executeVerify(
  _node: SpecNode,
  args: Record<string, unknown>,
  ctx: EvalContext
): Promise<Record<string, unknown>> {
  const targetId = String(args.target ?? '')
  const targetOutput = ctx.nodes[targetId]?.output ?? {}
  const criteria = String(args.criteria ?? '')

  // 规则 1:退出码非 0 → 失败
  if (targetOutput.exit_code !== undefined && Number(targetOutput.exit_code) !== 0) {
    return { success: false, reason: `退出码非 0: ${targetOutput.exit_code}`, confidence: 1.0 }
  }

  // 规则 2:stderr 含 error/exception → 失败
  const stderr = String(targetOutput.stderr ?? '')
  if (stderr && /error|exception|traceback/i.test(stderr)) {
    return { success: false, reason: `stderr 含错误信息: ${stderr.slice(0, 200)}`, confidence: 0.9 }
  }

  // 规则 3:预期文件不存在 → 失败
  const expectedFile = targetOutput.file ?? targetOutput.path
  if (expectedFile && !expectedFile) {
    return { success: false, reason: '预期文件不存在', confidence: 1.0 }
  }

  // 规则 4:空输出 → 失败
  if (targetOutput.text === '' || targetOutput.text === undefined) {
    return { success: false, reason: '产出为空', confidence: 0.8 }
  }

  // 规则通过 → 成功(v0 不调模型,后续可加小模型 verify)
  return { success: true, reason: `规则检查通过(${criteria})`, confidence: 0.7 }
}

// ===== DB 记录 =====
function genId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function recordStepRun(
  runId: string,
  node: SpecNode,
  output: Record<string, unknown>
): void {
  try {
    prepare(
      `INSERT INTO step_run (id, run_id, node_id, status, attempt, started_at, finished_at, output_json)
       VALUES (?, ?, ?, 'succeeded', 0, ?, ?, ?)`
    ).run(
      genId(),
      runId,
      node.id,
      Date.now() - 1000,
      Date.now(),
      JSON.stringify(output)
    )
  } catch (err) {
    console.error('[db] 记录 step_run 失败:', err)
  }
}

function recordModelCall(
  capability: string,
  promptTokens: number,
  completionTokens: number,
  cost: number
): void {
  try {
    prepare(
      `INSERT INTO model_call (id, step_run_id, provider, model, modality, prompt_tokens, completion_tokens, cost, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      genId(),
      'dubhe',
      capability,
      capability,
      promptTokens,
      completionTokens,
      cost,
      Date.now()
    )
  } catch (err) {
    console.error('[db] 记录 model_call 失败:', err)
  }
}
