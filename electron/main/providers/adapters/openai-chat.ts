// OpenAI Chat Completions 适配器
// DeepSeek / llama.cpp / 多数 OpenAI 兼容厂商都用这套协议
// 端点:POST /chat/completions  |  认证:Authorization: Bearer
import type { ChatChunk, InvokeRequest } from '../types'
import type { AdapterConfig, ModelAdapter } from './types'
import {
  HttpError,
  acquireToken,
  createLimiter,
  readSSEEvents,
  extractData,
  withRetry,
  withTimeout
} from './http-utils'

export class OpenAIChatAdapter implements ModelAdapter {
  readonly type = 'openai_chat'

  async *chat(req: InvokeRequest, config: AdapterConfig, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const limiter = createLimiter(config.rpm)
    if (limiter) await acquireToken(limiter, signal)

    const body = this.buildBody(req, config, true)
    const stream = await this.request(body, config, signal)
    yield* this.parseStream(stream, config.model)
  }

  async ping(config: AdapterConfig, signal?: AbortSignal): Promise<void> {
    const limiter = createLimiter(config.rpm)
    if (limiter) await acquireToken(limiter, signal)
    const body = {
      model: config.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    }
    await this.request(body, { ...config, timeoutMs: 15000 }, signal).then(async (s) => {
      // 消费完流(非流式时返回的是已完成的 JSON)
      await s.cancel?.()
    })
  }

  private buildBody(req: InvokeRequest, config: AdapterConfig, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model ?? config.model,
      messages: req.messages,
      stream
    }
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens
    if (req.json) body.response_format = { type: 'json_object' }
    return body
  }

  private async request(
    body: Record<string, unknown>,
    config: AdapterConfig,
    signal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${config.baseURL}/chat/completions`
    const ts = withTimeout(signal, config.timeoutMs)
    const res = await withRetry(
      () =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(body),
          signal: ts
        }),
      { retries: 2, signal: ts }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(`DeepSeek/OpenAI API 请求失败 ${res.status}`, res.status, text)
    }
    if (body.stream) {
      return res.body as ReadableStream<Uint8Array>
    }
    // 非流式:包装成一个单次可读流,ping 用
    const json = await res.json()
    const encoder = new TextEncoder()
    return new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(encoder.encode(JSON.stringify(json)))
        ctrl.close()
      }
    })
  }

  private async *parseStream(
    stream: ReadableStream<Uint8Array>,
    model: string
  ): AsyncIterable<ChatChunk> {
    for await (const block of readSSEEvents(stream)) {
      const data = extractData(block)
      if (!data || data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const choice = json.choices?.[0]
        const chunk: ChatChunk = { meta: { provider: '', model } }
        if (choice?.delta?.content) chunk.delta = choice.delta.content
        if (choice?.finish_reason) chunk.finishReason = choice.finish_reason
        if (json.usage) {
          chunk.usage = {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens
          }
        }
        yield chunk
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}
