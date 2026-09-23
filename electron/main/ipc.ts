import { ipcMain, app } from 'electron'

// 注册所有主进程 IPC 处理器
// 密钥、数据库、Provider 调用都通过这里暴露给 renderer
export function registerIpcHandlers(): void {
  ipcMain.handle('app:info', () => {
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      userData: app.getPath('userData'),
      isPackaged: app.isPackaged
    }
  })
}
