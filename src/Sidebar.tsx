import { useState } from 'react'

// ===== 类型(渲染进程自包含)=====
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

export type MainView = 'chat' | 'workflow-list' | 'workflow-editor' | 'settings'

interface SidebarProps {
  conversations: ConversationItem[]
  workflows: WorkflowItem[]
  activeConversationId: string | null
  activeView: MainView
  onConversationClick: (id: string) => void
  onNewConversation: () => void
  onShowConversations: () => void
  onWorkflowClick: (id: string) => void
  onNewWorkflow: () => void
  onWorkflowListClick: () => void
  onSettingsClick: () => void
}

export default function Sidebar(props: SidebarProps) {
  const [convExpanded, setConvExpanded] = useState(true)

  return (
    <aside className="sidebar">
      {/* 品牌区 */}
      <div className="sidebar__brand">
        <span className="sidebar__logo">枢</span>
        <span className="sidebar__name">DubheFlow</span>
      </div>

      {/* 对话区 */}
      <Section
        title="对话"
        expanded={convExpanded}
        onToggle={() => setConvExpanded((v) => !v)}
        onAdd={props.onNewConversation}
        onHeaderClick={props.onShowConversations}
      >
        {props.conversations.length === 0 ? (
          <div className="sidebar__empty">暂无对话</div>
        ) : (
          props.conversations.map((c) => (
            <div
              key={c.id}
              className={`sidebar__item ${props.activeConversationId === c.id ? 'is-active' : ''}`}
              onClick={() => props.onConversationClick(c.id)}
            >
              <span className="sidebar__item-icon">💬</span>
              <span className="sidebar__item-text">{c.title}</span>
            </div>
          ))
        )}
      </Section>

      {/* 工作流区(不展开列表,点标题进工作流列表页) */}
      <div className="sidebar__section">
        <div className="sidebar__section-header">
          <span
            className="sidebar__section-title"
            onClick={props.onWorkflowListClick}
          >
            ⚡ 工作流
          </span>
          <button
            className="sidebar__add"
            type="button"
            onClick={(e) => { e.stopPropagation(); props.onNewWorkflow() }}
            title="新建工作流"
          >
            +
          </button>
        </div>
      </div>

      {/* 底部设置 */}
      <div className="sidebar__bottom">
        <div
          className={`sidebar__item ${props.activeView === 'settings' ? 'is-active' : ''}`}
          onClick={props.onSettingsClick}
        >
          <span className="sidebar__item-icon">⚙</span>
          <span className="sidebar__item-text">设置</span>
        </div>
      </div>
    </aside>
  )
}

function Section({
  title,
  expanded,
  onToggle,
  onAdd,
  onHeaderClick,
  children
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  onAdd: () => void
  onHeaderClick: () => void
  children: React.ReactNode
}) {
  return (
    <div className="sidebar__section">
      <div className="sidebar__section-header">
        <span
          className="sidebar__section-title"
          onClick={() => {
            onToggle()
            onHeaderClick()
          }}
        >
          {expanded ? '▾' : '▸'} {title}
        </span>
        <button
          className="sidebar__add"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAdd()
          }}
          title={`新建${title}`}
        >
          +
        </button>
      </div>
      {expanded && <div className="sidebar__section-items">{children}</div>}
    </div>
  )
}
