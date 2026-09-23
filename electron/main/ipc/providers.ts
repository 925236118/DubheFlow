// Provider IPC 处理器
// 安全红线:密钥只在主进程,renderer 只能设置/查询是否已设置,不能读取明文
// 流式聊天:renderer 传 streamId,主进程通过 webContents.send 推 chunk
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { registry } from '../providers/registry'
import {
  setSecret,
  getSecret,
  listSecrets,
  isEncryptionAvailable
} from '../security/keychain'
import type { InvokeRequest } from '../providers/types'

// 活跃的流式调用(支持取消)
const activeStreams = new Map<string, AbortController>()

export function registerProviderIpc(): void {
  // ===== 列出所有 provider 及能力 =====
  ipcMain.handle('provider:list', () => {
    return registry.list().map((p) => {
      const manifest = registry.getManifest(p.id)
      return {
        id: p.id,
        name: p.name,
        locality: p.locality,
        capabilities: p.capabilities,
        description: manifest?.description ?? '',
        authFields:
          manifest?.auth.fields.map((f) => ({
            key: f.key,
            label: f.label,
            secret: f.secret,
            required: f.required ?? false,
            placeholder: f.placeholder ?? ''
          })) ?? []
      }
    })
  })

  // ===== 密钥:查询某 provider 是否已配置 key =====
  ipcMain.handle('provider:hasKey', (_e, providerId: string, field: string) => {
    return getSecret(providerId, field) != null
  })

  // ===== 密钥:列出某 provider 已配置的字段(只返回是否存在,不返回值) =====
  ipcMain.handle('provider:keyStatus', (_e, providerId: string) => {
    const secrets = listSecrets(providerId)
    const result: Record<string, boolean> = {}
    for (const field of Object.keys(secrets)) {
      result[field] = true
    }
    return { fields: result, encryptionAvailable: isEncryptionAvailable() }
  })

  // ===== 密钥:设置(key 进 safeStorage,永不回传 renderer) =====
  ipcMain.handle(
    'provider:setKey',
    (_e, providerId: string, field: string, value: string) => {
      setSecret(providerId, field, value)
      return true
    }
  )

  // ===== 密钥:删除 =====
  ipcMain.handle('provider:deleteKey', (_e, providerId: string, field: string) => {
    setSecret(providerId, field, '') // 空字符串视为删除
    return true
  })

  // ===== 健康检查(始终返回 Record<providerId, HealthStatus>,UI 统一取 results[id])=====
  ipcMain.handle('provider:health', async (_e, providerId?: string) => {
    if (providerId) {
      const p = registry.get(providerId)
      if (!p) return { [providerId]: { available: false, message: 'provider 不存在' } }
      return { [providerId]: await p.healthCheck() }
    }
    return registry.healthCheckAll()
  })

  // ===== 路由表 =====
  ipcMain.handle('provider:routing:get', () => registry.getRouting())

  ipcMain.handle('provider:routing:set', (_e, capability: string, providerId: string) => {
    registry.setRoute(capability as any, providerId)
    return true
  })

  // ===== 成本预估 =====
  ipcMain.handle('provider:estimateCost', (_e, req: InvokeRequest) => {
    return registry.estimateCost(req)
  })

  // ===== 非流式聊天(健康检查/轻量场景) =====
  ipcMain.handle('provider:chat', async (_e, req: InvokeRequest) => {
    // 暂用流式收集后返回;后续可优化为直接非流式
    let content = ''
    let usage = null
    for await (const chunk of registry.invoke({ ...req, stream: true })) {
      if (chunk.delta) content += chunk.delta
      if (chunk.usage) usage = chunk.usage
    }
    return { content, usage }
  })

  // ===== 流式聊天 =====
  ipcMain.handle(
    'provider:chatStream',
    async (event: IpcMainInvokeEvent, { req, streamId }: { req: InvokeRequest; streamId: string }) => {
      const controller = new AbortController()
      activeStreams.set(streamId, controller)
      const win = event.sender

      try {
        for await (const chunk of registry.invoke({ ...req, stream: true }, controller.signal)) {
          if (win.isDestroyed()) break
          win.send('provider:chunk', { streamId, chunk })
        }
        if (!win.isDestroyed()) {
          win.send('provider:done', { streamId })
        }
      } catch (err) {
        if (!win.isDestroyed()) {
          win.send('provider:error', {
            streamId,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      } finally {
        activeStreams.delete(streamId)
      }
    }
  )

  // ===== 取消流式调用 =====
  ipcMain.handle('provider:cancel', (_e, streamId: string) => {
    activeStreams.get(streamId)?.abort()
    activeStreams.delete(streamId)
    return true
  })
}
