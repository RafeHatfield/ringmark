import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { nextSortOrder, getSwapPair } from '../../lib/photo-utils.ts'

const photos = [
  { id: 'a', sort_order: 0 },
  { id: 'b', sort_order: 1 },
  { id: 'c', sort_order: 2 },
]

describe('nextSortOrder', () => {
  it('returns 0 when no photos exist', () => {
    assert.equal(nextSortOrder([]), 0)
  })

  it('returns max + 1', () => {
    assert.equal(nextSortOrder([0, 1, 2]), 3)
  })

  it('handles gaps in sort_order', () => {
    assert.equal(nextSortOrder([0, 5, 3]), 6)
  })

  it('handles a single photo', () => {
    assert.equal(nextSortOrder([7]), 8)
  })
})

describe('getSwapPair', () => {
  it('returns null for an unknown photoId', () => {
    assert.equal(getSwapPair(photos, 'zzz', 'up'), null)
  })

  it('returns null when moving the first photo up', () => {
    assert.equal(getSwapPair(photos, 'a', 'up'), null)
  })

  it('returns null when moving the last photo down', () => {
    assert.equal(getSwapPair(photos, 'c', 'down'), null)
  })

  it('returns correct pair when moving second photo up', () => {
    const pair = getSwapPair(photos, 'b', 'up')
    assert.ok(pair !== null)
    assert.equal(pair[0].id, 'b')
    assert.equal(pair[1].id, 'a')
  })

  it('returns correct pair when moving second photo down', () => {
    const pair = getSwapPair(photos, 'b', 'down')
    assert.ok(pair !== null)
    assert.equal(pair[0].id, 'b')
    assert.equal(pair[1].id, 'c')
  })

  it('sorts by sort_order before finding position (input order does not matter)', () => {
    const unordered = [
      { id: 'c', sort_order: 2 },
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
    ]
    const pair = getSwapPair(unordered, 'b', 'up')
    assert.ok(pair !== null)
    assert.equal(pair[0].id, 'b')
    assert.equal(pair[1].id, 'a')
  })

  it('handles non-contiguous sort_orders', () => {
    const sparse = [
      { id: 'x', sort_order: 10 },
      { id: 'y', sort_order: 20 },
      { id: 'z', sort_order: 30 },
    ]
    const pair = getSwapPair(sparse, 'y', 'down')
    assert.ok(pair !== null)
    // Moving y down: swap y(20) with z(30)
    assert.equal(pair[0].sort_order, 20)
    assert.equal(pair[1].sort_order, 30)
  })
})
