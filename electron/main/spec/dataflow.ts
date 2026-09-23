// 数据流引擎 —— 对齐设计文档《天枢-数据流与变量设计》
// 解决「spec 只有控制流,没有数据流」的问题
// 实现:{{ }} 文本插值、$ref 整体引用、三类命名空间、input_hash

import { createHash } from 'node:crypto'
import type { SpecNode, WorkflowSpec } from './types'

// ===== 评估上下文 =====
export interface EvalContext {
  /** 内置全局变量(只读,ALL_CAPS) */
  globals: Record<string, unknown>
  /** 运行输入(用户填的槽位) */
  input: Record<string, unknown>
  /** 节点产出 nodes.<id>.output.<field> */
  nodes: Record<string, { output: Record<string, unknown> }>
}

// ===== 内置全局变量表(§4)=====
export const BUILTIN_GLOBAL_KEYS = [
  'PROJECT_PATH', 'PROJECT_NAME', 'GODOT_VERSION', 'EDITOR_ONLINE', 'OS',
  'RUN_ID', 'RUN_ATTEMPT', 'ITERATION', 'LAST_ERROR',
  'TIME', 'DATE', 'WORKFLOW_NAME',
  'ART_DIR', 'AUDIO_DIR', 'SCRIPT_DIR', 'TEST_DIR', 'RUN_DIR'
] as const

export type GlobalKey = (typeof BUILTIN_GLOBAL_KEYS)[number]

/** 默认全局变量(运行时由项目上下文覆盖) */
export function defaultGlobals(): Record<string, unknown> {
  return {
    PROJECT_PATH: '',
    PROJECT_NAME: '',
    GODOT_VERSION: '',
    EDITOR_ONLINE: false,
    OS: process.platform,
    RUN_ID: '',
    RUN_ATTEMPT: 1,
    ITERATION: 1,
    LAST_ERROR: '',
    TIME: new Date().toISOString(),
    DATE: new Date().toISOString().slice(0, 10),
    WORKFLOW_NAME: '',
    ART_DIR: 'assets/art/',
    AUDIO_DIR: 'assets/audio/',
    SCRIPT_DIR: 'scripts/',
    TEST_DIR: 'tests/',
    RUN_DIR: ''
  }
}

// ===== 路径解析 =====
/**
 * 解析引用路径,返回上下文中的值
 * 路径语法:<namespace>.<name>[.<field>][.<index>]
 *   {{ ALL_CAPS }}              → 全局变量(只读)
 *   {{ input.theme }}           → 运行输入
 *   {{ n3.output.text }}        → 节点产出
 *   {{ n9.output.branches.art }}→ join 后的分支产出
 */
export function resolvePath(path: string, ctx: EvalContext): unknown {
  const parts = path.trim().split('.')
  if (parts.length === 0) return undefined

  // 全局变量:单个全大写标识符
  if (parts.length === 1 && /^[A-Z][A-Z_]*$/.test(parts[0])) {
    return ctx.globals[parts[0]]
  }

  // input.* 命名空间
  if (parts[0] === 'input') {
    return dig(ctx.input, parts.slice(1))
  }

  // nodes.<id>.output.<field> 命名空间
  if (parts.length >= 2 && parts[1] === 'output') {
    const nodeId = parts[0]
    const nodeOutput = ctx.nodes[nodeId]?.output
    if (parts.length === 2) return nodeOutput // 整体引用 {{ n3.output }}
    return dig(nodeOutput, parts.slice(2))
  }

  // 不匹配任何命名空间
  return undefined
}

/** 逐层取值 */
function dig(obj: unknown, keys: string[]): unknown {
  let cur = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

// ===== 文本插值 {{ }} =====
const INTERP_RE = /\{\{\s*([^}]+?)\s*\}\}/g

/** 把字符串中的 {{ }} 替换为上下文值 */
export function interpolate(text: string, ctx: EvalContext): string {
  return text.replace(INTERP_RE, (_match, path: string) => {
    const val = resolvePath(path.trim(), ctx)
    if (val === undefined) return `{{ ${path.trim()} }}` // 未解析保留原样(静态校验会报)
    if (val === null) return ''
    return String(val)
  })
}

// ===== $ref 整体引用(保留类型)=====
export interface Ref {
  $ref: string
}

export function isRef(obj: unknown): obj is Ref {
  return !!obj && typeof obj === 'object' && '$ref' in obj && typeof (obj as Ref).$ref === 'string'
}

export function resolveRef(ref: Ref, ctx: EvalContext): unknown {
  return resolvePath(ref.$ref, ctx)
}

// ===== 深度插值(递归遍历对象/数组)=====
export function deepInterpolate(obj: unknown, ctx: EvalContext): unknown {
  if (typeof obj === 'string') return interpolate(obj, ctx)
  if (isRef(obj)) return resolveRef(obj, ctx)
  if (Array.isArray(obj)) return obj.map((v) => deepInterpolate(v, ctx))
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepInterpolate(v, ctx)
    }
    return result
  }
  return obj
}

// ===== input_hash(引用解析之后计算,§7)=====
/**
 * 计算节点的输入指纹,用于判定「这步能否复用上次产出」
 * 必须在所有 {{ }} / $ref 替换完之后算,否则等于拿空白模板对比
 */
export function computeInputHash(node: SpecNode, ctx: EvalContext): string {
  const resolved = deepInterpolate(node.args, ctx)
  const payload = JSON.stringify({ type: node.type, args: resolved })
  return 'sha256:' + createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

// ===== 为整条 spec 构建初始上下文 =====
export function buildContext(
  spec: WorkflowSpec,
  input: Record<string, unknown>,
  globals?: Partial<Record<string, unknown>>
): EvalContext {
  return {
    globals: { ...defaultGlobals(), ...globals, WORKFLOW_NAME: spec.id },
    input,
    nodes: {}
  }
}

/** 记录节点产出到上下文 */
export function setNodeOutput(
  ctx: EvalContext,
  nodeId: string,
  output: Record<string, unknown>
): void {
  ctx.nodes[nodeId] = { output }
}
