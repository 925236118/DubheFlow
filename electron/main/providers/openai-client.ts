// OpenAI 兼容客户端:一套实现覆盖 DeepSeek(远程)与 llama.cpp(本地)
// 对齐设计 §8.2:「llama.cpp 的 server 和 DeepSeek 都是 OpenAI 兼容 API → 一套客户端」
//
// 能力:
// - chat completions(流式 SSE + 非流式)
// - vision(image_url 多模态输入)
// - 重试(指数退避,处理 429/5xx)
// - 超时(AbortSignal)
// - 令牌桶限流(按 provider 分别配置,设计 §4.9)
import type { ChatChunk, ChatMessage, InvokeRequest, TokenUsage } from './types'

export interface OpenAIClientOptions {
  baseURL: string
  apiKey?: string
  /** 默认模型 */
  defaultModel: string
  /** 令牌桶:每秒最大请求数(0 = 不限) */
  rpm?: number
  /** 请求超时(毫秒),默认 120s */
  timeoutMs?: number
  /** 自定义请求头 */
  headers?: Record<string, string>
}

interface RateLimiter {
  rpm: number
  tokens: number
  lastRefill: number
}

// ===== 令牌桶限流 =====
function createLimiter(rpm: number): RateLimiter | null {
  if (!rpm || rpm <= 0) return null
  return { rpm, tokens: rpm, lastRefill: Date.now() }
}

async function acquireToken(limiter: RateLimiter, signal?: AbortSignal): Promise<void> {
  // 按秒补充令牌
  while (limiter.tokens < 1) {
    const now = Date.now()
    const elapsed = (now - limiter.lastRefill) / 1000
    limiter.tokens = Math.min(limiter.rpm, limiter.tokens + elapsed * limiter.rpm)
    limiter.lastRefill = now
    if (limiter.tokens >= 1) break
    await sleep(200, signal)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }
  limiter.tokens -= 1
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

// ===== 指数退避重试 =====
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; signal?: AbortSignal }
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (opts.signal?.aborted) throw err
      lastErr = err
      const isRetryable =
        err instanceof OpenAIHttpError &&
        (err.status === 429 || err.status >= 500)
      if (!isRetryable || attempt === opts.retries) throw err
      // 指数退避:1s, 2s, 4s...
      const backoff = Math.min(1000 * 2 ** attempt, 16000)
      await sleep(backoff, opts.signal)
    }
  }
  throw lastErr
}

export class OpenAIHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string
  ) {
    super(message)
    this.name = 'OpenAIHttpError'
  }
}

// ===== 主客户端 =====
export class OpenAIClient {
  private limiter: RateLimiter | null

  constructor(private opts: OpenAIClientOptions) {
    this.limiter = createLimiter(opts.rpm ?? 0)
  }

  /** 流式 chat completions,产出 ChatChunk 异步迭代 */
  async *chat(req: InvokeRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    if (this.limiter) await acquireToken(this.limiter, signal)

    const model = req.model ?? this.opts.defaultModel
    const body = this.buildBody(req, model, true)

    const result = this.doRequest(body, signal)
    yield* this.parseStream(result, model)
  }

  /** 非流式 chat completions(用于健康检查等轻量场景) */
  async chatOnce(
    req: InvokeRequest,
    signal?: AbortSignal
  ): Promise<{ content: string; usage: TokenUsage | null }> {
    if (this.limiter) await acquireToken(this.limiter, signal)
    const model = req.model ?? this.opts.defaultModel
    const body = this.buildBody(req, model, false)
    const data = await this.doRequest(body, signal)
    const choice = data.choices?.[0]
    return {
      content: choice?.message?.content ?? '',
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens
          }
        : null
    }
  }

  private buildBody(req: InvokeRequest, model: string, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      stream
    }
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens
    if (req.json) {
      body.response_format = { type: 'json_object' }
    }
    return body
  }

  private async doRequest(
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<any> {
    const url = `${this.opts.baseURL}/chat/completions`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.opts.headers
    }
    if (this.opts.apiKey) {
      headers.Authorization = `Bearer ${this.opts.apiKey}`
    }

    const timeoutSignal = this.withTimeout(signal)
    const doFetch = () =>
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutSignal
      })

    const res = await withRetry(doFetch, { retries: 2, signal })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new OpenAIHttpError(
        `OpenAI 兼容 API 请求失败 ${res.status}`,
        res.status,
        text
      )
    }

    if (body.stream) {
      return res.body
    }
    return res.json()
  }

  /** 合并外部 signal 与超时 */
  private withTimeout(external?: AbortSignal): AbortSignal {
    const controller = new AbortController()
    const ms = this.opts.timeoutMs ?? 120000
    const timer = setTimeout(() => controller.abort(), ms)
    external?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        controller.abort()
      },
      { once: true }
    )
    // 超时不阻塞流结束 —— 用 once 在首次触发时清理
    controller.signal.addEventListener(
      'abort',
      () => clearTimeout(timer),
      { once: true }
    )
    return controller.signal
  }

  /** 解析 SSE 流,产出 ChatChunk */
  private async *parseStream(
    streamPromise: Promise<ReadableStream<Uint8Array>>,
    model: string
  ): AsyncIterable<ChatChunk> {
    const stream = await streamPromise
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let usage: TokenUsage | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE 以 \n\n 分隔事件
        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const eventBlock = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          yield* this.parseEvent(eventBlock, model)
        }
      }
      // 处理残余
      if (buffer.trim()) {
        yield* this.parseEvent(buffer, model)
      }
      if (usage) {
        yield { usage, meta: { provider: '', model } }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private async *parseEvent(block: string, model: string): AsyncIterable<ChatChunk> {
    for (const line of block.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const choice = json.choices?.[0]
        const delta = choice?.delta?.content
        const finishReason = choice?.finish_reason
        const chunk: ChatChunk = { meta: { provider: '', model } }
        if (delta) chunk.delta = delta
        if (finishReason) chunk.finishReason = finishReason
        if (json.usage) {
          chunk.usage = {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens
          }
        }
        yield chunk
      } catch {
        // 忽略无法解析的行(如注释)
      }
    }
  }
}

// 辅助:构造 OpenAI 兼容格式的消息
export function textMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return { role, content: text }
}

export function visionMessage(
  role: ChatMessage['role'],
  text: string,
  imageUrl: string
): ChatMessage {
  return {
    role,
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imageUrl } }
    ]
  }
}
