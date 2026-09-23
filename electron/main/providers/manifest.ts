// 服务清单(manifest)类型定义
// 对齐设计 §8.6-8.10:manifest 是「服务 → 节点」的唯一真源
// 一份 manifest 自动生成:节点面板 / 参数表单 / Planner 提示词 / 成本预估 / 调度约束 / 审批策略 / 健康检查

import type { Capability, Locality } from './types'

// ===== manifest 顶层结构(§8.7)=====
export interface ServiceManifest {
  manifest_version: number
  id: string
  name: string
  version: string
  description?: string
  locality: Locality
  min_app_version?: string
  auth: AuthConfig
  health?: HealthConfig
  nodes: ManifestNode[]
}

// ===== 鉴权(§8.7 auth)=====
export interface AuthConfig {
  type: 'none' | 'api_key' | 'oauth'
  fields: AuthField[]
}

export interface AuthField {
  key: string
  label: string
  secret: boolean // secret → safeStorage
  required?: boolean
  default?: string
  placeholder?: string
}

// ===== 健康检查(§8.7 health)=====
export interface HealthConfig {
  adapter: string
  request: Record<string, unknown>
  on_fail?: 'degrade' | 'error'
}

// ===== 节点(§8.7 nodes)=====
export interface ManifestNode {
  type: string // 节点类型(模型节点取自标准集合,§8.9 硬规则)
  capability?: Capability
  label?: string
  description?: string
  adapter: string // openai_chat / openai_image / http_job / cli / bridge_rpc / module
  adapter_config: Record<string, unknown>
  args?: Record<string, NodeArgSchema>
  outputs?: Record<string, NodeOutputSchema>
  cost?: CostModel
  exec?: ExecConfig
}

export interface NodeArgSchema {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'path' | 'file' | 'json'
  required?: boolean
  default?: unknown
  values?: unknown[] // enum
  min?: number
  max?: number
  widget?: 'textarea' | 'select' | 'slider' | 'input' | 'none'
  label?: string
}

export interface NodeOutputSchema {
  type: string // string / integer / file / file[] / patch / json
  kind?: string // image / video / audio
}

// ===== 成本模型(§8.7 cost)=====
export type CostModel =
  | { model: 'free' }
  | {
      model: 'per_token'
      input: number // 每单位价格
      output: number
      currency: string
      per: number // 价格对应的 token 数(如 1000000 = 每 1M token)
    }
  | {
      model: 'per_unit'
      unit: string // image / second / character
      price: number
      currency: string
    }

// ===== 执行特征(§8.7 exec)=====
export interface ExecConfig {
  mode: 'sync' | 'async_job'
  timeout_seconds?: number
  parallel_safe?: boolean
  idempotent?: boolean
  requires?: string[] // editor_online / editor_offline / export_templates / network / godot_available
  side_effects?: string[] // project_files / editor_state / external_billing
  approval?: 'none' | 'confirm' | 'always'
}
