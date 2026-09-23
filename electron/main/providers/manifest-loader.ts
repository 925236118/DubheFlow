// manifest 加载器:从 <userData>/services/{builtin,user} 读取 YAML manifest
// 首次运行时把 app 内置 manifest 种子化到 userData(随工作站分发,见 §8.12)
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readdirSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { getAppPaths } from '../paths'
import type { ServiceManifest } from './manifest'

/** app 内置 manifest 源目录(dev: 项目根/resources; 打包: process.resourcesPath) */
function builtinSourceDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'services', 'builtin')
  }
  // dev: electron-vite 从项目根运行
  return join(process.cwd(), 'resources', 'services', 'builtin')
}

/** 首次运行:把内置 manifest 复制到 userData(内置 manifest 随工作站更新,总是覆盖) */
export function seedBuiltinManifests(): void {
  const src = builtinSourceDir()
  const dest = getAppPaths().servicesBuiltin
  if (!existsSync(src)) return
  mkdirSync(dest, { recursive: true })
  for (const file of readdirSync(src)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
    // 内置 manifest 总是覆盖(它们由工作站分发,用户自定义走 services/user/)
    copyFileSync(join(src, file), join(dest, file))
  }
}

/** 加载所有已启用的服务 manifest */
export function loadManifests(): ServiceManifest[] {
  const paths = getAppPaths()
  const manifests: ServiceManifest[] = []
  for (const dir of [paths.servicesBuiltin, paths.servicesUser]) {
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue
      try {
        const content = readFileSync(join(dir, file), 'utf-8')
        const manifest = parseYaml(content) as ServiceManifest
        if (manifest?.id && manifest?.nodes) {
          manifests.push(manifest)
        }
      } catch (err) {
        console.error(`[manifest] 解析失败 ${file}:`, err)
      }
    }
  }
  return manifests
}

/** 按 manifest id 查找 */
export function findManifest(manifests: ServiceManifest[], id: string): ServiceManifest | null {
  return manifests.find((m) => m.id === id) ?? null
}
