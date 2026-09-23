// 适配器注册表:adapter 类型 → 工厂
// 新增一种协议适配器只需在此注册,manifest 即可引用
import { OpenAIChatAdapter } from './openai-chat'
import { OpenAIResponsesAdapter } from './openai-responses'
import { AnthropicAdapter } from './anthropic'
import { HttpJobAdapter } from './http-job'
import type { AdapterMap, ModelAdapter } from './types'

export const adapterMap: AdapterMap = {
  openai_chat: () => new OpenAIChatAdapter(),
  openai_responses: () => new OpenAIResponsesAdapter(),
  anthropic: () => new AnthropicAdapter(),
  http_job: () => new HttpJobAdapter()
}

/** 按 manifest 的 adapter 字段获取适配器实例 */
export function getAdapter(type: string): ModelAdapter | null {
  const factory = adapterMap[type]
  return factory ? factory() : null
}

/** 列出所有已注册的适配器类型 */
export function listAdapterTypes(): string[] {
  return Object.keys(adapterMap)
}
