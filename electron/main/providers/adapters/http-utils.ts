// 共享 HTTP 工具:重试、超时、令牌桶限流、SSE 流读取
// 所有适配器(openai_chat / anthropic / ...)共用这一层,只实现各自的协议差异

// ===== HTTP 错误 =====
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** 判断是否可重试(429 限流 / 5xx 服务端错误) */
export function isRetryable(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 429 || err.status >= 500)
}

// ===== 睡眠(可取消)=====
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
export async function withRetry<T>(
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
      if (!isRetryable(err) || attempt === opts.retries) throw err
      const backoff = Math.min(1000 * 2 ** attempt, 16000)
      await sleep(backoff, opts.signal)
    }
  }
  throw lastErr
}

// ===== 合并外部 signal 与超时 =====
export function withTimeout(external: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  external?.addEventListener(
    'abort',
    () => {
      clearTimeout(timer)
      controller.abort()
    },
    { once: true }
  )
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return controller.signal
}

// ===== 令牌桶限流(每秒补充)=====
export interface RateLimiter {
  rpm: number
  tokens: number
  lastRefill: number
}

export function createLimiter(rpm: number): RateLimiter | null {
  if (!rpm || rpm <= 0) return null
  return { rpm, tokens: rpm, lastRefill: Date.now() }
}

export async function acquireToken(limiter: RateLimiter, signal?: AbortSignal): Promise<void> {
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

// ===== SSE 事件流读取(共享)=====
// 按 \n\n 分割事件块,每块可能含多行(event: / data:)
export async function* readSSEEvents(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        if (block.trim()) yield block
      }
    }
    if (buffer.trim()) yield buffer
  } finally {
    reader.releaseLock()
  }
}

/** 从 SSE 事件块中提取 data 行(可能有多个,拼接) */
export function extractData(block: string): string | null {
  const lines = block.split('\n')
  const dataLines = lines.filter((l) => l.startsWith('data:'))
  if (dataLines.length === 0) return null
  return dataLines.map((l) => l.slice(5).trim()).join('\n')
}

/** 从 SSE 事件块中提取 event 类型 */
export function extractEvent(block: string): string | null {
  const line = block.split('\n').find((l) => l.startsWith('event:'))
  return line ? line.slice(6).trim() : null
}
