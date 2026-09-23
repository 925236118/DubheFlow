// 异步任务适配器(提交 → 轮询 → 取结果)
// 适用于 MiniMax 图像/视频/音乐生成等非流式 API
// 模式:POST submit → 拿 job_id → POST/GET poll → 状态完成 → 取结果
import type { ChatChunk, InvokeRequest } from '../types'
import type { AdapterConfig, ModelAdapter } from './types'
import { HttpError, withRetry, withTimeout, sleep } from './http-utils'

export class HttpJobAdapter implements ModelAdapter {
  readonly type = 'http_job'

  async *chat(req: InvokeRequest, config: AdapterConfig, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const cfg = config.extra
    const submitPath = String(cfg.submit ?? '')
    const pollPath = String(cfg.poll ?? '')
    // submit 和 poll 的字段名(不同厂商不同)
    const jobIdField = String(cfg.job_id_field ?? 'task_id')
    const statusField = String(cfg.status_field ?? 'status')
    const resultField = String(cfg.result_field ?? 'data')
    const doneStatus = String(cfg.done_status ?? 'Done')
    const failStatus = String(cfg.fail_status ?? 'Failed')
    const pollInterval = Number(cfg.poll_interval ?? 3000)

    // 1. 提交任务
    const submitBody = this.buildSubmitBody(req, cfg)
    const jobId = await this.submit(config, submitPath, submitBody, jobIdField, signal)
    if (!jobId) throw new HttpError('提交任务失败:未返回 job_id', 500)

    // 2. 轮询
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await sleep(pollInterval, signal)
      const result = await this.poll(config, pollPath, jobId, signal)
      const status = String(result?.[statusField] ?? '')
      if (status === doneStatus || status === 'Succeeded' || status === 'succeed') {
        // 3. 取结果,产出最终 chunk
        const data = result?.[resultField]
        yield {
          delta: typeof data === 'string' ? data : JSON.stringify(data),
          finishReason: 'stop',
          meta: { provider: '', model: config.model }
        }
        return
      }
      if (status === failStatus || status === 'Failed') {
        throw new HttpError(`任务失败:${JSON.stringify(result)}`, 500)
      }
      // 仍在处理中,继续轮询(可选产出进度)
    }
  }

  async ping(config: AdapterConfig, signal?: AbortSignal): Promise<void> {
    // 尝试一个轻量请求验证连通性(提交端点是否可达 + 鉴权是否有效)
    const cfg = config.extra
    const submitPath = String(cfg.submit ?? '')
    const ts = withTimeout(signal, 15000)
    const res = await fetch(`${config.baseURL}${submitPath}`, {
      method: 'POST',
      headers: this.headers(config),
      body: JSON.stringify({ model: config.model }),
      signal: ts
    })
    // 400/422 表示鉴权通过但参数不对,也算连通
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(`鉴权失败 ${res.status}`, res.status)
    }
  }

  private headers(config: AdapterConfig): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    }
    // MiniMax 需要 group_id
    const groupId = config.secrets?.group_id ?? config.extra.group_id
    if (groupId) h['GroupId'] = String(groupId)
    return h
  }

  private buildSubmitBody(req: InvokeRequest, cfg: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: String(cfg.model ?? '')
    }
    // 从 req 提取参数
    const userText = req.messages
      ?.map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    if (userText) body.prompt = userText
    // 透传 args
    if (cfg.size) body.size = cfg.size
    if (cfg.duration) body.duration = cfg.duration
    return body
  }

  private async submit(
    config: AdapterConfig,
    path: string,
    body: Record<string, unknown>,
    jobIdField: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const ts = withTimeout(signal, config.timeoutMs)
    const res = await withRetry(
      () =>
        fetch(`${config.baseURL}${path}`, {
          method: 'POST',
          headers: this.headers(config),
          body: JSON.stringify(body),
          signal: ts
        }),
      { retries: 2, signal: ts }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new HttpError(`提交任务失败 ${res.status}`, res.status, text)
    }
    const json = (await res.json()) as Record<string, unknown>
    return String(json[jobIdField] ?? json.task_id ?? json.id ?? '')
  }

  private async poll(
    config: AdapterConfig,
    path: string,
    jobId: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const ts = withTimeout(signal, 30000)
    // POST 轮询(MiniMax 风格)或 GET 轮询
    const method = config.extra.poll_method === 'GET' ? 'GET' : 'POST'
    const url =
      method === 'GET'
        ? `${config.baseURL}${path}?task_id=${encodeURIComponent(jobId)}`
        : `${config.baseURL}${path}`
    const res = await fetch(url, {
      method,
      headers: this.headers(config),
      ...(method === 'POST' ? { body: JSON.stringify({ task_id: jobId }) } : {}),
      signal: ts
    })
    if (!res.ok) {
      throw new HttpError(`轮询任务失败 ${res.status}`, res.status)
    }
    return (await res.json()) as Record<string, unknown>
  }
}
