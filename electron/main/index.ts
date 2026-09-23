import { app, BrowserWindow, shell } from 'electron'
import { createWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { registerProviderIpc } from './ipc/providers'
import { getAppPaths } from './paths'
import { seedBuiltinManifests, loadManifests } from './providers/manifest-loader'
import { registry } from './providers/registry'

// 单实例锁:防止多开
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

app.on('second-instance', () => {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length > 0) {
    const win = windows[0]
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  // 1. 确保 userData 目录结构就绪
  getAppPaths()

  // 2. 种子化内置服务 manifest(DeepSeek 等),首次运行复制到 userData
  seedBuiltinManifests()

  // 3. 加载所有 manifest,初始化 Provider 注册表与路由表
  const manifests = loadManifests()
  registry.init(manifests)

  // 4. 注册 IPC(系统信息 + Provider)
  registerIpcHandlers()
  registerProviderIpc()

  // 5. 创建窗口
  createWindow()
})

// macOS: 点击 dock 图标时若无窗口则新建
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// 所有窗口关闭时退出(除 macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 随工作台关闭而关闭:预留 will-quit 清理钩子
// (后续在这里清理 llama-server、headless Godot 等子进程)
app.on('will-quit', () => {
  // TODO: 清理子进程、关闭句柄
})

// 外部链接用系统浏览器打开,不在应用内导航
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })
})
