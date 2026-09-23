// Anthropic Messages API 适配器
// 端点:POST /v1/messages  |  认证:x-api-key + anthropic-version
// 与 OpenAI 的关键差异:
//   1. system 是顶层字段,不在 messages 里
//   2. content 必须是数组 [{type:'text',text}] 而非字符串
//   3. max_tokens 必填
//   4. SSE 事件类型不同(content_block_delta / message_stop)
import type { ChatChunk, ChatMessage, InvokeRequest } from '../types'
import type { AdapterConfig, ModelAdapter } from './types'
import {
  HttpError,
  acquireToken,
  createLimiter,
  readSSEEvents,
  extractData,
  extractEvent,
  withRetry,
  withTimeout
} from './http-utils'

export class AnthropicAdapter implements ModelAdapter {
  readonly type = 'anthropic'

  async *chat(req: InvokeRequest, config: AdapterConfig, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const limiter = createLimiter(config.rpm)
    if (limiter) await acquireToken(limiter, signal)

    const { system, messages } = this.convertMessages(req.messages)
    const body = {
      model: req.model ?? config.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(system ? { system } : {})
    }

    const stream = await this.request(body, config, signal)
    yield* this.parseStream(stream, req.model ?? config.model)
  }

  async ping(config: AdapterConfig, signal?: AbortSignal): Promise<void> {
    const limiter = createLimiter(config.rpm)
    if (limiter) await acquireToken(limiter, signal)
    const body = {
      model: config.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      max_tokens: 1,
      stream: false
    }
    const ts = withTimeout(signal, 15000)
    const res = await withRetry(
      () =>
        fetch(`${config.baseURL}/v1/messages`, {
          method: 'POST',
          headers: this.headers(config),
          body: JSON.stringify(body),
          signal: ts
        }),
      { retries: 2, signal: ts }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(`Anthropic API 请求失败 ${res.status}`, res.status, text)
    }
  }

  private headers(config: AdapterConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': String(config.extra.anthropic_version ?? '2023-06-01')
    }
  }

  private async request(
    body: Record<string, unknown>,
    config: AdapterConfig,
    signal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const ts = withTimeout(signal, config.timeoutMs)
    const res = await withRetry(
      () =>
        fetch(`${config.baseURL}/v1/messages`, {
          method: 'POST',
          headers: this.headers(config),
          body: JSON.stringify(body),
          signal: ts
        }),
      { retries: 2, signal: ts }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(`Anthropic API 请求失败 ${res.status}`, res.status, text)
    }
    return res.body as ReadableStream<Uint8Array>
  }

  /** 把 OpenAI 格式消息转成 Anthropic 格式(提取 system) */
  private convertMessages(messages: ChatMessage[]): {
    system: string
    messages: { role: string; content: { type: string; text: string }[] }[]
  } {
    let system = ''
    const converted: { role: string; content: { type: string; text: string }[] }[] = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        system += (system ? '\n' : '') + this.extractText(msg.content)
        continue
      }
      const text = this.extractText(msg.content)
      converted.push({
        role: msg.role,
        content: [{ type: 'text', text }]
      })
    }
    return { system, messages: converted }
  }

  private extractText(content: ChatMessage['content']): string {
    if (typeof content === 'string') return content
    return content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
  }

  private async *parseStream(
    stream: ReadableStream<Uint8Array>,
    model: string
  ): AsyncIterable<ChatChunk> {
    for await (const block of readSSEEvents(stream)) {
      const eventType = extractEvent(block)
      const data = extractData(block)
      if (!data) continue
      try {
        const json = JSON.parse(data)
        // content_block_delta:增量文本
        if (eventType === 'content_block_delta') {
          const text = json.delta?.text
          if (text) {
            yield { delta: text, meta: { provider: '', model } }
          }
        }
        // message_delta:usage 信息
        if (eventType === 'message_delta') {
          const usage = json.usage
          if (usage) {
            yield {
              usage: {
                promptTokens: usage.input_tokens ?? 0,
                completionTokens: usage.output_tokens ?? 0,
                totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
              },
              meta: { provider: '', model }
            }
          }
        }
        // message_stop:结束
        if (eventType === 'message_stop') {
          yield { finishReason: 'stop', meta: { provider: '', model } }
        }
      } catch {
        // 忽略无法解析的事件
      }
    }
  }
}
