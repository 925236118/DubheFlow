// DeepSeek Provider 实现
// 基于 manifest 配置 + OpenAI 兼容客户端 + safeStorage 密钥
//
// capability → model 映射(从 manifest nodes 提取):
//   coding  → deepseek-chat
//   vision  → deepseek-chat (支持图片输入)
//   reasoning → deepseek-reasoner
import type {
  Capability,
  ChatChunk,
  CostEstimate,
  HealthStatus,
  InvokeRequest,
  ModelProvider
} from './types'
import { OpenAIClient } from './openai-client'
import { getSecret } from '../security/keychain'
import type { ServiceManifest, CostModel } from './manifest'

interface CapabilityBinding {
  model: string
  baseURL: string
  imageField?: string
  cost?: Extract<CostModel, { model: 'per_token' }>
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = 'deepseek'
  readonly name = 'DeepSeek'
  readonly locality = 'remote' as const
  readonly capabilities: Capability[] = ['coding', 'text', 'vision', 'reasoning']

  private bindings = new Map<Capability, CapabilityBinding>()
  private client: OpenAIClient | null = null

  constructor(manifest: ServiceManifest) {
    // 从 manifest nodes 提取 capability → model 绑定
    for (const node of manifest.nodes) {
      if (!node.capability) continue
      const cfg = node.adapter_config
      const model = String(cfg.model ?? '')
      const baseURL = String(cfg.base_url ?? 'https://api.deepseek.com')
      const imageField = cfg.image_field ? String(cfg.image_field) : undefined
      const cost = node.cost?.model === 'per_token' ? node.cost : undefined
      if (model) {
        this.bindings.set(node.capability, { model, baseURL, imageField, cost })
      }
    }
  }

  private getClient(): OpenAIClient {
    if (this.client) return this.client
    const apiKey = getSecret(this.id, 'api_key')
    if (!apiKey) {
      throw new Error(`DeepSeek API Key 未配置,请在设置中填入`)
    }
    const binding = this.bindings.get('coding') ?? [...this.bindings.values()][0]
    this.client = new OpenAIClient({
      baseURL: binding.baseURL,
      apiKey,
      defaultModel: binding.model,
      timeoutMs: 300_000,
      rpm: 60
    })
    return this.client
  }

  async *invoke(req: InvokeRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const client = this.getClient()
    // 显式 model 或按 capability 绑定
    const binding = this.bindings.get(req.capability)
    const model = req.model ?? binding?.model
    const enriched: InvokeRequest = {
      ...req,
      model,
      stream: req.stream ?? true
    }
    yield* client.chat(enriched, signal)
  }

  estimateCost(req: InvokeRequest): CostEstimate {
    const binding = this.bindings.get(req.capability)
    const cost = binding?.cost
    if (!cost) {
      return { money: 0, seconds: 0 }
    }
    // 粗估:输入 token ≈ 消息字符数 / 4;输出 ≈ maxTokens(默认 4096)
    const inputChars = JSON.stringify(req.messages).length
    const inputTokens = Math.ceil(inputChars / 4)
    const outputTokens = req.maxTokens ?? 4096
    const per = cost.per || 1000000
    const money =
      (inputTokens * cost.input + outputTokens * cost.output) / per
    return {
      money: Math.round(money * 10000) / 10000,
      seconds: Math.ceil(outputTokens / 30) // ~30 tok/s 粗估
    }
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const apiKey = getSecret(this.id, 'api_key')
    if (!apiKey) {
      return { available: false, message: 'API Key 未配置' }
    }
    try {
      const client = this.getClient()
      await client.chatOnce(
        {
          capability: 'coding',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 1
        },
        signal
      )
      return { available: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { available: false, message: msg }
    }
  }
}
