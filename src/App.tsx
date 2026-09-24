import { useEffect, useState, useCallback, useRef } from 'react'
import Sidebar, { type MainView } from './Sidebar'
import ChatPanel from './ChatPanel'
import Canvas from './Canvas'
import Settings from './Settings'
import WorkflowList from './WorkflowList'
import WorkflowGenerator from './WorkflowGenerator'
import ExecutionPanel, { type ExecutionLogEntry } from './ExecutionPanel'

// ===== 渲染进程自包含类型 =====
interface ConversationItem {
  id: string
  title: string
  created_at: number
}
interface WorkflowItem {
  id: string
  name: string
  description: string | null
  pinned: number
  created_at: number
}
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
  const [activeView, setActiveView] = useState<MainView>('chat')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])

  const [spec, setSpec] = useState<WorkflowSpec | null>(null)
  const [nodeStatus, setNodeStatus] = useState<Record<string, string>>({})
  const [executionLog, setExecutionLog] = useState<ExecutionLogEntry[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [execCollapsed, setExecCollapsed] = useState(false)
  const [running, setRunning] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)

  const runCancelRef = useRef<(() => void) | null>(null)

  // ===== 加载数据列表 =====
  const loadConversations = useCallback(async () => {
    try {
      setConversations(await window.dubhe.db.conversations.list())
    } catch (err) {
      console.error('加载对话列表失败:', err)
    }
  }, [])

  const loadWorkflows = useCallback(async () => {
    try {
      setWorkflows(await window.dubhe.db.workflows.list())
    } catch (err) {
      console.error('加载工作流列表失败:', err)
    }
  }, [])

  useEffect(() => {
    window.dubhe.getAppInfo().then(setInfo).catch(console.error)
    loadConversations()
    loadWorkflows()
  }, [loadConversations, loadWorkflows])

  // ===== 侧边栏回调 =====
  const handleNewConversation = useCallback(async () => {
    const id = await window.dubhe.db.conversations.create('新对话')
    await loadConversations()
    setActiveConversationId(id)
    setActiveView('chat')
  }, [loadConversations])

  const handleConversationClick = useCallback((id: string) => {
    setActiveConversationId(id)
    setActiveView('chat')
  }, [])

  const handleNewWorkflow = useCallback(() => {
    setSpec(null)
    setExecutionLog([])
    setNodeStatus({})
    setActiveView('workflow-editor')
  }, [])

  const handleWorkflowClick = useCallback(async (id: string) => {
    try {
      const result = await window.dubhe.db.workflows.get(id)
      if (result?.revision?.spec_json) {
        const specJson = JSON.parse(
          typeof result.revision.spec_json === 'string'
            ? result.revision.spec_json
            : JSON.stringify(result.revision.spec_json)
        ) as WorkflowSpec
        setSpec(specJson)
      }
      setExecutionLog([])
      setNodeStatus({})
      setActiveView('workflow-editor')
    } catch (err) {
      console.error('加载工作流失败:', err)
    }
  }, [])

  const handleWorkflowListClick = useCallback(() => {
    setActiveView('workflow-list')
  }, [])

  const handleSettingsClick = useCallback(() => {
    setActiveView('settings')
  }, [])

  // ===== 工作流生成 =====
  const handleGenerated = useCallback((newSpec: object) => {
    setSpec(newSpec as WorkflowSpec)
    setExecutionLog([])
    setNodeStatus({})
  }, [])

  const handleGenerate = useCallback(async (task: string) => {
    setGenerating(true)
    try {
      const result = await window.dubhe.spec.generate(task)
      if (result.spec) {
        setSpec(result.spec as WorkflowSpec)
        setExecutionLog([])
        setNodeStatus({})
      }
      await loadWorkflows()
      return result
    } finally {
      setGenerating(false)
    }
  }, [loadWorkflows])

  // ===== 工作流执行 =====
  const runWorkflow = useCallback(() => {
    if (!spec) return
    setRunning(true)
    setNodeStatus({})
    setExecutionLog([])
    setSelectedNodeId(null)

    const cancel = window.dubhe.spec.run(
      { spec: spec as object, input: {} },
      (event) => {
        const e = event as {
          type: string
          nodeId?: string
          nodeType?: string
          output?: Record<string, unknown>
          error?: string
        }
        if (e.type === 'step_start' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'running' }))
          setExecutionLog((log) => [
            ...log,
            {
              nodeId: e.nodeId!,
              nodeType: e.nodeType ?? '',
              status: 'running',
              timestamp: Date.now()
            }
          ])
        }
        if (e.type === 'step_done' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'succeeded' }))
          const outputText =
            (e.output?.text as string) ??
            (e.output?.patch as string) ??
            JSON.stringify(e.output ?? {}, null, 2)
          setExecutionLog((log) =>
            log.map((entry) =>
              entry.nodeId === e.nodeId
                ? { ...entry, status: 'succeeded' as const, output: outputText }
                : entry
            )
          )
        }
        if (e.type === 'step_failed' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'failed' }))
          setExecutionLog((log) =>
            log.map((entry) =>
              entry.nodeId === e.nodeId
                ? { ...entry, status: 'failed' as const, error: e.error ?? '未知错误' }
                : entry
            )
          )
        }
      },
      () => {
        setRunning(false)
        runCancelRef.current = null
      },
      (error) => {
        setRunning(false)
        runCancelRef.current = null
        setExecutionLog((log) => [
          ...log,
          {
            nodeId: 'run',
            nodeType: 'run',
            status: 'failed',
            error,
            timestamp: Date.now()
          }
        ])
      }
    )
    runCancelRef.current = cancel
  }, [spec])

  const stopRun = useCallback(() => {
    runCancelRef.current?.()
    setRunning(false)
  }, [])

  // ===== 工作流列表回调 =====
  const handleWorkflowPin = useCallback(
    async (id: string) => {
      await window.dubhe.db.workflows.togglePin(id)
      await loadWorkflows()
    },
    [loadWorkflows]
  )

  const handleWorkflowDelete = useCallback(
    async (id: string) => {
      await window.dubhe.db.workflows.delete(id)
      await loadWorkflows()
    },
    [loadWorkflows]
  )

  return (
    <div className="app">
      <header className="app__topbar">
        <div className="app__brand">
          <span className="app__logo">枢</span>
          <div className="app__title-group">
            <h1 className="app__title">DubheFlow · 天枢</h1>
            <span className="app__subtitle">
              {spec ? spec.goal : 'Godot 游戏开发一体化工作站'}
            </span>
          </div>
        </div>
      </header>

      <div className="app__content">
        <Sidebar
          conversations={conversations}
          workflows={workflows}
          activeConversationId={activeConversationId}
          activeView={activeView}
          onConversationClick={handleConversationClick}
          onNewConversation={handleNewConversation}
          onWorkflowClick={handleWorkflowClick}
          onNewWorkflow={handleNewWorkflow}
          onWorkflowListClick={handleWorkflowListClick}
          onSettingsClick={handleSettingsClick}
        />

        <main className="app__main">
          {activeView === 'chat' && (
            <div className="split-view">
              <section className="panel panel--chat">
                <div className="panel__header">对话</div>
                <ChatPanel
                  conversationId={activeConversationId}
                  onGenerateWorkflow={handleGenerate}
                  generating={generating}
                />
              </section>
              <div className="split-view__right">
                <section className="panel panel--canvas">
                  <div className="panel__header">
                    画布
                    {spec && !running && (
                      <button className="panel__action" onClick={runWorkflow}>
                        ▶ 执行
                      </button>
                    )}
                    {running && (
                      <button className="panel__action panel__action--danger" onClick={stopRun}>
                        ⏹ 停止
                      </button>
                    )}
                  </div>
                  <Canvas
                    spec={spec}
                    nodeStatus={nodeStatus}
                    onNodeClick={setSelectedNodeId}
                    selectedNodeId={selectedNodeId}
                  />
                </section>
                <ExecutionPanel
                  log={executionLog}
                  collapsed={execCollapsed}
                  onToggle={() => setExecCollapsed((v) => !v)}
                  selectedNodeId={selectedNodeId}
                  onNodeSelect={setSelectedNodeId}
                />
              </div>
            </div>
          )}

          {activeView === 'workflow-list' && (
            <WorkflowList
              workflows={workflows}
              onOpen={handleWorkflowClick}
              onPin={handleWorkflowPin}
              onDelete={handleWorkflowDelete}
              onNew={handleNewWorkflow}
            />
          )}

          {activeView === 'workflow-editor' && (
            <div className="split-view">
              <section className="panel panel--wf-gen">
                <div className="panel__header">生成工作流</div>
                <WorkflowGenerator onGenerated={handleGenerated} generating={generating} />
              </section>
              <div className="split-view__right">
                <section className="panel panel--canvas">
                  <div className="panel__header">
                    画布
                    {spec && !running && (
                      <button className="panel__action" onClick={runWorkflow}>
                        ▶ 执行
                      </button>
                    )}
                    {running && (
                      <button className="panel__action panel__action--danger" onClick={stopRun}>
                        ⏹ 停止
                      </button>
                    )}
                  </div>
                  <Canvas
                    spec={spec}
                    nodeStatus={nodeStatus}
                    onNodeClick={setSelectedNodeId}
                    selectedNodeId={selectedNodeId}
                  />
                </section>
                <ExecutionPanel
                  log={executionLog}
                  collapsed={execCollapsed}
                  onToggle={() => setExecCollapsed((v) => !v)}
                  selectedNodeId={selectedNodeId}
                  onNodeSelect={setSelectedNodeId}
                />
              </div>
            </div>
          )}

          {activeView === 'settings' && (
            <section className="panel panel--settings">
              <Settings />
            </section>
          )}
        </main>
      </div>

      <footer className="app__statusbar">
        {info ? (
          <span>
            天枢 v{info.version} · Electron {info.electron} · Node {info.node} · {info.platform}
            {running ? ' · 执行中…' : ''}
            {generating ? ' · 生成中…' : ''}
          </span>
        ) : (
          <span>加载中…</span>
        )}
      </footer>
    </div>
  )
}
