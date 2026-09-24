import { contextBridge, ipcRenderer } from 'electron'

// 受控 IPC API:contextIsolation 开启下,renderer 只能通过此桥接触主进程能力
// 密钥、数据库、Provider 调用全部在主进程,renderer 走 IPC

// ===== Provider 相关类型(与 main 侧对齐,renderer 自包含)=====
interface ProviderInfo {
  id: string
  name: string
  locality: 'local' | 'remote'
  capabilities: string[]
}

interface RoutingTable {
  [capability: string]: string
}

interface ChatResult {
  content: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
}

const api = {
  // 系统信息
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  platform: process.platform,

  // 窗口控制(无框窗口)
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  },

  // ===== Provider =====
  provider: {
    list: (): Promise<ProviderInfo[]> => ipcRenderer.invoke('provider:list'),

    // 密钥(永不回传明文)
    keyStatus: (providerId: string) =>
      ipcRenderer.invoke('provider:keyStatus', providerId),
    setKey: (providerId: string, field: string, value: string) =>
      ipcRenderer.invoke('provider:setKey', providerId, field, value),
    deleteKey: (providerId: string, field: string) =>
      ipcRenderer.invoke('provider:deleteKey', providerId, field),

    // 健康检查
    health: (providerId?: string) => ipcRenderer.invoke('provider:health', providerId),

    // 路由表
    getRouting: (): Promise<RoutingTable> => ipcRenderer.invoke('provider:routing:get'),
    setRoute: (capability: string, providerId: string) =>
      ipcRenderer.invoke('provider:routing:set', capability, providerId),

    // 成本预估
    estimateCost: (req: unknown) => ipcRenderer.invoke('provider:estimateCost', req),

    // 非流式聊天
    chat: (req: unknown): Promise<ChatResult> => ipcRenderer.invoke('provider:chat', req),

    // 流式聊天:返回取消函数
    chatStream: (
      req: unknown,
      onChunk: (delta: string) => void,
      onDone: () => void,
      onError: (error: string) => void
    ): (() => void) => {
      const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2)}`

      const chunkListener = (
        _e: Electron.IpcRendererEvent,
        data: { streamId: string; chunk: { delta?: string } }
      ) => {
        if (data.streamId === streamId && data.chunk.delta) {
          onChunk(data.chunk.delta)
        }
      }
      const doneListener = (
        _e: Electron.IpcRendererEvent,
        data: { streamId: string }
      ) => {
        if (data.streamId === streamId) onDone()
      }
      const errorListener = (
        _e: Electron.IpcRendererEvent,
        data: { streamId: string; error: string }
      ) => {
        if (data.streamId === streamId) onError(data.error)
      }

      ipcRenderer.on('provider:chunk', chunkListener)
      ipcRenderer.on('provider:done', doneListener)
      ipcRenderer.on('provider:error', errorListener)
      ipcRenderer.invoke('provider:chatStream', { req, streamId })

      // 返回取消函数:移除监听 + 通知主进程中止
      return () => {
        ipcRenderer.removeListener('provider:chunk', chunkListener)
        ipcRenderer.removeListener('provider:done', doneListener)
        ipcRenderer.removeListener('provider:error', errorListener)
        ipcRenderer.invoke('provider:cancel', streamId)
      }
    }
  },

  // IPC 通用事件监听(后续用于运行状态推送等)
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      listener(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },

  // ===== Spec(工作流生成与执行)=====
  spec: {
    // Planner:从任务描述生成 spec
    generate: (task: string) => ipcRenderer.invoke('planner:generate', task),

    // Interpreter:执行 spec(流式事件)
    run: (
      options: unknown,
      onEvent: (event: unknown) => void,
      onDone: () => void,
      onError: (error: string) => void
    ): { cancel: () => void; runId: string } => {
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2)}`

      const eventListener = (
        _e: Electron.IpcRendererEvent,
        data: { runId: string; event: unknown }
      ) => {
        if (data.runId === runId) onEvent(data.event)
      }
      const doneListener = (
        _e: Electron.IpcRendererEvent,
        data: { runId: string }
      ) => {
        if (data.runId === runId) onDone()
      }
      const errorListener = (
        _e: Electron.IpcRendererEvent,
        data: { runId: string; error: string }
      ) => {
        if (data.runId === runId) onError(data.error)
      }

      ipcRenderer.on('interpreter:event', eventListener)
      ipcRenderer.on('interpreter:done', doneListener)
      ipcRenderer.on('interpreter:error', errorListener)
      ipcRenderer.invoke('interpreter:run', { options, runId })

      const cancel = () => {
        ipcRenderer.removeListener('interpreter:event', eventListener)
        ipcRenderer.removeListener('interpreter:done', doneListener)
        ipcRenderer.removeListener('interpreter:error', errorListener)
        ipcRenderer.invoke('interpreter:cancel', runId)
      }
      return { cancel, runId }
    },

    // 用户回答 ask_user 问题
    respond: (runId: string, answers: Record<string, unknown>) =>
      ipcRenderer.invoke('interpreter:respond', { runId, answers })
  },

  // ===== Git 快照 =====
  git: {
    status: (projectPath: string) => ipcRenderer.invoke('git:status', projectPath),
    diff: (projectPath: string, commit?: string) =>
      ipcRenderer.invoke('git:diff', projectPath, commit),
    diffStat: (projectPath: string, commit?: string) =>
      ipcRenderer.invoke('git:diffStat', projectPath, commit),
    branches: (projectPath: string) => ipcRenderer.invoke('git:branches', projectPath)
  },

  // ===== DB 数据访问层 =====
  db: {
    conversations: {
      list: () => ipcRenderer.invoke('db:conversations:list'),
      create: (title: string) => ipcRenderer.invoke('db:conversations:create', title),
      delete: (convId: string) => ipcRenderer.invoke('db:conversations:delete', convId),
      rename: (convId: string, title: string) =>
        ipcRenderer.invoke('db:conversations:rename', convId, title)
    },
    messages: {
      list: (convId: string) => ipcRenderer.invoke('db:messages:list', convId),
      create: (
        convId: string,
        role: string,
        content: string,
        model?: string,
        tokens?: number
      ) =>
        ipcRenderer.invoke('db:messages:create', convId, role, content, model, tokens)
    },
    workflows: {
      list: () => ipcRenderer.invoke('db:workflows:list'),
      get: (workflowId: string) => ipcRenderer.invoke('db:workflows:get', workflowId),
      togglePin: (workflowId: string) =>
        ipcRenderer.invoke('db:workflows:togglePin', workflowId),
      delete: (workflowId: string) => ipcRenderer.invoke('db:workflows:delete', workflowId),
      rename: (workflowId: string, name: string, description?: string) =>
        ipcRenderer.invoke('db:workflows:rename', workflowId, name, description)
    }
  }
} as const

export type DubheApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('dubhe', api)
  } catch (error) {
    console.error('preload contextBridge 暴露失败:', error)
  }
} else {
  // @ts-expect-error 直接挂全局(兜底,不推荐)
  window.dubhe = api
}
