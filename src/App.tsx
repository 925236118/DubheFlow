import { useEffect, useState, useCallback, useRef } from 'react'
import Sidebar, { type MainView } from './Sidebar'
import Canvas from './Canvas'
import Settings from './Settings'
import WorkflowList from './WorkflowList'
import WorkflowGenerator from './WorkflowGenerator'
import ChatView from './ChatView'
import ExecutionPanel, { type ExecutionLogEntry } from './ExecutionPanel'

type RunStatus = 'idle' | 'running' | 'succeeded' | 'failed'

interface ConversationItem { id: string; title: string; created_at: number }
interface WorkflowItem { id: string; name: string; description: string | null; pinned: number; created_at: number }
interface SpecNode { id: string; type: string; args: Record<string, unknown> }
interface WorkflowSpec { id: string; goal: string; nodes: SpecNode[]; edges: [string, string][]; budget: { max_cost: number } }

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
  const [info, setInfo] = useState<AppInfo | null>(null)

  // 执行状态
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [askUserQuestions, setAskUserQuestions] = useState<unknown[] | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  // 对话页工作流选择
  const [chatWorkflowId, setChatWorkflowId] = useState<string | null>(null)

  const runCancelRef = useRef<(() => void) | null>(null)

  // ===== 加载列表 =====
  const loadConversations = useCallback(async () => {
    try { setConversations(await window.dubhe.db.conversations.list()) } catch (e) { console.error(e) }
  }, [])
  const loadWorkflows = useCallback(async () => {
    try { setWorkflows(await window.dubhe.db.workflows.list()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    window.dubhe.getAppInfo().then(setInfo).catch(console.error)
    loadConversations()
    loadWorkflows()
  }, [loadConversations, loadWorkflows])

  // ===== 侧边栏回调 =====
  const handleNewConversation = useCallback(async () => {
    // 先切换视图,确保即使 DB 失败也能回到对话页
    setChatWorkflowId(null)
    setActiveView('chat')
    try {
      const id = await window.dubhe.db.conversations.create('新对话')
      await loadConversations()
      setActiveConversationId(id)
    } catch (err) { console.error('创建对话失败:', err) }
  }, [loadConversations])

  const handleConversationClick = useCallback((id: string) => {
    setActiveConversationId(id)
    setChatWorkflowId(null)
    setActiveView('chat')
  }, [])

  const handleNewWorkflow = useCallback(() => {
    setSpec(null); setExecutionLog([]); setNodeStatus({}); setRunStatus('idle')
    setActiveView('workflow-editor')
  }, [])

  const handleWorkflowClick = useCallback(async (id: string) => {
    try {
      const result = await window.dubhe.db.workflows.get(id)
      if (result?.revision?.spec_json) {
        setSpec(JSON.parse(
          typeof result.revision.spec_json === 'string'
            ? result.revision.spec_json : JSON.stringify(result.revision.spec_json)
        ) as WorkflowSpec)
      }
      setExecutionLog([]); setNodeStatus({}); setRunStatus('idle')
      setActiveView('workflow-editor')
    } catch (err) { console.error('加载工作流失败:', err) }
  }, [])

  // ===== 对话页选择工作流 =====
  const handleChatWorkflowSelect = useCallback(async (id: string | null) => {
    setChatWorkflowId(id)
    setRunStatus('idle'); setNodeStatus({}); setExecutionLog([]); setAskUserQuestions(null)
    if (id) {
      try {
        const result = await window.dubhe.db.workflows.get(id)
        if (result?.revision?.spec_json) {
          setSpec(JSON.parse(
            typeof result.revision.spec_json === 'string'
              ? result.revision.spec_json : JSON.stringify(result.revision.spec_json)
          ) as WorkflowSpec)
        }
      } catch (err) { console.error('加载工作流失败:', err) }
    } else {
      setSpec(null)
    }
  }, [])

  // ===== 工作流生成 =====
  const handleGenerated = useCallback(async (newSpec: object) => {
    setSpec(newSpec as WorkflowSpec)
    setExecutionLog([]); setNodeStatus({}); setRunStatus('idle')
    await loadWorkflows()
  }, [loadWorkflows])

  // ===== 工作流执行(共享)=====
  const runWorkflow = useCallback((input: string = '') => {
    if (!spec) return
    setRunStatus('running')
    setNodeStatus({})
    setExecutionLog([])
    setAskUserQuestions(null)
    setSelectedNodeId(null)

    const { cancel, runId } = window.dubhe.spec.run(
      { spec: spec as object, input: input ? { task: input } : {} },
      (event) => {
        const e = event as { type: string; nodeId?: string; nodeType?: string; output?: Record<string, unknown>; error?: string; questions?: unknown[] }
        if (e.type === 'step_start' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'running' }))
          setExecutionLog((log) => [...log, { nodeId: e.nodeId!, nodeType: e.nodeType ?? '', status: 'running' as const, timestamp: Date.now() }])
        }
        if (e.type === 'step_done' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'succeeded' }))
          const out = (e.output?.text as string) ?? (e.output?.patch as string) ?? JSON.stringify(e.output ?? {}, null, 2)
          setExecutionLog((log) => log.map(en => en.nodeId === e.nodeId ? { ...en, status: 'succeeded' as const, output: out } : en))
        }
        if (e.type === 'step_failed' && e.nodeId) {
          setNodeStatus((s) => ({ ...s, [e.nodeId!]: 'failed' }))
          setExecutionLog((log) => log.map(en => en.nodeId === e.nodeId ? { ...en, status: 'failed' as const, error: e.error ?? '未知错误' } : en))
        }
        if (e.type === 'ask_user' && e.questions) {
          setAskUserQuestions(e.questions)
          setActiveRunId(runId)
        }
        if (e.type === 'run_done') { setRunStatus('succeeded') }
        if (e.type === 'run_failed') { setRunStatus('failed') }
      },
      () => { setRunStatus('succeeded'); runCancelRef.current = null },
      (error) => {
        setRunStatus('failed'); runCancelRef.current = null
        setExecutionLog((log) => [...log, { nodeId: 'run', nodeType: 'run', status: 'failed' as const, error, timestamp: Date.now() }])
      }
    )
    runCancelRef.current = cancel
  }, [spec])

  const stopRun = useCallback(() => {
    runCancelRef.current?.()
    setRunStatus('idle')
    setAskUserQuestions(null)
  }, [])

  // ===== ask_user 响应 =====
  const handleAskUserRespond = useCallback((answers: Record<string, string>) => {
    if (activeRunId) {
      window.dubhe.spec.respond(activeRunId, answers).catch(console.error)
    }
    setAskUserQuestions(null)
  }, [activeRunId])

  // ===== 工作流列表回调 =====
  const handleWorkflowPin = useCallback(async (id: string) => {
    await window.dubhe.db.workflows.togglePin(id); await loadWorkflows()
  }, [loadWorkflows])
  const handleWorkflowDelete = useCallback(async (id: string) => {
    await window.dubhe.db.workflows.delete(id); await loadWorkflows()
  }, [loadWorkflows])

  // ===== 画布操作栏 =====
  const canvasActions = (
    <>
      {spec && runStatus !== 'running' && (
        <button className="panel__action" onClick={() => runWorkflow('')}>▶ 执行</button>
      )}
      {runStatus === 'running' && (
        <button className="panel__action panel__action--danger" onClick={stopRun}>⏹ 停止</button>
      )}
    </>
  )

  return (
    <div className="app">
      <header className="app__topbar">
        <div className="app__brand">
          <span className="app__logo">枢</span>
          <div className="app__title-group">
            <h1 className="app__title">DubheFlow · 天枢</h1>
            <span className="app__subtitle">{spec ? spec.goal : 'Godot 游戏开发一体化工作站'}</span>
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
          onShowConversations={() => { setChatWorkflowId(null); setActiveView('chat') }}
          onWorkflowClick={handleWorkflowClick}
          onNewWorkflow={handleNewWorkflow}
          onWorkflowListClick={() => setActiveView('workflow-list')}
          onSettingsClick={() => setActiveView('settings')}
        />

        <main className="app__main">
          {activeView === 'chat' && (
            <div className="split-view">
              <section className="panel panel--chat">
                <div className="panel__header">对话</div>
                <ChatView
                  workflows={workflows}
                  chatWorkflowId={chatWorkflowId}
                  onSelectWorkflow={handleChatWorkflowSelect}
                  onNewWorkflow={handleNewWorkflow}
                  conversationId={activeConversationId}
                  runStatus={runStatus}
                  executionLog={executionLog}
                  askUserQuestions={askUserQuestions}
                  onAskUserRespond={handleAskUserRespond}
                  onRun={runWorkflow}
                  onStop={stopRun}
                />
              </section>
              <div className="split-view__right">
                <section className="panel panel--canvas">
                  <div className="panel__header">画布 {canvasActions}</div>
                  <Canvas spec={spec} nodeStatus={nodeStatus} onNodeClick={setSelectedNodeId} selectedNodeId={selectedNodeId} />
                </section>
                <ExecutionPanel log={executionLog} collapsed={execCollapsed} onToggle={() => setExecCollapsed(v => !v)} selectedNodeId={selectedNodeId} onNodeSelect={setSelectedNodeId} />
              </div>
            </div>
          )}

          {activeView === 'workflow-list' && (
            <WorkflowList workflows={workflows} onOpen={handleWorkflowClick} onPin={handleWorkflowPin} onDelete={handleWorkflowDelete} onNew={handleNewWorkflow} />
          )}

          {activeView === 'workflow-editor' && (
            <div className="split-view">
              <section className="panel panel--wf-gen">
                <div className="panel__header">生成工作流</div>
                <WorkflowGenerator onGenerated={handleGenerated} />
              </section>
              <div className="split-view__right">
                <section className="panel panel--canvas">
                  <div className="panel__header">画布 {canvasActions}</div>
                  <Canvas spec={spec} nodeStatus={nodeStatus} onNodeClick={setSelectedNodeId} selectedNodeId={selectedNodeId} />
                </section>
                <ExecutionPanel log={executionLog} collapsed={execCollapsed} onToggle={() => setExecCollapsed(v => !v)} selectedNodeId={selectedNodeId} onNodeSelect={setSelectedNodeId} />
              </div>
            </div>
          )}

          {activeView === 'settings' && (
            <section className="panel panel--settings"><Settings /></section>
          )}
        </main>
      </div>

      <footer className="app__statusbar">
        {info ? (
          <span>
            天枢 v{info.version} · Electron {info.electron} · Node {info.node} · {info.platform}
            {runStatus === 'running' ? ' · 执行中…' : ''}
          </span>
        ) : <span>加载中…</span>}
      </footer>
    </div>
  )
}
