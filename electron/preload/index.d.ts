// 此文件提供 renderer 侧对 preload 暴露 API 的类型提示
import type { DubheApi } from './index'

declare global {
  interface Window {
    dubhe: DubheApi
  }
}

export {}
