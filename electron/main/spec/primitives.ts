// 原语注册表 —— 对齐设计文档《天枢-工作流引擎设计》§2
// 核心纪律:Planner 只能组合注册表内的原语,不能发明新节点或新工具
// 注册表外的节点没法验证、没法给权限、没法预估成本
//
// 注册表的两个来源:
//   1. 内置原语(本文件)—— 控制流、输入、裁决,由工作站本体定义
//   2. 服务贡献节点 —— 由各服务的 manifest 成批贡献(见 manifest-loader)

import type { NodeOutputDef, SpecValueType } from './types'

// ===== 原语分类 =====
export type PrimitiveCategory = 'input' | 'generate' | 'control' | 'tool' | 'verify'

// ===== 原语参数定义 =====
export interface PrimitiveArgDef {
  type: SpecValueType
  required?: boolean
  default?: unknown
  values?: unknown[]
  description?: string
}

// ===== 原语定义 =====
export interface PrimitiveDef {
  /** 原语类型(与 SpecNode.type 匹配) */
  type: string
  category: PrimitiveCategory
  description: string
  args: Record<string, PrimitiveArgDef>
  outputs?: Record<string, NodeOutputDef>
}

// ===== 内置原语注册表 =====
// 对齐设计 §2 原语注册表
export const BUILTIN_PRIMITIVES: Record<string, PrimitiveDef> = {
  // ----- 输入与交互 -----
  collect: {
    type: 'collect',
    category: 'input',
    description: '按模板逐项收集输入,支持多轮对话',
    args: {
      template: { type: 'string', required: true, description: '输入模板名' },
      fields: { type: 'json', required: true, description: '字段列表' }
    }
  },
  require: {
    type: 'require',
    category: 'input',
    description: '完整性校验:缺必填项则回到 collect',
    args: {
      schema_ref: { type: 'string', required: true, description: '引用 input_schema' },
      on_missing: { type: 'string', default: 'goto', description: '缺失时动作(goto:节点ID)' },
      max_rounds: { type: 'integer', default: 5 }
    }
  },
  approve: {
    type: 'approve',
    category: 'input',
    description: '人工审批门禁',
    args: {
      kind: { type: 'string', default: 'confirm', description: 'confirm / always' },
      payload: { type: 'json', description: '审批材料(如 diff)' }
    }
  },

  // ----- 生成 -----
  llm_generate: {
    type: 'llm_generate',
    category: 'generate',
    description: '生成内容,按 modality 分文本/图像/音频(spec 写 capability,运行时绑定模型)',
    args: {
      capability: { type: 'string', required: true, description: 'coding / image / music / ...' },
      modality: { type: 'string', default: 'text', description: 'text / image / audio' },
      prompt: { type: 'string', required: true, description: '提示词(可含 {{ }} 插值)' },
      output: { type: 'json', description: '输出配置 {kind, path}' },
      temperature: { type: 'number', default: 0 },
      max_tokens: { type: 'integer', default: 4096 }
    },
    outputs: {
      text: { type: 'string' },
      patch: { type: 'patch' },
      file: { type: 'file' }
    }
  },
  classify: {
    type: 'classify',
    category: 'generate',
    description: '小模型分类 / 意图识别(规则优先,模型兜底)',
    args: {
      input: { type: 'string', required: true },
      candidates: { type: 'json', required: true, description: '候选意图(代码定义)' }
    },
    outputs: { label: { type: 'string' }, confidence: { type: 'number' } }
  },
  extract: {
    type: 'extract',
    category: 'generate',
    description: '小模型抽取结构化信息',
    args: {
      input: { type: 'string', required: true },
      schema: { type: 'json', required: true, description: '目标 schema' }
    },
    outputs: { data: { type: 'json' } }
  },

  // ----- 控制流 -----
  split: {
    type: 'split',
    category: 'control',
    description: '拆解为子任务',
    args: {
      capability: { type: 'string', default: 'reasoning' },
      into: { type: 'json', required: true, description: '子任务名列表' }
    },
    outputs: { subtasks: { type: 'json' } }
  },
  fanout: {
    type: 'fanout',
    category: 'control',
    description: '并行下发多条分支',
    args: {
      targets: { type: 'json', required: true, description: '目标节点 ID 列表' },
      parallel: { type: 'boolean', default: true }
    }
  },
  join: {
    type: 'join',
    category: 'control',
    description: '等待分支汇聚(含失败策略)',
    args: {
      sources: { type: 'json', required: true, description: '来源节点 ID 列表' },
      policy: {
        type: 'enum',
        values: ['all_success', 'all_settled', 'quorum'],
        default: 'all_success'
      },
      on_branch_fail: {
        type: 'enum',
        values: ['abort', 'skip', 'ask_user'],
        default: 'ask_user'
      },
      quorum: { type: 'integer', description: 'quorum 策略时最少成功数' }
    },
    outputs: { branches: { type: 'json' } }
  },
  assemble: {
    type: 'assemble',
    category: 'control',
    description: '拼装轮次产出',
    args: {
      inputs: { type: 'json', required: true, description: '输入引用列表' },
      max_rounds: { type: 'integer', default: 3 }
    },
    outputs: { result: { type: 'json' } }
  },
  branch: {
    type: 'branch',
    category: 'control',
    description: '条件分支',
    args: {
      condition: { type: 'string', required: true },
      targets: { type: 'json', required: true }
    }
  },
  loop: {
    type: 'loop',
    category: 'control',
    description: '有界循环(必须声明上限)',
    args: {
      body: { type: 'string', required: true, description: '循环体节点 ID' },
      max_iterations: { type: 'integer', required: true }
    }
  },
  rollback_to: {
    type: 'rollback_to',
    category: 'control',
    description: '回溯到指定步骤(只能回退到 verify 声明的 rollback_targets)',
    args: {
      target: { type: 'string', required: true, description: '目标节点 ID' },
      reason: { type: 'string' }
    }
  },

  // ----- 工具与执行 -----
  tool_call: {
    type: 'tool_call',
    category: 'tool',
    description: '调 MCP / Function Call',
    args: {
      tool: { type: 'string', required: true },
      args: { type: 'json' }
    },
    outputs: { result: { type: 'json' }, exit_code: { type: 'integer' } }
  },
  apply_change: {
    type: 'apply_change',
    category: 'tool',
    description: '写文件 / 改场景(可要求审批)',
    args: {
      changes: { type: 'json', required: true, description: '改动列表(含 $ref 到 patch)' },
      approval: { type: 'enum', values: ['none', 'confirm', 'always'], default: 'confirm' }
    },
    outputs: { diff: { type: 'patch' } }
  },
  godot_check: {
    type: 'godot_check',
    category: 'tool',
    description: 'headless 检查(check_only / import)',
    args: {
      mode: { type: 'enum', values: ['check_only', 'import'], default: 'check_only' },
      script: { type: 'path' }
    },
    outputs: { exit_code: { type: 'integer' }, stderr: { type: 'string' } }
  },
  run_test: {
    type: 'run_test',
    category: 'tool',
    description: '跑冒烟测试 / 测试用例',
    args: {
      scope: { type: 'string', default: 'all' },
      timeout: { type: 'integer', default: 300 }
    },
    outputs: { exit_code: { type: 'integer' }, output: { type: 'string' } }
  },

  // ----- 裁决 -----
  verify: {
    type: 'verify',
    category: 'verify',
    description: '规则 + 小模型裁决成败(规则优先,模糊才调模型)',
    args: {
      target: { type: 'string', required: true, description: '被验证的节点 ID' },
      criteria: { type: 'string', required: true, description: '验证标准(可含 {{ }})' },
      evidence: { type: 'json', description: '证据包($ref 到节点产出)' },
      diff: { type: 'patch', description: 'git diff($ref)' },
      on_fail: {
        type: 'enum',
        values: ['retry', 'rollback_to', 'force_deliver', 'abort'],
        default: 'retry'
      },
      retry_target: { type: 'string', description: 'retry 时重试的节点 ID' },
      rollback_targets: { type: 'json', description: '允许回溯的目标节点 ID 列表' },
      max_retries: { type: 'integer', default: 2 },
      judge: { type: 'string', default: 'small_model', description: 'small_model / rules' }
    },
    outputs: {
      success: { type: 'boolean' },
      reason: { type: 'string' },
      confidence: { type: 'number' }
    }
  }
}

/** 获取原语定义 */
export function getPrimitive(type: string): PrimitiveDef | null {
  return BUILTIN_PRIMITIVES[type] ?? null
}

/** 列出所有内置原语(用于 Planner 系统提示词自动生成) */
export function listPrimitives(): PrimitiveDef[] {
  return Object.values(BUILTIN_PRIMITIVES)
}

/** 检查节点类型是否在注册表中 */
export function isRegisteredType(type: string): boolean {
  return type in BUILTIN_PRIMITIVES
}
