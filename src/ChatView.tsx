import { useState, useRef, useCallback, useEffect } from 'react'
import AskUserForm from './AskUserForm'
import type { ExecutionLogEntry } from './ExecutionPanel'

type RunStatus = 'idle' | 'running' | 'succeeded' | 'failed'

interface WorkflowItem { id: string; name: string; pinned: number }
interface Message { role: 'user' | 'assistant'; content: string; streaming?: boolean; error?: boolean }

interface ChatViewProps {
  // 工作流选择
  workflows: WorkflowItem[]
  chatWorkflowId: string | null
  onSelectWorkflow: (id: string | null) => void
  onNewWorkflow: () => void
  // 对话
  conversationId: string | null
  // 执行状态(由 App 管理)
  runStatus: RunStatus
  executionLog: ExecutionLogEntry[]
  askUserQuestions: unknown[] | null
  onAskUserRespond: (answers: Record<string, string>) => void
  onRun: (input: string) => void
  onStop: () => void
}

const SCROLL_THRESHOLD = 80
const MIN_TA = 78
const MAX_TA = 138

const STATUS_TEXT: Record<RunStatus, string> = {
  idle: '未开始',
  running: '执行中…',
  succeeded: '✓ 执行成功',
  failed: '✕ 执行失败'
}

export default function ChatView({
  workflows, chatWorkflowId, onSelectWorkflow, onNewWorkflow,
  conversationId, runStatus, executionLog, askUserQuestions,
  onAskUserRespond, onRun, onStop
}: ChatViewProps) {
  // ===== 聊天状态 =====
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)
  const fullContentRef = useRef('')

  // ===== 滚动 =====
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const autoScrollRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [showPopup, setShowPopup] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // ===== 点击弹出外部关闭 =====
  useEffect(() => {
    if (!showPopup) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (popupRef.current && !popupRef.current.contains(t) &&
          barRef.current && !barRef.current.contains(t)) {
        setShowPopup(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPopup])

  // ===== 加载对话历史 =====
  useEffect(() => {
    if (!conversationId) { setMessages([]); return }
    window.dubhe.db.messages.list(conversationId).then(msgs => {
      setMessages(msgs.map(m => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content
      })))
    }).catch(console.error)
  }, [conversationId])

  // ===== 输入框自适应 =====
  const adjustTa = useCallback(() => {
    const el = taRef.current; if (!el) return
    el.style.height = 'auto'
    const h = Math.min(Math.max(el.scrollHeight, MIN_TA), MAX_TA)
    el.style.height = h + 'px'
    el.style.overflowY = el.scrollHeight > MAX_TA ? 'auto' : 'hidden'
  }, [])
  useEffect(() => { adjustTa() }, [input, adjustTa])

  // ===== 智能滚动 =====
  const handleScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
    autoScrollRef.current = atBottom
    setShowJump(!atBottom)
  }, [])

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  })

  // ===== 模式判断 =====
  const isWorkflow = chatWorkflowId !== null
  const running = runStatus === 'running'
  const canSend = input.trim().length > 0

  // ===== 发送(聊天模式)=====
  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput(''); setBusy(true); autoScrollRef.current = true

    const history = messages.filter(m => !m.streaming && !m.error)
      .map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => [...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true }
    ])

    fullContentRef.current = ''
    if (conversationId)
      window.dubhe.db.messages.create(conversationId, 'user', text).catch(console.error)

    const cancel = window.dubhe.provider.chatStream(
      { capability: 'coding', messages: [...history, { role: 'user', content: text }], temperature: 0 },
      (delta) => {
        fullContentRef.current += delta
        setMessages(prev => {
          const next = [...prev]; const last = next[next.length - 1]
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + delta }
          return next
        })
      },
      () => {
        if (conversationId && fullContentRef.current)
          window.dubhe.db.messages.create(conversationId, 'assistant', fullContentRef.current).catch(console.error)
        setMessages(prev => { const n = [...prev]; const l = n[n.length-1]; if (l) n[n.length-1] = { ...l, streaming: false }; return n })
        setBusy(false); cancelRef.current = null
      },
      (error) => {
        setMessages(prev => { const n = [...prev]; const l = n[n.length-1]
          if (l?.role === 'assistant') n[n.length-1] = { ...l, content: error, streaming: false, error: true }
          return n })
        setBusy(false); cancelRef.current = null
      }
    )
    cancelRef.current = cancel
  }, [input, busy, messages, conversationId])

  // ===== 重试 =====
  const retry = useCallback((idx: number) => {
    if (busy) return
    const userMsg = messages[idx - 1]
    if (!userMsg || userMsg.role !== 'user') return
    setMessages(prev => prev.slice(0, idx - 1))
    send()
  }, [busy, messages, send])

  // ===== 主按钮行为 =====
  const handleMainAction = () => {
    if (isWorkflow) {
      if (running) onStop()
      else onRun(input)
    } else {
      send()
    }
  }

  // 按钮文案
  let btnLabel = '发送'
  let btnClass = 'btn btn--primary'
  let btnDisabled = !canSend
  if (isWorkflow) {
    if (running) { btnLabel = '⏹ 停止'; btnClass = 'btn btn--danger'; btnDisabled = false }
    else { btnLabel = '▶ 执行'; btnDisabled = !canSend }
  } else if (busy) { btnLabel = '⏹ 停止'; btnClass = 'btn btn--danger'; btnDisabled = false }

  const stop = () => { if (isWorkflow) onStop(); else { cancelRef.current?.(); setBusy(false) } }

  return (
    <div className="chat-view">
      {/* 工作流选择栏(始终显示) */}
      <div className="chat-view__bar" ref={barRef}>
        <button
          className={`chat-view__mode ${!isWorkflow ? 'is-active' : ''}`}
          disabled={running}
          onClick={() => onSelectWorkflow(null)}
        >
          💬 普通对话
        </button>
        {isWorkflow ? (
          <>
            <span className="chat-view__bar-sep">|</span>
            <span className="chat-view__wf-name">
              {workflows.find((w) => w.id === chatWorkflowId)?.name ?? chatWorkflowId}
            </span>
            <button
              className="chat-view__pick"
              disabled={running}
              onClick={() => setShowPopup(true)}
            >
              选择其他工作流
            </button>
          </>
        ) : (
          <>
            <span className="chat-view__bar-sep">|</span>
            <button className="chat-view__pick" onClick={() => setShowPopup(true)}>
              选择工作流
            </button>
          </>
        )}
        {isWorkflow && (
          <span className={`chat-view__status chat-view__status--${runStatus}`}>
            {STATUS_TEXT[runStatus]}
          </span>
        )}
      </div>

      {/* 工作流选择弹出列表 */}
      {showPopup && (
        <div className="wf-popup" ref={popupRef}>
          {workflows.length === 0 ? (
            <div className="wf-popup__empty">暂无工作流</div>
          ) : (
            workflows.map((w) => (
              <div
                key={w.id}
                className={`wf-popup__item ${w.id === chatWorkflowId ? 'is-active' : ''}`}
                onClick={() => { onSelectWorkflow(w.id); setShowPopup(false) }}
              >
                <span className="wf-popup__icon">{w.pinned ? '★' : '⚡'}</span>
                <span className="wf-popup__name">{w.name}</span>
              </div>
            ))
          )}
          <div
            className="wf-popup__item wf-popup__item--new"
            onClick={() => { onNewWorkflow(); setShowPopup(false) }}
          >
            <span className="wf-popup__icon">+</span>
            <span className="wf-popup__name">生成新工作流</span>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div className="chat-view__content" ref={scrollRef} onScroll={handleScroll}>
        {/* 聊天模式:消息列表 */}
        {!isWorkflow && (
          <>
            {messages.length === 0 && (
              <div className="chat-view__empty">
                <p>输入消息与 AI 对话,或选择上方工作流执行。</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg msg--${m.role} ${m.error ? 'msg--error' : ''}`}>
                <div className="msg__role">{m.role === 'user' ? '你' : m.error ? '错误' : '天枢'}</div>
                <div className="msg__content">{m.content}{m.streaming && <span className="msg__cursor">▋</span>}</div>
                {m.error && !busy && <button className="msg__retry" onClick={() => retry(i)}>↻ 重试</button>}
              </div>
            ))}
          </>
        )}

        {/* 工作流模式:执行状态 + 日志 */}
        {isWorkflow && (
          <>
            {/* 状态卡片 */}
            <div className={`chat-view__card chat-view__card--${runStatus}`}>
              <span className="chat-view__card-status">{STATUS_TEXT[runStatus]}</span>
            </div>

            {/* ask_user 交互表单 */}
            {running && askUserQuestions && (
              <AskUserForm questions={askUserQuestions as never} onRespond={onAskUserRespond} />
            )}

            {/* 执行日志 */}
            {(running || runStatus === 'succeeded' || runStatus === 'failed') && executionLog.length > 0 && (
              <div className="chat-view__log">
                {executionLog.map((e, i) => (
                  <div key={i} className={`exec-entry exec-entry--${e.status}`}>
                    <div className="exec-entry__header">
                      <span className={`exec-entry__dot exec-entry__dot--${e.status}`} />
                      <span className="exec-entry__node">{e.nodeId}</span>
                      <span className="exec-entry__type">{e.nodeType}</span>
                    </div>
                    {e.output && <pre className="exec-entry__text">{e.output}</pre>}
                    {e.error && <div className="exec-entry__error">{e.error}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* 空闲提示 */}
            {runStatus === 'idle' && (
              <div className="chat-view__empty">
                <p>已选择工作流。在下方输入参数,点「执行」开始。</p>
              </div>
            )}
          </>
        )}

        {showJump && (
          <button className="chat__jump" onClick={() => {
            autoScrollRef.current = true
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            setShowJump(false)
          }}>↓ 最新</button>
        )}
      </div>

      {/* 输入 + 按钮 */}
      <div className="chat-view__composer">
        <textarea
          ref={taRef}
          className="chat-view__input"
          placeholder={isWorkflow ? '输入工作流参数…' : '描述你的需求…(Shift+Enter 换行)'}
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleMainAction() }
          }}
        />
        {busy || running ? (
          <button className={btnClass} onClick={stop}>{btnLabel}</button>
        ) : (
          <button className={btnClass} onClick={handleMainAction} disabled={btnDisabled}>{btnLabel}</button>
        )}
      </div>
    </div>
  )
}
