import { useState } from 'react'
import AskUserForm from './AskUserForm'
import type { ExecutionLogEntry } from './ExecutionPanel'

type RunStatus = 'idle' | 'running' | 'succeeded' | 'failed'

interface WorkflowItem {
  id: string
  name: string
  description: string | null
  pinned: number
}

interface WorkflowRunnerProps {
  workflows: WorkflowItem[]
  selectedWorkflowId: string | null
  onSelectWorkflow: (id: string | null) => void
  runStatus: RunStatus
  askUserQuestions: unknown[] | null
  onAskUserRespond: (answers: Record<string, string>) => void
  executionLog: ExecutionLogEntry[]
  onRun: (input: string) => void
  onStop: () => void
}

const STATUS_CONFIG: Record<RunStatus, { label: string; color: string; icon: string }> = {
  idle: { label: '未开始', color: '#5f6377', icon: '○' },
  running: { label: '执行中', color: '#6c8cff', icon: '◐' },
  succeeded: { label: '已成功', color: '#4ade80', icon: '✓' },
  failed: { label: '已失败', color: '#ff6b6b', icon: '✕' }
}

export default function WorkflowRunner({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  runStatus,
  askUserQuestions,
  onAskUserRespond,
  executionLog,
  onRun,
  onStop
}: WorkflowRunnerProps) {
  const [input, setInput] = useState('')
  const cfg = STATUS_CONFIG[runStatus]
  const hasWorkflow = selectedWorkflowId !== null
  const running = runStatus === 'running'

  return (
    <div className="wf-runner">
      {/* 工作流选择器 */}
      <div className="wf-runner__selector">
        <label className="wf-runner__label">选择工作流</label>
        <select
          className="wf-runner__select"
          value={selectedWorkflowId ?? ''}
          disabled={running}
          onChange={(e) => onSelectWorkflow(e.target.value || null)}
        >
          <option value="">— 无工作流(普通对话)—</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.pinned ? '★ ' : ''}
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {!hasWorkflow ? (
        <div className="wf-runner__empty">
          <p>选择一个工作流来执行,或切换到普通对话模式。</p>
        </div>
      ) : (
        <>
          {/* 状态卡片 */}
          <div
            className={`wf-runner__status wf-runner__status--${runStatus}`}
            style={{ borderColor: cfg.color }}
          >
            <span className="wf-runner__status-icon" style={{ color: cfg.color }}>
              {cfg.icon}
            </span>
            <span className="wf-runner__status-label" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>

          {/* 输入区(未开始时) */}
          {runStatus === 'idle' && (
            <div className="wf-runner__input-area">
              <label className="wf-runner__label">输入(传入工作流的第一个参数)</label>
              <textarea
                className="wf-runner__input"
                placeholder="描述你的需求…"
                rows={4}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                className="btn btn--primary"
                onClick={() => onRun(input)}
                disabled={!input.trim()}
              >
                ▶ 开始执行
              </button>
            </div>
          )}

          {/* 执行中:停止按钮 */}
          {running && (
            <button className="btn btn--danger" onClick={onStop}>
              ⏹ 停止执行
            </button>
          )}

          {/* ask_user 交互问题 */}
          {running && askUserQuestions && (
            <AskUserForm
              questions={askUserQuestions as never}
              onRespond={onAskUserRespond}
            />
          )}

          {/* 执行日志(精简版) */}
          {(running || runStatus === 'succeeded' || runStatus === 'failed') &&
            executionLog.length > 0 && (
              <div className="wf-runner__log">
                <div className="wf-runner__log-title">执行步骤</div>
                {executionLog.map((entry, i) => (
                  <div key={i} className={`wf-runner__log-entry exec-entry--${entry.status}`}>
                    <span className="exec-entry__dot exec-entry__dot--${entry.status}" />
                    <span className="wf-runner__log-node">{entry.nodeId}</span>
                    <span className="wf-runner__log-type">{entry.nodeType}</span>
                    {entry.output && (
                      <pre className="wf-runner__log-output">{entry.output.slice(0, 200)}</pre>
                    )}
                    {entry.error && (
                      <span className="wf-runner__log-error">{entry.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

          {/* 完成后:重新执行 */}
          {(runStatus === 'succeeded' || runStatus === 'failed') && (
            <button
              className="btn"
              onClick={() => {
                setInput('')
                onSelectWorkflow(selectedWorkflowId) // 重置状态
              }}
            >
              ↻ 重新执行
            </button>
          )}
        </>
      )}
    </div>
  )
}
