// DB IPC:对话 / 工作流 / 消息 数据访问层
// renderer 全走 IPC,主进程独占 DB 句柄(设计 §9.1④)
import { ipcMain } from 'electron'
import { prepare } from '../db/database'

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function registerDbIpc(): void {
  // ===== 对话 =====
  ipcMain.handle('db:conversations:list', async () => {
    return prepare('SELECT id, title, kind, created_at FROM conversation ORDER BY created_at DESC').all()
  })

  ipcMain.handle('db:conversations:create', async (_e, title: string) => {
    const id = genId('conv')
    prepare(
      'INSERT INTO conversation (id, title, kind, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, title || '新对话', 'chat', Date.now())
    return id
  })

  ipcMain.handle('db:conversations:delete', async (_e, convId: string) => {
    prepare('DELETE FROM message WHERE conversation_id = ?').run(convId)
    prepare('DELETE FROM conversation WHERE id = ?').run(convId)
    return true
  })

  ipcMain.handle('db:conversations:rename', async (_e, convId: string, title: string) => {
    prepare('UPDATE conversation SET title = ? WHERE id = ?').run(title, convId)
    return true
  })

  // ===== 消息 =====
  ipcMain.handle('db:messages:list', async (_e, convId: string) => {
    return prepare(
      'SELECT id, role, content, model, tokens, created_at FROM message WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(convId)
  })

  ipcMain.handle(
    'db:messages:create',
    async (_e, convId: string, role: string, content: string, model?: string, tokens?: number) => {
      const id = genId('msg')
      prepare(
        'INSERT INTO message (id, conversation_id, role, content, model, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, convId, role, content, model ?? null, tokens ?? null, Date.now())
      return id
    }
  )

  // ===== 工作流 =====
  ipcMain.handle('db:workflows:list', async () => {
    return prepare(
      'SELECT id, name, description, tags, status, pinned, created_at FROM workflow WHERE status = ? ORDER BY pinned DESC, created_at DESC'
    ).all('active')
  })

  ipcMain.handle('db:workflows:get', async (_e, workflowId: string) => {
    const wf = prepare('SELECT * FROM workflow WHERE id = ?').get(workflowId)
    if (!wf) return null
    const rev = prepare(
      'SELECT id, version, spec_json, state, created_at FROM workflow_revision WHERE workflow_id = ? ORDER BY version DESC LIMIT 1'
    ).get(workflowId)
    return { workflow: wf, revision: rev }
  })

  ipcMain.handle('db:workflows:togglePin', async (_e, workflowId: string) => {
    const wf = prepare('SELECT pinned FROM workflow WHERE id = ?').get(workflowId) as {
      pinned?: number
    } | undefined
    const newPinned = wf?.pinned ? 0 : 1
    prepare('UPDATE workflow SET pinned = ? WHERE id = ?').run(newPinned, workflowId)
    return newPinned === 1
  })

  ipcMain.handle('db:workflows:delete', async (_e, workflowId: string) => {
    prepare('DELETE FROM workflow_revision WHERE workflow_id = ?').run(workflowId)
    prepare('DELETE FROM workflow WHERE id = ?').run(workflowId)
    return true
  })

  ipcMain.handle(
    'db:workflows:rename',
    async (_e, workflowId: string, name: string, description?: string) => {
      if (description !== undefined) {
        prepare('UPDATE workflow SET name = ?, description = ? WHERE id = ?').run(
          name,
          description,
          workflowId
        )
      } else {
        prepare('UPDATE workflow SET name = ? WHERE id = ?').run(name, workflowId)
      }
      return true
    }
  )
}
