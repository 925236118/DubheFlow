// Spec 类型定义 —— 对齐设计文档《天枢-工作流引擎设计》§3 + 《天枢-数据流与变量设计》
// spec 是唯一真源(JSON),画布是它的编辑器,AI 生成的是它,数据库存的是它
// spec 里写的是 capability,不是模型名 —— 运行时才绑定具体模型

// ===== 顶层结构 =====
export interface WorkflowSpec {
  /** 工作流标识 */
  id: string
  /** 版本号 */
  version: number
  /** 目标描述 */
  goal: string
  /** 运行输入定义(用户填的槽位) */
  inputs?: Record<string, SpecInputDef>
  /** 兼容旧格式的输入声明 */
  input_schema?: { required: string[]; optional?: string[] }
  /** 节点列表 */
  nodes: SpecNode[]
  /** 边列表 [from, to] */
  edges: SpecEdge[]
  /** 预算 */
  budget: Budget
}

// ===== 输入定义 =====
export interface SpecInputDef {
  type: SpecValueType
  required?: boolean
  default?: unknown
  values?: unknown[] // enum 选项
  label?: string
}

// ===== 节点 =====
export interface SpecNode {
  /** 节点 ID(spec 内唯一) */
  id: string
  /** 原语类型(来自注册表:collect / llm_generate / verify / ...) */
  type: string
  /** 参数(可含 {{ }} 插值和 $ref 引用) */
  args: Record<string, unknown>
}

// ===== 边 =====
export type SpecEdge = [from: string, to: string]

// ===== 预算 =====
export interface Budget {
  /** 最大模型调用次数 */
  max_model_calls: number
  /** 最大耗时(秒) */
  max_seconds: number
  /** 最大花费(USD) */
  max_cost: number
  /** 最大回溯轮次 */
  max_rollback_rounds?: number
}

// ===== 值类型(对齐数据流设计 §5.1 标准类型)=====
export type SpecValueType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'json'
  | 'path'
  | 'file'
  | 'file[]'
  | 'patch'
  | 'enum'

// ===== 节点输出契约 =====
export interface NodeOutputDef {
  type: SpecValueType
  kind?: 'image' | 'video' | 'audio' | 'code' | 'log'
}

// ===== 运行状态 =====
export type RunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'aborted'

export type StepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'deprecated'

export type RevisionState = 'draft' | 'published'

// ===== 数据流引用 =====
/** 文本插值 {{ }} 或整体引用 $ref 的路径 */
export interface ResolvedRef {
  /** 引用的命名空间 */
  namespace: 'global' | 'input' | 'node'
  /** 节点 ID(node 命名空间) */
  nodeId?: string
  /** 字段路径(output.text / output.exit_code ...) */
  field: string
  /** 子字段 */
  subField?: string
}
