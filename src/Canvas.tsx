import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps
} from '@xyflow/react'

// 渲染进程自包含的最小 spec 类型(与 main 侧对齐,但不跨进程导入)
interface SpecNode {
  id: string
  type: string
  args: Record<string, unknown>
}
interface WorkflowSpec {
  nodes: SpecNode[]
  edges: [string, string][]
}

// ===== 节点状态 → 颜色 =====
const STATUS_COLORS: Record<string, string> = {
  pending: '#5f6377',
  running: '#6c8cff',
  succeeded: '#4ade80',
  failed: '#ff6b6b',
  skipped: '#5f6377',
  deprecated: '#f59e0b'
}

// ===== 原语类型 → 类别色 =====
const CATEGORY_COLORS: Record<string, string> = {
  input: '#6b7280',
  generate: '#8b5cf6',
  control: '#f59e0b',
  tool: '#10b981',
  verify: '#3b82f6'
}

function getCategoryColor(type: string): string {
  const cats: Record<string, string> = {
    collect: 'input', require: 'input', approve: 'input',
    llm_generate: 'generate', classify: 'generate', extract: 'generate',
    split: 'control', fanout: 'control', join: 'control', assemble: 'control',
    branch: 'control', loop: 'control', rollback_to: 'control',
    tool_call: 'tool', apply_change: 'tool', godot_check: 'tool', run_test: 'tool',
    verify: 'verify'
  }
  return CATEGORY_COLORS[cats[type] ?? 'input'] ?? '#6b7280'
}

// ===== 自定义节点 =====
function SpecNodeView({ data }: NodeProps) {
  const d = data as { type: string; status: string; label: string; goal?: string; selected?: boolean }
  const catColor = getCategoryColor(d.type)
  const statusColor = STATUS_COLORS[d.status] ?? STATUS_COLORS.pending

  return (
    <div
      className={`rf-node ${d.selected ? 'rf-node--selected' : ''}`}
      style={{ borderColor: statusColor, boxShadow: `0 0 0 1px ${catColor}40` }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="rf-node__bar" style={{ background: catColor }} />
      <div className="rf-node__type">{d.type}</div>
      <div className="rf-node__label">{d.label}</div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes = { spec: SpecNodeView }

// ===== 自动布局(简单纵向 + 分支偏移)=====
function layoutNodes(nodes: SpecNode[], edges: WorkflowSpec['edges']): Node[] {
  // 计算每个节点的入度(确定层级)
  const inDegree = new Map<string, number>()
  const outAdj = new Map<string, string[]>()
  for (const n of nodes) {
    inDegree.set(n.id, 0)
    outAdj.set(n.id, [])
  }
  for (const [from, to] of edges) {
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1)
    outAdj.get(from)?.push(to)
  }

  // BFS 分层
  const levels = new Map<string, number>()
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  queue.forEach((id) => levels.set(id, 0))

  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    const level = levels.get(id) ?? 0
    for (const next of outAdj.get(id) ?? []) {
      const nextLevel = Math.max(levels.get(next) ?? 0, level + 1)
      levels.set(next, nextLevel)
      if (!queue.includes(next)) queue.push(next)
    }
  }

  // 按层分组,每层水平排列
  const byLevel = new Map<number, string[]>()
  for (const [id, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level)!.push(id)
  }

  const NODE_W = 160
  const NODE_H = 70
  const GAP_X = 50
  const GAP_Y = 80

  return nodes.map((n) => {
    const level = levels.get(n.id) ?? 0
    const siblings = byLevel.get(level) ?? [n.id]
    const idx = siblings.indexOf(n.id)
    const totalWidth = siblings.length * NODE_W + (siblings.length - 1) * GAP_X
    const x = idx * (NODE_W + GAP_X) - totalWidth / 2 + NODE_W / 2
    const y = level * (NODE_H + GAP_Y)

    return {
      id: n.id,
      type: 'spec',
      position: { x, y },
      data: {
        type: n.type,
        status: 'pending',
        label: (n.args?.prompt as string)?.slice(0, 30) ?? n.type,
        goal: n.args?.goal as string | undefined
      }
    }
  })
}

function layoutEdges(edges: WorkflowSpec['edges']): Edge[] {
  return edges.map(([from, to], i) => ({
    id: `e${i}-${from}-${to}`,
    source: from,
    target: to,
    type: 'smoothstep',
    style: { stroke: '#3a4055', strokeWidth: 2 }
  }))
}

// ===== Canvas 组件 =====
interface CanvasProps {
  spec: WorkflowSpec | null
  nodeStatus?: Record<string, string>
  onNodeClick?: (nodeId: string) => void
  selectedNodeId?: string | null
}

export default function Canvas({ spec, nodeStatus, onNodeClick, selectedNodeId }: CanvasProps) {
  const nodes = useMemo(() => {
    if (!spec) return []
    return layoutNodes(spec.nodes, spec.edges).map((n) => ({
      ...n,
      data: {
        ...n.data,
        status: nodeStatus?.[n.id] ?? 'pending',
        selected: selectedNodeId === n.id
      }
    }))
  }, [spec, nodeStatus, selectedNodeId])

  const edges = useMemo(() => (spec ? layoutEdges(spec.edges) : []), [spec])

  if (!spec) {
    return (
      <div className="canvas-empty">
        <p>暂无工作流。在工作流面板中点「+ 新建工作流」生成。</p>
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_e, node) => onNodeClick?.(node.id)}
    >
      <Background color="#1c2030" gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
