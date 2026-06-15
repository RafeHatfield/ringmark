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
