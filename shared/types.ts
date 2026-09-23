// 主进程与渲染进程共享的类型定义
// 通过 @shared/* 路径别名在两侧引用

/** 应用环境信息,由主进程通过 app:info IPC 返回 */
export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  isPackaged: boolean
}
