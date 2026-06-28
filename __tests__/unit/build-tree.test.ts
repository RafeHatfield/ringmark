import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTree } from '../../lib/build-tree.ts'
import type { TreeNodeLite } from '../../lib/build-tree.ts'

function makeNode(overrides: Partial<TreeNodeLite> & { id: string; workshop_id: string }): TreeNodeLite {
  return {
    object_type: 'source',
    status: null,
    title: null,
    parent_id: null,
    ...overrides,
  }
}

describe('buildTree', () => {
  it('empty input returns empty array', () => {
    assert.deepEqual(buildTree([]), [])
  })

  it('single root node returns array with one node and no children', () => {
    const root = makeNode({ id: 'r1', workshop_id: 'RH1' })
    const result = buildTree([root])
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'r1')
    assert.deepEqual(result[0].children, [])
  })

  it('root with two direct children returns root with 2 children', () => {
    const root = makeNode({ id: 'r1', workshop_id: 'RH1' })
    const child1 = makeNode({ id: 'c1', workshop_id: 'RH1-1', parent_id: 'r1' })
    const child2 = makeNode({ id: 'c2', workshop_id: 'RH1-2', parent_id: 'r1' })
    const result = buildTree([root, child1, child2])
    assert.equal(result.length, 1)
    assert.equal(result[0].children.length, 2)
  })

  it('deep chain (root → child → grandchild) produces 3 levels of nesting', () => {
    const root = makeNode({ id: 'r1', workshop_id: 'RH1' })
    const child = makeNode({ id: 'c1', workshop_id: 'RH1-1', parent_id: 'r1' })
    const grandchild = makeNode({ id: 'g1', workshop_id: 'RH1-2', parent_id: 'c1' })
    const result = buildTree([root, child, grandchild])
    assert.equal(result.length, 1)
    assert.equal(result[0].children.length, 1)
    assert.equal(result[0].children[0].children.length, 1)
    assert.equal(result[0].children[0].children[0].id, 'g1')
  })

  it('two branches from same root: both at depth 1 with their own children', () => {
    const root = makeNode({ id: 'r1', workshop_id: 'RH1' })
    const a = makeNode({ id: 'a', workshop_id: 'RH1-1', parent_id: 'r1' })
    const b = makeNode({ id: 'b', workshop_id: 'RH1-2', parent_id: 'r1' })
    const c = makeNode({ id: 'c', workshop_id: 'RH1-3', parent_id: 'a' })
    const result = buildTree([root, a, b, c])
    assert.equal(result.length, 1)
    assert.equal(result[0].children.length, 2)
    const childA = result[0].children.find((ch) => ch.id === 'a')
    assert.ok(childA)
    assert.equal(childA.children.length, 1)
    assert.equal(childA.children[0].id, 'c')
  })

  it('children are sorted by workshop_id', () => {
    const root = makeNode({ id: 'r1', workshop_id: 'RH1' })
    const b = makeNode({ id: 'b', workshop_id: 'RH1-2', parent_id: 'r1' })
    const a = makeNode({ id: 'a', workshop_id: 'RH1-1', parent_id: 'r1' })
    const result = buildTree([root, b, a])
    assert.equal(result[0].children[0].workshop_id, 'RH1-1')
    assert.equal(result[0].children[1].workshop_id, 'RH1-2')
  })

  it('node whose parent_id is not in the set is treated as a root', () => {
    const orphan = makeNode({ id: 'o1', workshop_id: 'XX1', parent_id: 'nonexistent-id' })
    const result = buildTree([orphan])
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 'o1')
    assert.deepEqual(result[0].children, [])
  })

  it('multiple roots are sorted by workshop_id', () => {
    const b = makeNode({ id: 'b', workshop_id: 'RH2' })
    const a = makeNode({ id: 'a', workshop_id: 'RH1' })
    const result = buildTree([b, a])
    assert.equal(result[0].workshop_id, 'RH1')
    assert.equal(result[1].workshop_id, 'RH2')
  })
})
