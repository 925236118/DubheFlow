// 静态校验器 —— 对齐设计文档《天枢-数据流与变量设计》§9 + 《天枢-工作流引擎设计》§7.2
// AI 生成的 spec 跑之前必须过数据流校验,这些不用调模型
// 校验不过 → 打回让 Planner 重生成

import type { WorkflowSpec, SpecNode } from './types'
import { BUILTIN_PRIMITIVES } from './primitives'
import { BUILTIN_GLOBAL_KEYS } from './dataflow'

export interface ValidationError {
  severity: 'error' | 'warning'
  nodeId?: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

/** 校验一条 spec */
export function validateSpec(spec: WorkflowSpec): ValidationResult {
  const errors: ValidationError[] = []

  // 1. 节点类型必须在注册表中
  for (const node of spec.nodes) {
    if (!(node.type in BUILTIN_PRIMITIVES)) {
      // 可能是服务贡献节点(运行时从 manifest 注册),此处只告警
      errors.push({
        severity: 'error',
        nodeId: node.id,
        message: `未注册的节点类型: ${node.type}`
      })
    }
  }

  // 2. 边引用的节点必须存在
  const nodeIds = new Set(spec.nodes.map((n) => n.id))
  for (const [from, to] of spec.edges) {
    if (!nodeIds.has(from)) {
      errors.push({ severity: 'error', message: `边引用了不存在的节点: ${from}` })
    }
    if (!nodeIds.has(to)) {
      errors.push({ severity: 'error', message: `边引用了不存在的节点: ${to}` })
    }
  }

  // 3. 预算必须含 max_cost(设计 §8.5:v1.0 缺失,必补)
  if (!spec.budget) {
    errors.push({ severity: 'error', message: '缺少 budget 预算声明' })
  } else {
    if (spec.budget.max_cost === undefined || spec.budget.max_cost === null) {
      errors.push({ severity: 'error', message: 'budget 缺少 max_cost(成本上限)' })
    }
    if (spec.budget.max_model_calls === undefined) {
      errors.push({ severity: 'error', message: 'budget 缺少 max_model_calls' })
    }
  }

  // 4. 必填参数检查
  for (const node of spec.nodes) {
    const prim = BUILTIN_PRIMITIVES[node.type]
    if (!prim) continue
    for (const [argName, argDef] of Object.entries(prim.args)) {
      if (argDef.required && !(argName in (node.args ?? {}))) {
        errors.push({
          severity: 'error',
          nodeId: node.id,
          message: `节点 ${node.id}(${node.type}) 缺少必填参数: ${argName}`
        })
      }
    }
  }

  // 5. 环检测:有环但没有 loop 上限 → 死循环
  const cycle = detectCycle(spec)
  if (cycle) {
    const hasLoop = cycle.some((id) => {
      const n = spec.nodes.find((x) => x.id === id)
      return n?.type === 'loop' && n.args?.max_iterations != null
    })
    if (!hasLoop) {
      errors.push({
        severity: 'error',
        message: `检测到环但无 loop 上限(死循环): ${cycle.join(' → ')}`
      })
    }
  }

  // 6. 不可达节点(从入度为 0 的节点出发遍历不到)
  const unreachable = findUnreachable(spec)
  for (const id of unreachable) {
    errors.push({ severity: 'warning', nodeId: id, message: `节点 ${id} 不可达` })
  }

  // 7. 必须有终点节点(出度为 0)
  const hasTerminal = spec.nodes.some((n) => !spec.edges.some(([, to]) => to === n.id))
  // 但 verify/assemble 等可以是终点;至少要有一个
  const hasStart = spec.nodes.some((n) => !spec.edges.some(([from]) => from === n.id))
  if (!hasTerminal) {
    errors.push({ severity: 'warning', message: '没有终点节点(所有节点都有出边,可能死循环)' })
  }
  if (!hasStart) {
    errors.push({ severity: 'error', message: '没有起点节点(所有节点都有入边)' })
  }

  // 8. 审批门禁被绕过:apply_change 后直接接 run_test,中间没有 approve
  const bypassed = checkApprovalBypass(spec)
  for (const msg of bypassed) {
    errors.push({ severity: 'warning', message: msg })
  }

  // 9. 引用检查:{{ }} 和 $ref 引用的对象是否存在
  const inputKeys = new Set([
    ...Object.keys(spec.inputs ?? {}),
    ...(spec.input_schema?.required ?? []),
    ...(spec.input_schema?.optional ?? [])
  ])
  for (const node of spec.nodes) {
    const refErrors = checkReferences(node, nodeIds, inputKeys)
    errors.push(...refErrors)
  }

  return {
    ok: !errors.some((e) => e.severity === 'error'),
    errors
  }
}

// ===== 环检测(Kahn 算法拓扑排序)=====
function detectCycle(spec: WorkflowSpec): string[] | null {
  const inDegree = new Map<string, number>()
  for (const n of spec.nodes) inDegree.set(n.id, 0)
  for (const [, to] of spec.edges) {
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const visited = new Set<string>(queue)
  while (queue.length) {
    const id = queue.shift()!
    for (const [from, to] of spec.edges) {
      if (from === id && !visited.has(to)) {
        inDegree.set(to, (inDegree.get(to) ?? 0) - 1)
        if ((inDegree.get(to) ?? 0) <= 0) {
          visited.add(to)
          queue.push(to)
        }
      }
    }
  }
  // 未访问的节点在环中
  const cycleNodes = spec.nodes.filter((n) => !visited.has(n.id)).map((n) => n.id)
  return cycleNodes.length > 0 ? cycleNodes : null
}

// ===== 不可达节点 =====
function findUnreachable(spec: WorkflowSpec): string[] {
  // 起点:入度为 0 的节点
  const starts = spec.nodes
    .filter((n) => !spec.edges.some(([, to]) => to === n.id))
    .map((n) => n.id)
  if (starts.length === 0) return []

  const visited = new Set<string>(starts)
  const queue = [...starts]
  while (queue.length) {
    const id = queue.shift()!
    for (const [from, to] of spec.edges) {
      if (from === id && !visited.has(to)) {
        visited.add(to)
        queue.push(to)
      }
    }
  }
  return spec.nodes.filter((n) => !visited.has(n.id)).map((n) => n.id)
}

// ===== 审批门禁绕过检查 =====
function checkApprovalBypass(spec: WorkflowSpec): string[] {
  const warnings: string[] = []
  for (const [from, to] of spec.edges) {
    const fromNode = spec.nodes.find((n) => n.id === from)
    const toNode = spec.nodes.find((n) => n.id === to)
    if (fromNode?.type === 'apply_change' && toNode?.type === 'run_test') {
      // 检查中间是否有 approve
      const hasApprove = spec.edges.some(
        ([f, t]) =>
          f === from &&
          spec.nodes.find((n) => n.id === t)?.type === 'approve'
      )
      if (!hasApprove) {
        warnings.push(
          `审批门禁可能被绕过:${from}(apply_change) → ${to}(run_test),中间无 approve 节点`
        )
      }
    }
  }
  return warnings
}

// ===== 引用检查 =====
const REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g

function checkReferences(
  node: SpecNode,
  nodeIds: Set<string>,
  inputKeys: Set<string>
): ValidationError[] {
  const errors: ValidationError[] = []
  const refs = new Set<string>()

  // 收集所有 {{ }} 引用
  const collect = (obj: unknown) => {
    if (typeof obj === 'string') {
      let m: RegExpExecArray | null
      REF_RE.lastIndex = 0
      while ((m = REF_RE.exec(obj)) !== null) {
        refs.add(m[1].trim())
      }
    } else if (obj && typeof obj === 'object') {
      if ('$ref' in obj && typeof (obj as { $ref: string }).$ref === 'string') {
        refs.add((obj as { $ref: string }).$ref)
      }
      for (const v of Object.values(obj)) collect(v)
    }
  }
  collect(node.args)

  // 检查每个引用
  for (const ref of refs) {
    const parts = ref.split('.')
    if (parts.length === 1 && /^[A-Z][A-Z_]*$/.test(parts[0])) {
      // 全局变量
      if (!BUILTIN_GLOBAL_KEYS.includes(parts[0] as never)) {
        errors.push({
          severity: 'error',
          nodeId: node.id,
          message: `未定义的全局变量: {{ ${ref} }}`
        })
      }
    } else if (parts[0] === 'input') {
      // input.x
      if (parts.length < 2) {
        errors.push({ severity: 'error', nodeId: node.id, message: `引用缺少字段: {{ ${ref} }}` })
      } else if (!inputKeys.has(parts[1])) {
        errors.push({
          severity: 'error',
          nodeId: node.id,
          message: `未定义的输入: {{ ${ref} }}`
        })
      }
    } else if (parts.length >= 2 && parts[1] === 'output') {
      // nodeId.output.field
      if (!nodeIds.has(parts[0])) {
        errors.push({
          severity: 'error',
          nodeId: node.id,
          message: `引用了不存在的节点: {{ ${ref} }}`
        })
      }
    } else {
      errors.push({
        severity: 'warning',
        nodeId: node.id,
        message: `无法识别的引用格式: {{ ${ref} }}`
      })
    }
  }

  return errors
}
