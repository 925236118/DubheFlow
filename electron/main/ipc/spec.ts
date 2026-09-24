// Spec IPC 处理器:Planner 生成 + Interpreter 执行
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { generateSpec } from '../spec/planner'
import { runSpec, type RunOptions } from '../spec/interpreter'
import { registry } from '../providers/registry'
import { prepare } from '../db/database'

// 活跃的运行(支持取消)
const activeRuns = new Map<string, AbortController>()
// 待回答的 ask_user(阻塞等待用户响应)
const pendingResponses = new Map<
  string,
  (answers: Record<string, unknown>) => void
>()

export function registerSpecIpc(): void {
  // ===== Planner:从任务描述生成 spec =====
  ipcMain.handle('planner:generate', async (_e, task: string) => {
    // 收集所有已接入 provider 的 capability
    const capabilities = registry
      .list()
      .flatMap((p) => p.capabilities)
    // 去重
    const uniqueCaps = [...new Set(capabilities)] as never[]

    // 适配 registry.invoke 为 planner 所需的函数签名
    const invokeProvider = (req: any) =>
      Promise.resolve(registry.invoke(req))

    const result = await generateSpec(task, invokeProvider, uniqueCaps)

    // 如果生成成功,存入 DB(草稿态 revision)
    if (result.spec) {
      try {
        const wfId = result.spec.id
        const revId = `rev_${Date.now()}`
        prepare(
          `INSERT OR IGNORE INTO workflow (id, name, status, created_at) VALUES (?, ?, 'active', ?)`
        ).run(wfId, result.spec.goal ?? wfId, Date.now())
        prepare(
          `INSERT INTO workflow_revision (id, workflow_id, version, spec_json, state, created_at)
           VALUES (?, ?, ?, ?, 'draft', ?)`
        ).run(revId, wfId, 1, JSON.stringify(result.spec), Date.now())
      } catch (err) {
        console.error('[db] 存储 spec 失败:', err)
      }
    }

    return result
  })

  // ===== Interpreter:执行 spec(流式事件)=====
  ipcMain.handle(
    'interpreter:run',
    async (event: IpcMainInvokeEvent, { options, runId }: { options: RunOptions; runId: string }) => {
      const controller = new AbortController()
      activeRuns.set(runId, controller)
      const win = event.sender

      // 适配 registry.invoke 为 interpreter 所需的 deps
      const deps = {
        invokeProvider: (req: any, signal?: AbortSignal) =>
          registry.invoke(req, signal),
        // ask_user 阻塞:创建 promise,等 UI 通过 interpreter:respond 回传答案
        askUser: (_questions: unknown[]) =>
          new Promise<Record<string, unknown>>((resolve) => {
            pendingResponses.set(runId, resolve)
          })
      }

      // 创建 run 记录
      try {
        prepare(
          `INSERT INTO run (id, revision_id, status, inputs_json, budget_json, started_at)
           VALUES (?, 'draft', 'running', ?, ?, ?)`
        ).run(runId, JSON.stringify(options.input), JSON.stringify(options.spec.budget), Date.now())
      } catch (err) {
        console.error('[db] 创建 run 记录失败:', err)
      }

      try {
        for await (const evt of runSpec(options, deps, controller.signal)) {
          if (win.isDestroyed()) break
          win.send('interpreter:event', { runId, event: evt })

          // 更新 run 状态
          if (evt.type === 'run_done') {
            prepare(`UPDATE run SET status = 'succeeded', finished_at = ? WHERE id = ?`).run(
              Date.now(),
              runId
            )
          }
          if (evt.type === 'run_failed') {
            prepare(`UPDATE run SET status = 'failed', finished_at = ? WHERE id = ?`).run(
              Date.now(),
              runId
            )
          }
        }
        if (!win.isDestroyed()) {
          win.send('interpreter:done', { runId })
        }
      } catch (err) {
        if (!win.isDestroyed()) {
          win.send('interpreter:error', {
            runId,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      } finally {
        activeRuns.delete(runId)
        pendingResponses.delete(runId)
      }
    }
  )

  // ===== 取消运行 =====
  ipcMain.handle('interpreter:cancel', (_e, runId: string) => {
    activeRuns.get(runId)?.abort()
    activeRuns.delete(runId)
    // 清理待回答的问题(给空答案避免 promise 悬挂)
    pendingResponses.get(runId)?.({})
    pendingResponses.delete(runId)
    return true
  })

  // ===== 用户回答 ask_user 问题 =====
  ipcMain.handle(
    'interpreter:respond',
    (_e, { runId, answers }: { runId: string; answers: Record<string, unknown> }) => {
      const resolve = pendingResponses.get(runId)
      if (resolve) {
        resolve(answers)
        pendingResponses.delete(runId)
      }
      return true
    }
  )
}
