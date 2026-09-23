// Git 快照 IPC 处理器
// renderer 走 IPC 获取 diff / 分支列表 / 状态
import { ipcMain } from 'electron'
import { createGitOps } from '../vcs/git'

export function registerGitIpc(): void {
  // ===== git 状态(是否仓库、是否干净、当前分支)=====
  ipcMain.handle('git:status', async (_e, projectPath: string) => {
    const git = createGitOps(projectPath)
    const isRepo = await git.isRepo()
    if (!isRepo) {
      return { isRepo: false, branch: null, clean: false }
    }
    const [branch, clean] = await Promise.all([git.getCurrentBranch(), git.isClean()])
    return { isRepo: true, branch, clean }
  })

  // ===== git diff(可指定 commit)=====
  ipcMain.handle('git:diff', async (_e, projectPath: string, commit?: string) => {
    const git = createGitOps(projectPath)
    return git.diff(commit)
  })

  // ===== diff --stat =====
  ipcMain.handle('git:diffStat', async (_e, projectPath: string, commit?: string) => {
    const git = createGitOps(projectPath)
    return git.diffStat(commit)
  })

  // ===== 列出 agent 分支 =====
  ipcMain.handle('git:branches', async (_e, projectPath: string) => {
    const git = createGitOps(projectPath)
    return git.listAgentBranches()
  })
}
