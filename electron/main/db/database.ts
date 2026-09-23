// SQLite 数据库单例
// 对齐设计 §9.1④:「Electron 主进程独占句柄,renderer 全走 IPC」
// WAL 模式 + busy_timeout 防止多写者冲突
//
// better-sqlite3 是 CJS native 模块:用 createRequire 惰性加载,
// 避免模块顶层 value import 在 ESM 互操作时触发 native 崩溃
import { createRequire } from 'node:module'
import { getDbPath } from '../paths'
import { runMigrations, getDbVersion } from './migrations'

const require = createRequire(import.meta.url)

// native 模块用 any 类型(native ABI 类型复杂,运行时已验证)
/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any = null

/** 获取数据库单例(首次调用时打开 + 初始化) */
export function getDb(): any {
  if (db) return db
  const Database = require('better-sqlite3')
  db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  console.log(`[db] SQLite 已就绪, schema v${getDbVersion(db)}, ${getDbPath()}`)
  return db
}

/** 关闭数据库(应用退出时调用) */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    console.log('[db] 已关闭')
  }
}

/** 事务辅助 */
export function transaction<T>(fn: (db: any) => T): T {
  const database = getDb()
  return database.transaction(fn)(database)
}

/** 预编译语句缓存 */
const stmtCache = new Map<string, any>()
export function prepare(sql: string): any {
  const database = getDb()
  let stmt = stmtCache.get(sql)
  if (!stmt) {
    stmt = database.prepare(sql)
    stmtCache.set(sql, stmt)
  }
  return stmt
}
