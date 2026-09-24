import { useState } from 'react'

interface WorkflowItem {
  id: string
  name: string
  description: string | null
  pinned: number
  created_at: number
}

interface WorkflowListProps {
  workflows: WorkflowItem[]
  onOpen: (id: string) => void
  onPin: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
}

export default function WorkflowList({
  workflows,
  onOpen,
  onPin,
  onDelete,
  onNew
}: WorkflowListProps) {
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const filtered = workflows.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const pinned = filtered.filter((w) => w.pinned)
  const unpinned = filtered.filter((w) => !w.pinned)

  return (
    <div className="wf-list">
      <div className="wf-list__header">
        <h2 className="wf-list__title">工作流</h2>
        <button className="btn btn--primary" onClick={onNew}>
          + 新建工作流
        </button>
      </div>

      <input
        className="wf-list__search"
        type="text"
        placeholder="搜索工作流…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="wf-list__body">
        {pinned.length > 0 && (
          <>
            <div className="wf-list__group">★ 收藏</div>
            {pinned.map((w) => (
              <WorkflowCard
                key={w.id}
                workflow={w}
                onOpen={onOpen}
                onPin={onPin}
                onDelete={onDelete}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
              />
            ))}
          </>
        )}

        {unpinned.length > 0 && (
          <>
            {pinned.length > 0 && <div className="wf-list__group">全部</div>}
            {unpinned.map((w) => (
              <WorkflowCard
                key={w.id}
                workflow={w}
                onOpen={onOpen}
                onPin={onPin}
                onDelete={onDelete}
                confirmDelete={confirmDelete}
                setConfirmDelete={setConfirmDelete}
              />
            ))}
          </>
        )}

        {filtered.length === 0 && (
          <div className="wf-list__empty">
            <p>暂无工作流</p>
            <button className="btn btn--primary" onClick={onNew}>
              生成第一个工作流
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function WorkflowCard({
  workflow,
  onOpen,
  onPin,
  onDelete,
  confirmDelete,
  setConfirmDelete
}: {
  workflow: WorkflowItem
  onOpen: (id: string) => void
  onPin: (id: string) => void
  onDelete: (id: string) => void
  confirmDelete: string | null
  setConfirmDelete: (id: string | null) => void
}) {
  return (
    <div className="wf-card">
      <div className="wf-card__main" onClick={() => onOpen(workflow.id)}>
        <div className="wf-card__name">{workflow.name}</div>
        {workflow.description && (
          <div className="wf-card__desc">{workflow.description}</div>
        )}
        <div className="wf-card__meta">
          {new Date(workflow.created_at).toLocaleDateString('zh-CN')}
        </div>
      </div>
      <div className="wf-card__actions">
        <button
          className={`wf-card__pin ${workflow.pinned ? 'is-pinned' : ''}`}
          onClick={() => onPin(workflow.id)}
          title={workflow.pinned ? '取消收藏' : '收藏置顶'}
        >
          {workflow.pinned ? '★' : '☆'}
        </button>
        {confirmDelete === workflow.id ? (
          <button
            className="wf-card__delete-confirm"
            onClick={() => {
              onDelete(workflow.id)
              setConfirmDelete(null)
            }}
          >
            确认删除
          </button>
        ) : (
          <button
            className="wf-card__delete"
            onClick={() => setConfirmDelete(workflow.id)}
            title="删除"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
