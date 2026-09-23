import { useEffect, useState } from 'react'
import ChatPanel from './ChatPanel'
import Settings from './Settings'

type View = 'chat' | 'canvas' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('chat')
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.dubhe.getAppInfo().then(setInfo).catch(console.error)
  }, [])

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
            画布
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
              <ChatPanel />
            </section>
            <section className="panel panel--canvas">
              <div className="panel__header">画布</div>
              <div className="panel__content panel__content--placeholder">
                <p>只读画布占位(v0 将接入 React Flow)</p>
              </div>
            </section>
          </>
        )}
        {view === 'canvas' && (
          <section className="panel">
            <div className="panel__header">画布</div>
            <div className="panel__content panel__content--placeholder">
              <p>React Flow 画布将在 v0 串联阶段接入</p>
            </div>
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
    <span
      className={`app__nav-item ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      {children}
    </span>
  )
}
