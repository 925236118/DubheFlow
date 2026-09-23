// Provider 注册表 + 路由表
// 对齐设计 §8.3:capability → 路由表查出 provider → 调用
// 路由表用户可编辑(可把 coding 从 DeepSeek 换成别的),切换不影响任何工作流
import type {
  Capability,
  ChatChunk,
  CostEstimate,
  HealthStatus,
  InvokeRequest,
  ModelProvider
} from './types'
import type { ServiceManifest } from './manifest'
import { DeepSeekProvider } from './deepseek'

export type ProviderFactory = (manifest: ServiceManifest) => ModelProvider

// 已知的 provider 工厂(后续接入新服务只需在此注册)
const factories: Record<string, ProviderFactory> = {
  deepseek: (m) => new DeepSeekProvider(m)
}

// 默认路由表:capability → provider id
const DEFAULT_ROUTING: Partial<Record<Capability, string>> = {
  coding: 'deepseek',
  text: 'deepseek',
  vision: 'deepseek',
  reasoning: 'deepseek'
  // image/video/music/speech → 待 MiniMax 等接入
  // classify/extract/embedding → 待 llama.cpp 接入
}

/** 根据一个 capability 查询它支持的 provider 列表(用于设置页下拉) */
export function providersForCapability(
  providers: Map<string, ModelProvider>,
  cap: Capability
): ModelProvider[] {
  return [...providers.values()].filter((p) => p.capabilities.includes(cap))
}

export class ProviderRegistry {
  private providers = new Map<string, ModelProvider>()
  private manifests = new Map<string, ServiceManifest>()
  private routing: Partial<Record<Capability, string>> = { ...DEFAULT_ROUTING }

  /** 从 manifest 列表构建所有 provider */
  init(manifests: ServiceManifest[]): void {
    this.providers.clear()
    this.manifests.clear()
    for (const manifest of manifests) {
      const factory = factories[manifest.id]
      if (!factory) {
        console.warn(`[registry] 未知服务 manifest: ${manifest.id},跳过`)
        continue
      }
      try {
        const provider = factory(manifest)
        this.providers.set(provider.id, provider)
        this.manifests.set(manifest.id, manifest)
      } catch (err) {
        console.error(`[registry] 初始化 provider ${manifest.id} 失败:`, err)
      }
    }
    // 清理路由表里已不存在的 provider 绑定
    for (const [cap, pid] of Object.entries(this.routing)) {
      if (pid && !this.providers.has(pid)) {
        delete this.routing[cap as Capability]
      }
    }
  }

  /** 获取 manifest(用于查询 auth 字段等元数据) */
  getManifest(providerId: string): ServiceManifest | null {
    return this.manifests.get(providerId) ?? null
  }

  /** 列出所有 provider(用于设置页/健康检查) */
  list(): ModelProvider[] {
    return [...this.providers.values()]
  }

  get(providerId: string): ModelProvider | null {
    return this.providers.get(providerId) ?? null
  }

  /** 路由:capability → provider */
  resolve(capability: Capability): ModelProvider | null {
    const pid = this.routing[capability]
    if (pid) {
      const provider = this.providers.get(pid)
      if (provider) return provider
    }
    // 兜底:找第一个支持该 capability 的 provider
    for (const p of this.providers.values()) {
      if (p.capabilities.includes(capability)) {
        this.routing[capability] = p.id
        return p
      }
    }
    return null
  }

  /** 用户编辑路由表:把 capability 绑到某 provider */
  setRoute(capability: Capability, providerId: string): void {
    this.routing[capability] = providerId
  }

  /** 读取当前路由表(持久化/设置页用) */
  getRouting(): Partial<Record<Capability, string>> {
    return { ...this.routing }
  }

  /** 通用入口:按 req.capability 路由后调用 */
  async *invoke(req: InvokeRequest, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const provider =
      (req.provider && this.get(req.provider)) || this.resolve(req.capability)
    if (!provider) {
      throw new Error(
        `没有可用的 provider 来处理 capability="${req.capability}"。请在设置中接入相应服务。`
      )
    }
    yield* provider.invoke(req, signal)
  }

  /** 预估成本(路由后委托给具体 provider) */
  estimateCost(req: InvokeRequest): CostEstimate {
    const provider =
      (req.provider && this.get(req.provider)) || this.resolve(req.capability)
    if (!provider) return { money: 0, seconds: 0 }
    return provider.estimateCost(req)
  }

  /** 健康检查所有 provider */
  async healthCheckAll(signal?: AbortSignal): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {}
    await Promise.all(
      this.list().map(async (p) => {
        results[p.id] = await p.healthCheck(signal).catch((err) => ({
          available: false,
          message: err instanceof Error ? err.message : String(err)
        }))
      })
    )
    return results
  }
}

// 单例
export const registry = new ProviderRegistry()
