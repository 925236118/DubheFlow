// 适配器接口:协议级 HTTP 客户端
// 每种 API 格式(OpenAI Chat / OpenAI Responses / Anthropic / HTTP Job)一个适配器
// 通用 ManifestProvider 按 manifest 的 adapter 字段选择适配器
import type { ChatChunk, InvokeRequest } from '../types'

/** 适配器运行时配置(由 ManifestProvider 从 manifest 构造) */
export interface AdapterConfig {
  baseURL: string
  apiKey: string
  model: string
  /** manifest 里 adapter_config 的全部字段(adapter-specific) */
  extra: Record<string, unknown>
  /** 该服务的全部鉴权字段明文(api_key / group_id / …,从 safeStorage 读取) */
  secrets: Record<string, string>
  /** 每分钟最大请求数(0 = 不限),来自 manifest exec */
  rpm: number
  /** 请求超时(毫秒) */
  timeoutMs: number
}

/** 适配器接口 —— 所有协议适配器实现此接口 */
export interface ModelAdapter {
  /** 适配器类型标识(与 manifest 的 adapter 字段匹配) */
  readonly type: string

  /**
   * 流式调用,产出 ChatChunk
   * - 文本类适配器(openai_chat / anthropic):逐字产出 delta
   * - 异步任务适配器(http_job):提交 → 轮询 → 产出最终结果
   */
  chat(req: InvokeRequest, config: AdapterConfig, signal?: AbortSignal): AsyncIterable<ChatChunk>

  /** 轻量探测(健康检查用) */
  ping(config: AdapterConfig, signal?: AbortSignal): Promise<void>
}

/** 适配器工厂表(在 index.ts 注册) */
export type AdapterMap = Record<string, () => ModelAdapter>
