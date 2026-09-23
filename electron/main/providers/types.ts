// 模型 Provider 抽象层
// 对齐设计:capability 路由 —— spec 只写 capability,运行时绑定具体模型
// 本地小模型与远程大模型都只是 capability 的一种实现

// ===== Capability(能力,spec 里只写这个,不写模型名)=====
export type Capability =
  | 'coding' // 写代码 / 文本
  | 'text' // 纯文本生成
  | 'vision' // 看懂图 / 视频(验证、审美术)
  | 'image' // 生成图
  | 'video' // 生成视频
  | 'music' // 生成音乐
  | 'speech' // 语音合成
  | 'classify' // 小模型分类 / 意图识别
  | 'extract' // 小模型抽取结构化信息
  | 'embedding' // 向量检索
  | 'reasoning' // 深度推理(如 deepseek-reasoner)

export type Locality = 'local' | 'remote'

// ===== 聊天消息(OpenAI 兼容格式)=====
export interface ChatContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatContent[]
  name?: string
  tool_calls?: unknown[]
}

// ===== 调用请求 =====
export interface InvokeRequest {
  /** 指定能力,运行时由路由表查出 provider;也可显式 provider 覆盖 */
  capability: Capability
  messages: ChatMessage[]
  /** 可选:覆盖路由表绑定的具体模型名 */
  model?: string
  /** 可选:覆盖路由表绑定的 provider id */
  provider?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  /** 响应格式约束(JSON 模式) */
  json?: boolean
  /** 用户透传标识 */
  userTag?: string
}

// ===== 流式分块 =====
export interface ChatChunk {
  /** 增量文本(delta) */
  delta?: string
  /** 当前完成的理由(stop / length / ...) */
  finishReason?: string
  /** token 用量(通常在最后一个分块) */
  usage?: TokenUsage
  /** 该次调用实际使用的 provider / model */
  meta?: { provider: string; model: string }
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ===== 成本估算 =====
export interface CostEstimate {
  /** 预估花费(USD) */
  money: number
  /** 预估耗时(秒) */
  seconds: number
}

// ===== 健康检查 =====
export interface HealthStatus {
  available: boolean
  message?: string
}

// ===== Provider 接口(对齐设计文档 §8.1)=====
export interface ModelProvider {
  /** 唯一标识(如 deepseek / minimax / godot) */
  id: string
  /** 展示名 */
  name: string
  /** 本地 / 远程 */
  locality: Locality
  /** 该 provider 能提供的能力集合 */
  capabilities: Capability[]
  /** 流式调用 */
  invoke(req: InvokeRequest, signal?: AbortSignal): AsyncIterable<ChatChunk>
  /** 成本预估 */
  estimateCost(req: InvokeRequest): CostEstimate
  /** 可用性探测(key 有效?余额够?编辑器开着?) */
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>
}
