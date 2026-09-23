// 密钥管理:Electron safeStorage(走系统钥匙串)
// 安全红线:API key 绝不进 renderer 进程,不明文进 SQLite,只在主进程持有
// 存储格式:加密后的 buffer 落盘到 <userData>/secrets.enc,按 serviceId + field 索引
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const secretsFile = () => join(app.getPath('userData'), 'secrets.enc')

/** 读取加密存储(返回 key -> value 的明文 map) */
function readStore(): Record<string, string> {
  const file = secretsFile()
  if (!existsSync(file)) return {}
  if (!safeStorage.isEncryptionAvailable()) {
    // 加密不可用(如 Linux 缺 keyring):降级为明文 + 警告(仅开发期)
    console.warn('[keychain] safeStorage 不可用,降级明文存储')
    try {
      return JSON.parse(readFileSync(file, 'utf-8'))
    } catch {
      return {}
    }
  }
  try {
    const buf = readFileSync(file)
    const decrypted = safeStorage.decryptString(buf)
    return JSON.parse(decrypted)
  } catch {
    return {}
  }
}

/** 写入加密存储 */
function writeStore(store: Record<string, string>): void {
  const file = secretsFile()
  if (!safeStorage.isEncryptionAvailable()) {
    writeFileSync(file, JSON.stringify(store, null, 2), 'utf-8')
    return
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(store))
  writeFileSync(file, encrypted)
}

/** 密钥索引:serviceId + field */
function keyOf(serviceId: string, field: string): string {
  return `${serviceId}.${field}`
}

/** 存一个密钥 */
export function setSecret(serviceId: string, field: string, value: string): void {
  const store = readStore()
  store[keyOf(serviceId, field)] = value
  writeStore(store)
}

/** 取一个密钥 */
export function getSecret(serviceId: string, field: string): string | null {
  return readStore()[keyOf(serviceId, field)] ?? null
}

/** 删除一个密钥 */
export function deleteSecret(serviceId: string, field: string): void {
  const store = readStore()
  delete store[keyOf(serviceId, field)]
  writeStore(store)
}

/** 列出某服务所有密钥字段(用于健康检查 / 调试) */
export function listSecrets(serviceId: string): Record<string, string> {
  const store = readStore()
  const result: Record<string, string> = {}
  const prefix = `${serviceId}.`
  for (const [k, v] of Object.entries(store)) {
    if (k.startsWith(prefix)) {
      result[k.slice(prefix.length)] = v
    }
  }
  return result
}

/** 判断 safeStorage 加密是否可用 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}
