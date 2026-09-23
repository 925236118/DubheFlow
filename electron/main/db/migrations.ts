// 迁移机制:版本号递增,启动时自动 upgrade
// 每个迁移在事务中执行,记录到 schema_version 表

// 最小 DB 接口(与 database.ts 的 any 类型对齐,不依赖 @types)
interface DB {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    get: (...params: unknown[]) => any
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: number | bigint }
    all: <T = unknown>(...params: unknown[]) => T[]
  }
  transaction: (fn: () => void) => () => void
}
import { SCHEMA_V1 } from './schema'

interface Migration {
  version: number
  description: string
  up: (db: DB) => void
}

// 迁移列表(按版本递增,不可修改已发布的迁移)
const migrations: Migration[] = [
  {
    version: 1,
    description: '初始 schema:项目/对话/消息/工作流/版本/运行/步骤/模型调用/工具调用/审批/产物/回溯',
    up: (db) => {
      db.exec(SCHEMA_V1)
      db.prepare('INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, ?)').run(
        Date.now()
      )
    }
  }
]

/** 运行所有待执行的迁移 */
export function runMigrations(db: DB): void {
  // 确保 schema_version 表存在(首次运行)
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)'
  )

  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as {
    v: number | null
  }
  const currentVersion = row.v ?? 0

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue
    const run = db.transaction(() => {
      migration.up(db)
      db.prepare(
        'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)'
      ).run(migration.version, Date.now())
    })
    run()
    console.log(`[db] 迁移 v${migration.version}: ${migration.description}`)
  }
}

/** 获取当前 schema 版本 */
export function getDbVersion(db: DB): number {
  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as {
    v: number | null
  }
  return row.v ?? 0
}
