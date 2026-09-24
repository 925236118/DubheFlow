// 执行输出面板:展示 Interpreter 每步的产出
// 解决「执行后看不到结果」的问题

export interface ExecutionLogEntry {
  nodeId: string
  nodeType: string
  status: 'running' | 'succeeded' | 'failed'
  output?: string
  error?: string
  timestamp: number
}

interface ExecutionPanelProps {
  log: ExecutionLogEntry[]
  collapsed: boolean
  onToggle: () => void
  selectedNodeId: string | null
  onNodeSelect: (nodeId: string) => void
}

export default function ExecutionPanel({
  log,
  collapsed,
  onToggle,
  selectedNodeId,
  onNodeSelect
}: ExecutionPanelProps) {
  const hasOutput = log.some((e) => e.output || e.error)

  return (
    <div className={`exec-panel ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="exec-panel__header" onClick={onToggle}>
        <span className="exec-panel__title">
          {collapsed ? '▸' : '▾'} 执行输出
        </span>
        <span className="exec-panel__count">{log.length} 步</span>
      </div>

      {!collapsed && (
        <div className="exec-panel__body">
          {log.length === 0 ? (
            <div className="exec-panel__empty">尚未执行</div>
          ) : (
            log.map((entry, i) => (
              <div
                key={i}
                className={`exec-entry exec-entry--${entry.status} ${
                  selectedNodeId === entry.nodeId ? 'is-selected' : ''
                }`}
                onClick={() => onNodeSelect(entry.nodeId)}
              >
                <div className="exec-entry__header">
                  <span className={`exec-entry__dot exec-entry__dot--${entry.status}`} />
                  <span className="exec-entry__node">{entry.nodeId}</span>
                  <span className="exec-entry__type">{entry.nodeType}</span>
                  <span className="exec-entry__status">{entry.status}</span>
                </div>
                {(entry.output || entry.error) && (
                  <div className="exec-entry__output">
                    {entry.error ? (
                      <span className="exec-entry__error">{entry.error}</span>
                    ) : (
                      <pre className="exec-entry__text">{entry.output}</pre>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          {!hasOutput && log.length > 0 && (
            <div className="exec-panel__hint">(节点产出为空或未捕获)</div>
          )}
        </div>
      )}
    </div>
  )
}
