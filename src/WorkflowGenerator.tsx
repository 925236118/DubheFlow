import { useState } from 'react'

export default function WorkflowGenerator({
  onGenerated
}: {
  onGenerated: (spec: object) => void
}) {
  const [task, setTask] = useState('')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [rawResponse, setRawResponse] = useState('')

  const handleGenerate = async () => {
    const text = task.trim()
    if (!text || loading) return
    setLoading(true)
    setErrors([])
    setRawResponse('')

    try {
      const result = await window.dubhe.spec.generate(text)
      if (result.spec) {
        onGenerated(result.spec)
        setErrors([])
      } else {
        setErrors(result.validation.errors.map((e) => `[${e.severity}] ${e.message}`))
        setRawResponse(result.rawResponse.slice(0, 500) + '…')
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wf-gen">
      <div className="wf-gen__header">
        <h2 className="wf-gen__title">生成工作流</h2>
        <p className="wf-gen__hint">
          描述你的需求,AI 将生成一条工作流 spec。spec 里写的是 capability(如 coding),不写模型名 ——
          运行时由路由表绑定具体模型。
        </p>
      </div>

      <div className="wf-gen__input-area">
        <textarea
          className="wf-gen__input"
          placeholder="例如:为一个太空射击游戏创建敌人系统,包含敌人脚本、精灵图、行为树…"
          rows={6}
          value={task}
          disabled={loading}
          onChange={(e) => setTask(e.target.value)}
        />
        {loading ? (
          <div className="wf-gen__loading">
            <span className="wf-gen__spinner" />
            <span>AI 正在生成工作流,请稍候…</span>
          </div>
        ) : (
          <button
            className="btn btn--primary"
            onClick={handleGenerate}
            disabled={!task.trim()}
          >
            ⚙ 生成工作流
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <div className="wf-gen__errors">
          <div className="wf-gen__errors-title">校验失败,请修正或重试:</div>
          {errors.map((e, i) => (
            <div key={i} className="wf-gen__error">
              {e}
            </div>
          ))}
        </div>
      )}

      {rawResponse && (
        <details className="wf-gen__raw">
          <summary>模型原始输出(调试)</summary>
          <pre>{rawResponse}</pre>
        </details>
      )}
    </div>
  )
}
