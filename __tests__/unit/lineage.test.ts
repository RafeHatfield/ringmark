import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeRootId, collectSubtreeIds } from '../../lib/lineage-utils.ts'

describe('computeRootId', () => {
  it('a new root object (no parent) points to itself', () => {
    assert.equal(computeRootId(null, null, 'obj-1'), 'obj-1')
  })

  it('removing a parent (becoming root) points to self regardless of old parent root', () => {
    assert.equal(computeRootId(null, 'old-root', 'obj-1'), 'obj-1')
  })

  it('child of a root inherits that root id', () => {
    // parent IS the root → parent.root_id === parent.id
    assert.equal(computeRootId('parent-1', 'parent-1', 'obj-1'), 'parent-1')
  })

  it('grandchild inherits the root id, not the immediate parent id', () => {
    // parent is a child of root-1, so parent.root_id = 'root-1'
    assert.equal(computeRootId('child-1', 'root-1', 'grandchild-1'), 'root-1')
  })

  it('re-parenting to a different root tree adopts that tree root', () => {
    assert.equal(computeRootId('tree-b-root', 'tree-b-root', 'obj-1'), 'tree-b-root')
  })

  it('re-parenting to a deep node inherits that tree actual root, not the intermediate node', () => {
    assert.equal(computeRootId('deep-node', 'actual-root', 'obj-1'), 'actual-root')
  })

  it('defensive: null parentRootId with a set parentId falls back to selfId', () => {
    // Should not happen with valid data, but must not crash or produce a wrong root
    assert.equal(computeRootId('some-parent', null, 'obj-1'), 'obj-1')
  })

  it('defensive: undefined parentRootId with a set parentId falls back to selfId', () => {
    assert.equal(computeRootId('some-parent', undefined, 'obj-1'), 'obj-1')
  })
})

describe('collectSubtreeIds', () => {
  it('walks a linear chain and includes the start node', () => {
    const rows = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
      { id: 'd', parent_id: 'c' },
    ]
    assert.deepEqual(collectSubtreeIds(rows, 'b'), new Set(['b', 'c', 'd']))
  })

  it('walks a branching tree, collecting all descendants', () => {
    const rows = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'a' },
      { id: 'd', parent_id: 'b' },
      { id: 'e', parent_id: 'b' },
      { id: 'f', parent_id: 'c' },
    ]
    assert.deepEqual(collectSubtreeIds(rows, 'a'), new Set(['a', 'b', 'c', 'd', 'e', 'f']))
    assert.deepEqual(collectSubtreeIds(rows, 'b'), new Set(['b', 'd', 'e']))
  })

  it('a node not present in rows returns just itself', () => {
    const rows = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
    ]
    assert.deepEqual(collectSubtreeIds(rows, 'z'), new Set(['z']))
  })

  it('terminates via the visited set when the input rows contain a cycle', () => {
    const rows = [
      { id: 'a', parent_id: 'c' },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
    ]
    assert.deepEqual(collectSubtreeIds(rows, 'a'), new Set(['a', 'b', 'c']))
  })
})
