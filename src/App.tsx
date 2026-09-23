import { useEffect, useState, useCallback } from 'react'
import ChatPanel from './ChatPanel'
import Settings from './Settings'
import Canvas from './Canvas'

type View = 'chat' | 'canvas' | 'settings'

// 渲染进程自包含的最小 spec 类型
interface SpecNode {
  id: string
  type: string
  args: Record<string, unknown>
}
interface WorkflowSpec {
  id: string
  goal: string
  nodes: SpecNode[]
  edges: [string, string][]
  budget: { max_cost: number }
}

export default function App() {
  const [view, setView] = useState<View>('chat')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [spec, setSpec] = useState<WorkflowSpec | null>(null)
  const [nodeStatus, setNodeStatus] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    window.dubhe.getAppInfo().then(setInfo).catch(console.error)
  }, [])

  // ===== 生成工作流(Planner)=====
  const generateWorkflow = useCallback(async (task: string) => {
    setGenerating(true)
    setView('chat')
    try {
      const result = await window.dubhe.spec.generate(task)
      if (result.spec) {
        setSpec(result.spec as WorkflowSpec)
        setNodeStatus({})
        setView('chat') // 留在对话,但画布已更新
      }
      return result
    } finally {
      setGenerating(false)
    }
  }, [])

  // ===== 执行工作流(Interpreter)=====
  const runWorkflow = useCallback(() => {
    if (!spec) return
    setRunning(true)
    setNodeStatus({})
    const cancel = window.dubhe.spec.run(
      { spec: spec as object, input: {} },
      (event) => {
        const e = event as { type: string; nodeId?: string; output?: Record<string, unknown> }
        if (e.type === 'step_start' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'running' }))
        }
        if (e.type === 'step_done' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'succeeded' }))
        }
        if (e.type === 'step_failed' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'failed' }))
        }
      },
      () => {
        setRunning(false)
      },
      () => {
        setRunning(false)
      }
    )
    return cancel
  }, [spec])

  return (
    <div className="app">
      <header className="app__topbar">
        <div className="app__brand">
          <span className="app__logo">枢</span>
          <div className="app__title-group">
            <h1 className="app__title">DubheFlow · 天枢</h1>
            <span className="app__subtitle">Godot 游戏开发一体化工作站</span>
          </div>
        </div>
        <nav className="app__nav">
          <NavButton active={view === 'chat'} onClick={() => setView('chat')}>
            对话
          </NavButton>
          <NavButton active={view === 'canvas'} onClick={() => setView('canvas')}>
            画布{spec ? ' ●' : ''}
          </NavButton>
          <NavButton active={view === 'settings'} onClick={() => setView('settings')}>
            设置
          </NavButton>
        </nav>
      </header>

      <main className="app__body">
        {view === 'chat' && (
          <>
            <section className="panel panel--chat">
              <div className="panel__header">对话</div>
              <ChatPanel onGenerateWorkflow={generateWorkflow} generating={generating} />
            </section>
            <section className="panel panel--canvas">
              <div className="panel__header">
                画布
                {spec && !running && (
                  <button className="panel__action" onClick={runWorkflow}>
                    ▶ 执行
                  </button>
                )}
              </div>
              <Canvas spec={spec} nodeStatus={nodeStatus} />
            </section>
          </>
        )}
        {view === 'canvas' && (
          <section className="panel">
            <div className="panel__header">
              画布
              {spec && !running && (
                <button className="panel__action" onClick={runWorkflow}>
                  ▶ 执行
                </button>
              )}
            </div>
            <Canvas spec={spec} nodeStatus={nodeStatus} />
          </section>
        )}
        {view === 'settings' && (
          <section className="panel panel--settings">
            <Settings />
          </section>
        )}
      </main>

      <footer className="app__statusbar">
        {info ? (
          <span>
            天枢 v{info.version} · Electron {info.electron} · Node {info.node} · {info.platform}
            {running ? ' · 执行中…' : ''}
          </span>
        ) : (
          <span>加载中…</span>
        )}
      </footer>
    </div>
  )
}

function NavButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <span className={`app__nav-item ${active ? 'is-active' : ''}`} onClick={onClick}>
      {children}
    </span>
  )
}
