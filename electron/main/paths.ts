// 路径与目录约定:统一管理 userData 下的子目录
// 设计原则:模型文件、数据库、日志、服务 manifest 都落在 userData,不进安装包
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export interface AppPaths {
  userData: string
  services: string // <userData>/services/  服务 manifest(builtin + user)
  servicesBuiltin: string // <userData>/services/builtin/
  servicesUser: string // <userData>/services/user/
  db: string // <userData>/db/  SQLite 数据库
  logs: string // <userData>/logs/
  models: string // <userData>/models/  本地模型文件(llama.cpp)
}

let cached: AppPaths | null = null

/** 获取并确保所有约定目录存在 */
export function getAppPaths(): AppPaths {
  if (cached) return cached
  const userData = app.getPath('userData')
  const paths: AppPaths = {
    userData,
    services: join(userData, 'services'),
    servicesBuiltin: join(userData, 'services', 'builtin'),
    servicesUser: join(userData, 'services', 'user'),
    db: join(userData, 'db'),
    logs: join(userData, 'logs'),
    models: join(userData, 'models')
  }
  for (const dir of Object.values(paths)) {
    mkdirSync(dir, { recursive: true })
  }
  cached = paths
  return paths
}

export function getDbPath(): string {
  return join(getAppPaths().db, 'dubhe.db')
}
