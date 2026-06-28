import type { ObjectStatus } from './types'

export type TreeNodeLite = {
  id: string
  workshop_id: string
  object_type: string
  status: ObjectStatus | null
  title: string | null
  parent_id: string | null
}

export type TreeNode = TreeNodeLite & { children: TreeNode[] }

export function buildTree(nodes: TreeNodeLite[]): TreeNode[] {
  // Build id → TreeNode map with empty children arrays
  const map = new Map<string, TreeNode>()
  for (const n of nodes) {
    map.set(n.id, { ...n, children: [] })
  }

  const roots: TreeNode[] = []

  // Attach each node to its parent or to roots
  for (const n of nodes) {
    const node = map.get(n.id)!
    if (n.parent_id === null || !map.has(n.parent_id)) {
      roots.push(node)
    } else {
      map.get(n.parent_id)!.children.push(node)
    }
  }

  // Sort children recursively by workshop_id
  function sortChildren(node: TreeNode): void {
    node.children.sort((a, b) => a.workshop_id.localeCompare(b.workshop_id))
    node.children.forEach(sortChildren)
  }

  roots.sort((a, b) => a.workshop_id.localeCompare(b.workshop_id))
  roots.forEach(sortChildren)

  return roots
}
