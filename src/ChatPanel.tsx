import { useState, useRef, useCallback, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  error?: boolean
}

// 距底部多少像素以内算"在底部",恢复自动滚动
const SCROLL_THRESHOLD = 80
// 输入框:3 行最小高度,6 行最大高度(13px * 1.5 行高 + padding/border)
const MIN_TA_HEIGHT = 78
const MAX_TA_HEIGHT = 138

export default function ChatPanel({
  onGenerateWorkflow,
  generating
}: {
  onGenerateWorkflow?: (task: string) => Promise<unknown>
  generating?: boolean
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [showJump, setShowJump] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ===== 输入框自适应高度 =====
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.min(Math.max(el.scrollHeight, MIN_TA_HEIGHT), MAX_TA_HEIGHT)
    el.style.height = h + 'px'
    el.style.overflowY = el.scrollHeight > MAX_TA_HEIGHT ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    adjustTextarea()
  }, [input, adjustTextarea])

  // ===== 智能滚动 =====
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distFromBottom < SCROLL_THRESHOLD
    autoScrollRef.current = atBottom
    setShowJump(!atBottom && messages.length > 0)
  }, [messages.length])

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // ===== 发送 =====
  const send = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim()
      if (!text || busy) return
      setInput('')
      setBusy(true)
      autoScrollRef.current = true

      // 构建请求消息(排除正在流式/出错的消息)
      const history = messages
        .filter((m) => !m.streaming && !m.error)
        .map((m) => ({ role: m.role, content: m.content }))

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: '', streaming: true }
      ])

      const req: ChatRequest = {
        capability: 'coding',
        messages: [...history, { role: 'user', content: text }],
        temperature: 0
      }

      const cancel = window.dubhe.provider.chatStream(
        req,
        (delta) => {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + delta }
            }
            return next
          })
        },
        () => {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last) next[next.length - 1] = { ...last, streaming: false }
            return next
          })
          setBusy(false)
          cancelRef.current = null
        },
        (error) => {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                content: error,
                streaming: false,
                error: true
              }
            }
            return next
          })
          setBusy(false)
          cancelRef.current = null
        }
      )
      cancelRef.current = cancel
    },
    [input, busy, messages]
  )

  const stop = () => {
    cancelRef.current?.()
    setBusy(false)
  }

  // ===== 重试:移除失败的 assistant + 对应 user 消息,重新发送 =====
  const retry = useCallback(
    (failedIndex: number) => {
      if (busy) return
      // 找到失败消息前一条 user 消息的文本
      const userMsg = messages[failedIndex - 1]
      if (!userMsg || userMsg.role !== 'user') return
      const text = userMsg.content
      // 移除失败的 assistant + 它的 user 消息
      setMessages((prev) => prev.slice(0, failedIndex - 1))
      // 重新发送
      send(text)
    },
    [busy, messages, send]
  )

  const jumpToBottom = () => {
    autoScrollRef.current = true
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    setShowJump(false)
  }

  return (
    <div className="chat">
      <div className="chat__messages" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className="chat__empty">
            <p>与 AI 对话,描述你的游戏开发需求。</p>
            <p className="chat__empty-hint">
              当前默认路由:DeepSeek(coding)。可在「设置」中填入 API Key 并测试连通。
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role} ${m.error ? 'msg--error' : ''}`}>
            <div className="msg__role">
              {m.role === 'user' ? '你' : m.error ? '错误' : '天枢'}
            </div>
            <div className="msg__content">{m.content}</div>
            {m.error && !busy && (
              <button className="msg__retry" onClick={() => retry(i)}>
                ↻ 重试
              </button>
            )}
            {m.streaming && <span className="msg__cursor">▋</span>}
          </div>
        ))}
      </div>

      {showJump && (
        <button className="chat__jump" onClick={jumpToBottom} title="回到底部">
          ↓ 最新
        </button>
      )}

      <div className="chat__composer">
        <textarea
          ref={textareaRef}
          className="chat__input"
          placeholder="描述你的需求…(Shift+Enter 换行)"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button className="btn btn--danger" onClick={stop}>
            停止
          </button>
        ) : (
          <>
            {onGenerateWorkflow && (
              <button
                className="btn"
                onClick={() => onGenerateWorkflow(input.trim())}
                disabled={!input.trim() || generating}
                title="用 AI 生成工作流 spec"
              >
                {generating ? '生成中…' : '⚙ 工作流'}
              </button>
            )}
            <button className="btn btn--primary" onClick={() => send()} disabled={!input.trim()}>
              发送
            </button>
          </>
        )}
      </div>
    </div>
  )
}
