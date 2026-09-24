import { ipcMain, app, BrowserWindow } from 'electron'

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

  // ===== 窗口控制(无框窗口)=====
  ipcMain.handle('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  ipcMain.handle('window:toggleMaximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })
}
