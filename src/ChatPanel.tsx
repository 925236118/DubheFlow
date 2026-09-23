import { useState, useRef, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<(() => void) | null>(null)

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)

    // 追加用户消息 + 占位 assistant 消息
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
        // 追加到最后一条 assistant 消息
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

  return (
    <div className="chat">
      <div className="chat__messages">
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
