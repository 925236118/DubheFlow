/// <reference types="vite/client" />

// 应用环境信息
interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  isPackaged: boolean
}

// Provider 信息
interface ProviderInfo {
  id: string
  name: string
  locality: 'local' | 'remote'
  capabilities: string[]
  description: string
  authFields: {
    key: string
    label: string
    secret: boolean
    required: boolean
    placeholder: string
  }[]
}

interface RoutingTable {
  [capability: string]: string
}

interface ChatResult {
  content: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  } | null
}

// 聊天请求(对齐 main 侧 InvokeRequest 的子集)
interface ChatRequest {
  capability: string
  messages: { role: string; content: string }[]
  model?: string
  provider?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  json?: boolean
}

// preload 通过 contextBridge 暴露的 API
interface DubheApi {
  getAppInfo: () => Promise<AppInfo>
  platform: string

  provider: {
    list: () => Promise<ProviderInfo[]>
    keyStatus: (providerId: string) => Promise<{
      fields: Record<string, boolean>
      encryptionAvailable: boolean
    }>
    setKey: (providerId: string, field: string, value: string) => Promise<boolean>
    deleteKey: (providerId: string, field: string) => Promise<boolean>
    health: (providerId?: string) => Promise<
      Record<string, { available: boolean; message?: string }>
    >
    getRouting: () => Promise<RoutingTable>
    setRoute: (capability: string, providerId: string) => Promise<boolean>
    estimateCost: (req: ChatRequest) => Promise<{ money: number; seconds: number }>
    chat: (req: ChatRequest) => Promise<ChatResult>
    chatStream: (
      req: ChatRequest,
      onChunk: (delta: string) => void,
      onDone: () => void,
      onError: (error: string) => void
    ) => () => void
  }

  on: (channel: string, listener: (...args: unknown[]) => void) => () => void
}

interface Window {
  dubhe: DubheApi
}
