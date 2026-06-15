import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { suggestRootId, suggestDescendantId } from '../../lib/id-gen.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../lib/types.ts'

// Minimal Supabase chain proxy that resolves to { data, error: null }
function mockSupabase(rows: { workshop_id: string }[]): SupabaseClient<Database> {
  const result = { data: rows, error: null }
  let proxy: object
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve)
      }
      if (typeof prop === 'symbol') return undefined
      return () => proxy
    },
  }
  proxy = new Proxy({}, handler)
  return { from: () => ({ select: () => proxy }) } as unknown as SupabaseClient<Database>
}

describe('suggestRootId', () => {
  it('returns PREFIX1 when no objects exist', async () => {
    const result = await suggestRootId(mockSupabase([]), 'acc1', 'RH')
    assert.equal(result, 'RH1')
  })

  it('returns next sequential ID after existing roots', async () => {
    const result = await suggestRootId(
      mockSupabase([{ workshop_id: 'RH1' }, { workshop_id: 'RH2' }]),
      'acc1',
      'RH',
    )
    assert.equal(result, 'RH3')
  })

  it('returns max+1, skipping gaps in the sequence', async () => {
    const result = await suggestRootId(
      mockSupabase([{ workshop_id: 'RH1' }, { workshop_id: 'RH3' }]),
      'acc1',
      'RH',
    )
    assert.equal(result, 'RH4')
  })

  it('ignores objects with a different prefix', async () => {
    const result = await suggestRootId(
      mockSupabase([{ workshop_id: 'AB1' }, { workshop_id: 'AB2' }]),
      'acc1',
      'RH',
    )
    assert.equal(result, 'RH1')
  })

  it('matches prefix case-insensitively', async () => {
    const result = await suggestRootId(
      mockSupabase([{ workshop_id: 'rh1' }, { workshop_id: 'rh2' }]),
      'acc1',
      'RH',
    )
    assert.equal(result, 'RH3')
  })

  it('ignores descendant IDs (RH1-1) when counting roots', async () => {
    const result = await suggestRootId(
      mockSupabase([
        { workshop_id: 'RH1' },
        { workshop_id: 'RH1-1' },
        { workshop_id: 'RH1-2' },
      ]),
      'acc1',
      'RH',
    )
    assert.equal(result, 'RH2')
  })

  it('handles a single-character prefix', async () => {
    const result = await suggestRootId(
      mockSupabase([{ workshop_id: 'A1' }]),
      'acc1',
      'A',
    )
    assert.equal(result, 'A2')
  })

  it('handles large numbers correctly', async () => {
    const result = await suggestRootId(
      mockSupabase([{ workshop_id: 'RH99' }, { workshop_id: 'RH100' }]),
      'acc1',
      'RH',
    )
    assert.equal(result, 'RH101')
  })
})

describe('suggestDescendantId', () => {
  it('returns ROOT-1 when root has no descendants yet', async () => {
    const result = await suggestDescendantId(mockSupabase([]), 'acc1', 'root1', 'RH1')
    assert.equal(result, 'RH1-1')
  })

  it('returns next sequential descendant ID', async () => {
    const result = await suggestDescendantId(
      mockSupabase([
        { workshop_id: 'RH1' },
        { workshop_id: 'RH1-1' },
        { workshop_id: 'RH1-2' },
      ]),
      'acc1',
      'root1',
      'RH1',
    )
    assert.equal(result, 'RH1-3')
  })

  it('returns max+1, skipping gaps in descendant sequence', async () => {
    const result = await suggestDescendantId(
      mockSupabase([
        { workshop_id: 'RH1' },
        { workshop_id: 'RH1-1' },
        { workshop_id: 'RH1-3' },
      ]),
      'acc1',
      'root1',
      'RH1',
    )
    assert.equal(result, 'RH1-4')
  })

  it('uses flat numbering across all depths (grandchild gets next flat suffix)', async () => {
    // RH1-1 exists (depth 2), RH1-2 exists (depth 2) — next should be RH1-3 regardless of who parent is
    const result = await suggestDescendantId(
      mockSupabase([
        { workshop_id: 'RH1' },
        { workshop_id: 'RH1-1' },
        { workshop_id: 'RH1-2' },
      ]),
      'acc1',
      'root1',
      'RH1',
    )
    assert.equal(result, 'RH1-3')
  })

  it('matches root prefix case-insensitively', async () => {
    const result = await suggestDescendantId(
      mockSupabase([{ workshop_id: 'rh1' }, { workshop_id: 'rh1-1' }]),
      'acc1',
      'root1',
      'RH1',
    )
    assert.equal(result, 'RH1-2')
  })
})
