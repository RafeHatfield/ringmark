import type { ObjectStatus } from './types'

export type NodeLite = {
  id: string
  workshop_id: string
  object_type: string
  status: ObjectStatus | null
  title: string | null
  species: string | null
  parent_id: string | null
  root_id: string | null
  updated_at: string
}

export type LeafStatusCount = {
  status: ObjectStatus | null
  count: number
}

export type RootSummary = {
  root: NodeLite
  descendantCount: number
  leafStatuses: LeafStatusCount[]
  lastActivity: string
}

export function rollupRoots(nodes: NodeLite[]): RootSummary[] {
  const roots = nodes.filter((n) => n.parent_id === null)

  // Set of all ids that appear as parent_id in some node
  const parentIds = new Set<string>()
  for (const n of nodes) {
    if (n.parent_id !== null) {
      parentIds.add(n.parent_id)
    }
  }

  // Build map of root.id → descendants (nodes with matching root_id and parent_id !== null)
  const descendantsMap = new Map<string, NodeLite[]>()
  for (const root of roots) {
    descendantsMap.set(root.id, [])
  }
  for (const n of nodes) {
    if (n.parent_id !== null && n.root_id !== null && descendantsMap.has(n.root_id)) {
      descendantsMap.get(n.root_id)!.push(n)
    }
  }

  const summaries: RootSummary[] = roots.map((root) => {
    const descendants = descendantsMap.get(root.id) ?? []
    const allInTree = [root, ...descendants]

    // Leaves: nodes in the tree that are not parents of any other node
    const leaves = allInTree.filter((n) => !parentIds.has(n.id))

    // Group leaves by status, count, sort descending by count
    const statusCounts = new Map<ObjectStatus | null, number>()
    for (const leaf of leaves) {
      statusCounts.set(leaf.status, (statusCounts.get(leaf.status) ?? 0) + 1)
    }
    const leafStatuses: LeafStatusCount[] = Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count)

    // lastActivity = max(updated_at) across all nodes in the tree
    const lastActivity = allInTree.reduce(
      (max, n) => (n.updated_at > max ? n.updated_at : max),
      allInTree[0].updated_at
    )

    return {
      root,
      descendantCount: descendants.length,
      leafStatuses,
      lastActivity,
    }
  })

  // Sort by lastActivity descending (most recently active first)
  summaries.sort((a, b) =>
    b.lastActivity > a.lastActivity ? 1 : b.lastActivity < a.lastActivity ? -1 : 0
  )

  return summaries
}
