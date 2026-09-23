// OpenAI Responses API 适配器(OpenAI 较新的 /responses 端点)
// 与 Chat Completions 的差异:
//   1. 端点 POST /responses,用 input 而非 messages
//   2. system → 顶层 instructions 字段
//   3. SSE 事件类型:response.output_text.delta / response.completed
//   4. content 格式:input_text / output_text
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

export class OpenAIResponsesAdapter implements ModelAdapter {
  readonly type = 'openai_responses'

  async *chat(req: InvokeRequest, config: AdapterConfig, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const limiter = createLimiter(config.rpm)
    if (limiter) await acquireToken(limiter, signal)

    const { instructions, input } = this.convertMessages(req.messages)
    const body: Record<string, unknown> = {
      model: req.model ?? config.model,
      input,
      stream: true
    }
    if (instructions) body.instructions = instructions
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens

    const stream = await this.request(body, config, signal)
    yield* this.parseStream(stream, req.model ?? config.model)
  }

  async ping(config: AdapterConfig, signal?: AbortSignal): Promise<void> {
    const limiter = createLimiter(config.rpm)
    if (limiter) await acquireToken(limiter, signal)
    const ts = withTimeout(signal, 15000)
    const res = await withRetry(
      () =>
        fetch(`${config.baseURL}/responses`, {
          method: 'POST',
          headers: this.headers(config),
          body: JSON.stringify({
            model: config.model,
            input: 'ping',
            max_output_tokens: 1,
            stream: false
          }),
          signal: ts
        }),
      { retries: 2, signal: ts }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(`OpenAI Responses API 请求失败 ${res.status}`, res.status, text)
    }
  }

  private headers(config: AdapterConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
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
        fetch(`${config.baseURL}/responses`, {
          method: 'POST',
          headers: this.headers(config),
          body: JSON.stringify(body),
          signal: ts
        }),
      { retries: 2, signal: ts }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(`OpenAI Responses API 请求失败 ${res.status}`, res.status, text)
    }
    return res.body as ReadableStream<Uint8Array>
  }

  /** 把 OpenAI 格式消息转成 Responses API 的 input + instructions */
  private convertMessages(messages: ChatMessage[]): {
    instructions: string
    input: { type: string; role: string; content: { type: string; text: string }[] }[]
  } {
    let instructions = ''
    const input: { type: string; role: string; content: { type: string; text: string }[] }[] = []
    for (const msg of messages) {
      if (msg.role === 'system') {
        instructions += (instructions ? '\n' : '') + this.extractText(msg.content)
        continue
      }
      const text = this.extractText(msg.content)
      const contentType = msg.role === 'assistant' ? 'output_text' : 'input_text'
      input.push({
        type: 'message',
        role: msg.role,
        content: [{ type: contentType, text }]
      })
    }
    return { instructions, input }
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
        // 增量文本
        if (eventType === 'response.output_text.delta') {
          if (json.delta) yield { delta: json.delta, meta: { provider: '', model } }
        }
        // 完成
        if (eventType === 'response.completed') {
          const usage = json.response?.usage
          if (usage) {
            yield {
              usage: {
                promptTokens: usage.input_tokens ?? 0,
                completionTokens: usage.output_tokens ?? 0,
                totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
              },
              finishReason: 'stop',
              meta: { provider: '', model }
            }
          } else {
            yield { finishReason: 'stop', meta: { provider: '', model } }
          }
        }
        if (eventType === 'response.failed') {
          throw new HttpError('Responses API 返回失败', 500, data)
        }
      } catch (e) {
        if (e instanceof HttpError) throw e
        // 忽略无法解析的事件
      }
    }
  }
}
