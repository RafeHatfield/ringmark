import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rollupRoots } from '../../lib/tree-rollup.ts'
import type { NodeLite } from '../../lib/tree-rollup.ts'

function makeNode(overrides: Partial<NodeLite> & { id: string }): NodeLite {
  return {
    workshop_id: overrides.id,
    object_type: 'source',
    status: null,
    title: null,
    species: null,
    parent_id: null,
    root_id: overrides.id,
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('rollupRoots', () => {
  it('empty input returns empty array', () => {
    assert.deepEqual(rollupRoots([]), [])
  })

  it('single root with no descendants: descendantCount 0, root is its own leaf', () => {
    const root = makeNode({ id: 'r1' })
    const result = rollupRoots([root])
    assert.equal(result.length, 1)
    assert.equal(result[0].descendantCount, 0)
    assert.equal(result[0].leafStatuses.length, 1)
    assert.equal(result[0].leafStatuses[0].count, 1)
    assert.equal(result[0].leafStatuses[0].status, null)
  })

  it('root with two direct children: descendantCount 2, leaves are the two children', () => {
    const root = makeNode({ id: 'r1' })
    const childA = makeNode({ id: 'a', parent_id: 'r1', root_id: 'r1', updated_at: '2024-01-02T00:00:00Z' })
    const childB = makeNode({ id: 'b', parent_id: 'r1', root_id: 'r1', updated_at: '2024-01-03T00:00:00Z' })
    const result = rollupRoots([root, childA, childB])
    assert.equal(result.length, 1)
    assert.equal(result[0].descendantCount, 2)
    // root is a parent, so only A and B are leaves
    const totalLeaves = result[0].leafStatuses.reduce((sum, s) => sum + s.count, 0)
    assert.equal(totalLeaves, 2)
  })

  it('branching tree (root → A, root → B, A → C): descendantCount 3, leaves are B and C', () => {
    const root = makeNode({ id: 'r1' })
    const a = makeNode({ id: 'a', parent_id: 'r1', root_id: 'r1' })
    const b = makeNode({ id: 'b', parent_id: 'r1', root_id: 'r1', status: 'stored' })
    const c = makeNode({ id: 'c', parent_id: 'a', root_id: 'r1', status: 'drying' })
    const result = rollupRoots([root, a, b, c])
    assert.equal(result.length, 1)
    assert.equal(result[0].descendantCount, 3)
    // Leaves: B and C (root and A are parents)
    const totalLeaves = result[0].leafStatuses.reduce((sum, s) => sum + s.count, 0)
    assert.equal(totalLeaves, 2)
  })

  it('lastActivity comes from descendant when descendant updated_at is newer', () => {
    const root = makeNode({ id: 'r1', updated_at: '2024-01-01T00:00:00Z' })
    const child = makeNode({ id: 'c1', parent_id: 'r1', root_id: 'r1', updated_at: '2024-06-15T00:00:00Z' })
    const result = rollupRoots([root, child])
    assert.equal(result[0].lastActivity, '2024-06-15T00:00:00Z')
  })

  it('two roots: more recently active tree sorts first', () => {
    const rootA = makeNode({ id: 'rA', updated_at: '2024-01-01T00:00:00Z' })
    const rootB = makeNode({ id: 'rB', updated_at: '2024-06-01T00:00:00Z' })
    const result = rollupRoots([rootA, rootB])
    assert.equal(result.length, 2)
    assert.equal(result[0].root.id, 'rB')
    assert.equal(result[1].root.id, 'rA')
  })

  it('root with null title and species does not crash', () => {
    const root = makeNode({ id: 'r1', title: null, species: null })
    const result = rollupRoots([root])
    assert.equal(result.length, 1)
    assert.equal(result[0].root.title, null)
    assert.equal(result[0].root.species, null)
  })

  it('leafStatuses sorted descending by count', () => {
    const root = makeNode({ id: 'r1' })
    const a = makeNode({ id: 'a', parent_id: 'r1', root_id: 'r1', status: 'stored' })
    const b = makeNode({ id: 'b', parent_id: 'r1', root_id: 'r1', status: 'stored' })
    const c = makeNode({ id: 'c', parent_id: 'r1', root_id: 'r1', status: 'drying' })
    const result = rollupRoots([root, a, b, c])
    const statuses = result[0].leafStatuses
    // 'stored' appears twice, 'drying' once — stored should be first
    assert.equal(statuses[0].status, 'stored')
    assert.equal(statuses[0].count, 2)
    assert.equal(statuses[1].status, 'drying')
    assert.equal(statuses[1].count, 1)
  })
})
