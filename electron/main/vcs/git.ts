// Git 快照操作 —— 对齐设计《天枢-项目文件快照设计》
// 用项目自带 git:每 run 一个分支、每步一个 commit
// 铁律:永远不对用户分支执行 git reset --hard
// git diff 一份数据三处复用:验证证据 / 审批展示 / 回退粒度
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export class GitOps {
  constructor(private cwd: string) {}

  /** 执行 git 命令 */
  private async run(args: string[]): Promise<string> {
    try {
      const { stdout } = await exec('git', args, {
        cwd: this.cwd,
        maxBuffer: 10 * 1024 * 1024
      })
      return stdout.trim()
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string }
      throw new Error(`git ${args.join(' ')} 失败: ${e.stderr ?? e.message ?? ''}`)
    }
  }

  /** 检查是否是 git 仓库 */
  async isRepo(): Promise<boolean> {
    try {
      await this.run(['rev-parse', '--is-inside-work-tree'])
      return true
    } catch {
      return false
    }
  }

  /** 初始化 git 仓库(需用户同意) */
  async init(): Promise<void> {
    await this.run(['init'])
  }

  /** 当前 HEAD commit */
  async getHead(): Promise<string> {
    return this.run(['rev-parse', 'HEAD'])
  }

  /** 当前分支名 */
  async getCurrentBranch(): Promise<string> {
    return this.run(['rev-parse', '--abbrev-ref', 'HEAD'])
  }

  /** 工作区是否干净 */
  async isClean(): Promise<boolean> {
    const status = await this.run(['status', '--porcelain'])
    return status.length === 0
  }

  /** 提交所有改动(用于 run 前保存用户改动) */
  async commitAll(message: string): Promise<string> {
    await this.run(['add', '-A'])
    await this.run(['commit', '-m', message, '--allow-empty'])
    return this.getHead()
  }

  /** stash 当前改动 */
  async stash(): Promise<void> {
    await this.run(['stash', 'push', '-u'])
  }

  async stashPop(): Promise<void> {
    await this.run(['stash', 'pop'])
  }

  /** 创建并切换到 agent/run_<id> 分支 */
  async createRunBranch(runId: string): Promise<string> {
    const branch = `agent/${runId}`
    await this.run(['checkout', '-b', branch])
    return branch
  }

  /** 切回原分支 */
  async checkoutBranch(branch: string): Promise<void> {
    await this.run(['checkout', branch])
  }

  /** 删除 agent 分支(安全,因为是 Agent 建的) */
  async deleteBranch(branch: string): Promise<void> {
    await this.run(['branch', '-D', branch])
  }

  /** 提交当前改动,返回 commit hash */
  async commitStep(message: string): Promise<string> {
    await this.run(['add', '-A'])
    await this.run(['commit', '-m', message, '--allow-empty'])
    return this.getHead()
  }

  /** 打 tag(检查点锚点) */
  async tag(name: string, message?: string): Promise<void> {
    const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name]
    await this.run(args)
  }

  /** 获取 diff(可指定 commit) */
  async diff(commit?: string): Promise<string> {
    if (commit) {
      return this.run(['diff', `${commit}^..${commit}`])
    }
    return this.run(['diff', 'HEAD'])
  }

  /** diff --stat(改了哪些文件、各多少行) */
  async diffStat(commit?: string): Promise<string> {
    if (commit) {
      return this.run(['diff', '--stat', `${commit}^..${commit}`])
    }
    return this.run(['diff', '--stat', 'HEAD'])
  }

  /** revert 某个 commit(保留历史,不 reset --hard) */
  async revert(commit: string): Promise<void> {
    await this.run(['revert', '--no-edit', commit])
  }

  /** 检出某个 commit 的指定文件(选择性回退) */
  async checkoutFile(commit: string, filePath: string): Promise<void> {
    await this.run(['checkout', commit, '--', filePath])
  }

  /** 列出 agent 分支 */
  async listAgentBranches(): Promise<string[]> {
    const output = await this.run(['branch', '--list', 'agent/*'])
    return output
      .split('\n')
      .map((l) => l.trim().replace(/^\* /, ''))
      .filter(Boolean)
  }
}

/** 创建 GitOps 实例 */
export function createGitOps(cwd: string): GitOps {
  return new GitOps(cwd)
}
