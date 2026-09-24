import { useState } from 'react'

// ask_user 节点的问题格式
interface AskQuestion {
  id: string
  text: string
  options?: string[]
  placeholder?: string
}

interface AskUserFormProps {
  questions: AskQuestion[]
  onRespond: (answers: Record<string, string>) => void
}

export default function AskUserForm({ questions: rawQuestions, onRespond }: AskUserFormProps) {
  // 确保 questions 是数组(AI 可能生成对象或字符串)
  const questions = Array.isArray(rawQuestions) ? rawQuestions : []
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [fallback, setFallback] = useState('')

  const setAns = (id: string, val: string) => {
    setAnswers((prev) => ({ ...prev, [id]: val }))
  }

  // 是否有任何选项题(有选项才需要"都不符合"兜底)
  const hasOptions = questions.some(
    (q) => q.options && Array.isArray(q.options) && q.options.length > 0
  )

  const handleSubmit = () => {
    if (fallback.trim()) {
      // 填了"都不符合" → 所有问题的答案统一为 fallback
      const override: Record<string, string> = {}
      for (const q of questions) override[q.id] = fallback.trim()
      onRespond(override)
    } else {
      onRespond(answers)
    }
  }

  const allAnswered = questions.every((q) => answers[q.id]?.trim())

  return (
    <div className="ask-form">
      <div className="ask-form__header">
        <span className="ask-form__icon">❓</span>
        <span className="ask-form__title">需要你的输入</span>
      </div>

      {questions.map((q, i) => {
        if (!q || !q.id) return null
        return (
        <div key={q.id ?? i} className="ask-form__question">
          <label className="ask-form__label">{q.text || q.id}</label>
          {q.options && Array.isArray(q.options) ? (
            <div className="ask-form__options">
              {q.options.map((opt) => (
                <label key={opt} className="ask-form__option">
                  <input
                    type="radio"
                    name={q.id}
                    value={opt}
                    checked={answers[q.id] === opt}
                    onChange={(e) => setAns(q.id, e.target.value)}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          ) : (
            <input
              className="ask-form__input"
              type="text"
              placeholder={q.placeholder ?? '请输入…'}
              value={answers[q.id] ?? ''}
              onChange={(e) => setAns(q.id, e.target.value)}
            />
          )}
        </div>
        )
      })}

      {/* "都不符合我的想法"输入框(仅当有选项题时才显示) */}
      {hasOptions && (
        <div className="ask-form__fallback">
          <label className="ask-form__label">都不符合我的想法,输入:</label>
          <textarea
            className="ask-form__textarea"
            placeholder="描述你的实际需求…"
            rows={3}
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
          />
        </div>
      )}

      <button
        className="btn btn--primary ask-form__submit"
        onClick={handleSubmit}
        disabled={!allAnswered && !fallback.trim()}
      >
        提交回答
      </button>
    </div>
  )
}
