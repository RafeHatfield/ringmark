/**
 * Computes root_id for an object when its parent assignment changes.
 *
 * Invariant: every object in a tree shares the same root_id — the id of the
 * topmost ancestor. Root objects self-reference: root_id === id.
 *
 * @param newParentId  - the new parent's id, or null if the object is becoming a root
 * @param newParentRootId - the new parent's root_id (the top of that parent's tree)
 * @param selfId       - the id of the object being moved
 */
export function computeRootId(
  newParentId: string | null,
  newParentRootId: string | null | undefined,
  selfId: string,
): string {
  if (!newParentId) {
    return selfId
  }
  return newParentRootId ?? selfId
}

/**
 * Collects the ids of startId and all of its descendants (its subtree),
 * given a flat list of { id, parent_id } rows. A visited set guards against
 * cycles in the input so a bad row can never cause an infinite loop.
 */
export function collectSubtreeIds(
  rows: { id: string; parent_id: string | null }[],
  startId: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const row of rows) {
    if (row.parent_id === null) continue
    const siblings = childrenByParent.get(row.parent_id)
    if (siblings) siblings.push(row.id)
    else childrenByParent.set(row.parent_id, [row.id])
  }

  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const childId of childrenByParent.get(current) ?? []) {
      if (!visited.has(childId)) {
        visited.add(childId)
        queue.push(childId)
      }
    }
  }
  return visited
}
