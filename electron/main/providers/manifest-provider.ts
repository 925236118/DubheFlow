// 通用 ManifestProvider:按 manifest 的 adapter 字段委托给对应适配器
// 这是「接入一个服务 = 一份 manifest,代码零改动」的落点
// DeepSeek / MiniMax / Anthropic / 任何 OpenAI 兼容服务都只需一份 YAML
import type {
  Capability,
  ChatChunk,
  CostEstimate,
  HealthStatus,
  InvokeRequest,
  ModelProvider
} from './types'
import type { ServiceManifest, ManifestNode, CostModel } from './manifest'
import type { AdapterConfig } from './adapters/types'
import { getAdapter } from './adapters'
import { getSecret, listSecrets } from '../security/keychain'

interface CapabilityBinding {
  adapter: string
  adapterConfig: Record<string, unknown>
  cost?: CostModel
  exec?: NonNullable<ManifestNode['exec']>
}

export class ManifestProvider implements ModelProvider {
  readonly id: string
  readonly name: string
  readonly locality: 'local' | 'remote'
  readonly capabilities: Capability[]
  private bindings = new Map<Capability, CapabilityBinding>()
  private authType: string

  constructor(manifest: ServiceManifest) {
    this.id = manifest.id
    this.name = manifest.name
    this.locality = manifest.locality
    this.authType = manifest.auth.type
    this.capabilities = []
    for (const node of manifest.nodes) {
      if (!node.capability) continue
      this.bindings.set(node.capability, {
        adapter: node.adapter,
        adapterConfig: node.adapter_config,
        cost: node.cost,
        exec: node.exec
      })
      this.capabilities.push(node.capability)
    }
  }

  async *invoke(req: InvokeRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const binding = this.bindings.get(req.capability)
    if (!binding) {
      throw new Error(`服务 ${this.id} 不支持 capability="${req.capability}"`)
    }
    const adapter = getAdapter(binding.adapter)
    if (!adapter) {
      throw new Error(`未注册的适配器类型: ${binding.adapter}(manifest: ${this.id})`)
    }
    const config = this.buildConfig(binding, req.model)
    yield* adapter.chat(req, config, signal)
  }

  estimateCost(req: InvokeRequest): CostEstimate {
    const binding = this.bindings.get(req.capability)
    const cost = binding?.cost
    if (!cost || cost.model === 'free') {
      return { money: 0, seconds: 0 }
    }
    if (cost.model === 'per_token') {
      const inputChars = JSON.stringify(req.messages).length
      const inputTokens = Math.ceil(inputChars / 4)
      const outputTokens = req.maxTokens ?? 4096
      const per = cost.per || 1000000
      const money = (inputTokens * cost.input + outputTokens * cost.output) / per
      return { money: Math.round(money * 10000) / 10000, seconds: Math.ceil(outputTokens / 30) }
    }
    // per_unit(按张/秒/字符)
    return { money: cost.price, seconds: 60 }
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    if (this.authType === 'api_key') {
      const apiKey = getSecret(this.id, 'api_key')
      if (!apiKey) {
        return { available: false, message: 'API Key 未配置' }
      }
    }
    // 找第一个支持聊天探测的适配器(openai_chat / anthropic / openai_responses)
    const chatBinding = [...this.bindings.values()].find(
      (b) =>
        b.adapter === 'openai_chat' ||
        b.adapter === 'anthropic' ||
        b.adapter === 'openai_responses'
    )
    if (chatBinding) {
      try {
        const adapter = getAdapter(chatBinding.adapter)
        if (!adapter) return { available: false, message: `适配器 ${chatBinding.adapter} 未注册` }
        const config = this.buildConfig(chatBinding)
        await adapter.ping(config, signal)
        return { available: true }
      } catch (err) {
        return {
          available: false,
          message: err instanceof Error ? err.message : String(err)
        }
      }
    }
    // 没有聊天适配器(如纯 http_job 服务),用 ping 探测
    const firstBinding = [...this.bindings.values()][0]
    if (firstBinding) {
      try {
        const adapter = getAdapter(firstBinding.adapter)
        if (!adapter) return { available: false, message: `适配器 ${firstBinding.adapter} 未注册` }
        const config = this.buildConfig(firstBinding)
        await adapter.ping(config, signal)
        return { available: true }
      } catch (err) {
        return {
          available: false,
          message: err instanceof Error ? err.message : String(err)
        }
      }
    }
    return { available: true }
  }

  /** 从 binding + keychain 构造 AdapterConfig */
  private buildConfig(binding: CapabilityBinding, modelOverride?: string): AdapterConfig {
    const cfg = binding.adapterConfig
    const secrets = listSecrets(this.id)
    return {
      baseURL: String(cfg.base_url ?? ''),
      apiKey: secrets.api_key ?? '',
      model: modelOverride ?? String(cfg.model ?? ''),
      extra: cfg,
      secrets,
      rpm: 60,
      timeoutMs: (binding.exec?.timeout_seconds ?? 300) * 1000
    }
  }
}
