import { useState, useRef, useCallback, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

// 距底部多少像素以内算"在底部",恢复自动滚动
const SCROLL_THRESHOLD = 80

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // 是否显示"回到底部"按钮(用户上滑后出现)
  const [showJump, setShowJump] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  // 滚动容器 ref
  const scrollRef = useRef<HTMLDivElement>(null)
  // 是否自动跟随滚动(ref 避免频繁 re-render)
  const autoScrollRef = useRef(true)

  // 滚动事件:判断用户是否在底部附近
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distFromBottom < SCROLL_THRESHOLD
    autoScrollRef.current = atBottom
    setShowJump(!atBottom)
  }, [])

  // 消息变化时,若自动滚动开启则滚到底
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      const el = scrollRef.current
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    // 发送时强制回到底部
    autoScrollRef.current = true

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', streaming: true }
    ])

    const req: ChatRequest = {
      capability: 'coding',
      messages: [...messages.filter((m) => !m.streaming), { role: 'user', content: text }].map(
        (m) => ({ role: m.role, content: m.content })
      ),
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
              content: `❌ ${error}`,
              streaming: false
            }
          }
          return next
        })
        setBusy(false)
        cancelRef.current = null
      }
    )
    cancelRef.current = cancel
  }, [input, busy, messages])

  const stop = () => {
    cancelRef.current?.()
    setBusy(false)
  }

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
          <div key={i} className={`msg msg--${m.role}`}>
            <div className="msg__role">{m.role === 'user' ? '你' : '天枢'}</div>
            <div className="msg__content">
              {m.content || (m.streaming ? '思考中…' : '')}
              {m.streaming && <span className="msg__cursor">▋</span>}
            </div>
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
          className="chat__input"
          placeholder="描述你的需求…"
          rows={2}
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
          <button className="btn btn--primary" onClick={send} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}
