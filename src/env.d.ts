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

  spec: {
    generate: (task: string) => Promise<{
      spec: object | null
      validation: { ok: boolean; errors: { severity: string; nodeId?: string; message: string }[] }
      rawResponse: string
    }>
    run: (
      options: {
        spec: object
        input: Record<string, unknown>
        globals?: Record<string, unknown>
      },
      onEvent: (event: { type: string; nodeId?: string; [key: string]: unknown }) => void,
      onDone: () => void,
      onError: (error: string) => void
    ) => { cancel: () => void; runId: string }

    respond: (runId: string, answers: Record<string, unknown>) => Promise<boolean>
  }

  git: {
    status: (projectPath: string) => Promise<{
      isRepo: boolean
      branch: string | null
      clean: boolean
    }>
    diff: (projectPath: string, commit?: string) => Promise<string>
    diffStat: (projectPath: string, commit?: string) => Promise<string>
    branches: (projectPath: string) => Promise<string[]>
  }

  db: {
    conversations: {
      list: () => Promise<{ id: string; title: string; kind: string; created_at: number }[]>
      create: (title: string) => Promise<string>
      delete: (convId: string) => Promise<boolean>
      rename: (convId: string, title: string) => Promise<boolean>
    }
    messages: {
      list: (
        convId: string
      ) => Promise<
        {
          id: string
          role: string
          content: string
          model: string | null
          tokens: number | null
          created_at: number
        }[]
      >
      create: (
        convId: string,
        role: string,
        content: string,
        model?: string,
        tokens?: number
      ) => Promise<string>
    }
    workflows: {
      list: () => Promise<
        {
          id: string
          name: string
          description: string | null
          tags: string | null
          status: string
          pinned: number
          created_at: number
        }[]
      >
      get: (
        workflowId: string
      ) => Promise<{ workflow: Record<string, unknown>; revision: Record<string, unknown> | null } | null>
      togglePin: (workflowId: string) => Promise<boolean>
      delete: (workflowId: string) => Promise<boolean>
      rename: (workflowId: string, name: string, description?: string) => Promise<boolean>
    }
  }
}

interface Window {
  dubhe: DubheApi
}
