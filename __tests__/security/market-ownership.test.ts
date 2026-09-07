/**
 * Market Mode server action ownership contract tests.
 *
 * Parses the source of actions/market-events.ts and asserts that:
 *   1. Every exported action calls getOrCreateAccount() to bind the session identity
 *   2. Every fetch-then-mutate action scopes its ownership pre-fetch to account.id,
 *      and re-scopes the mutation itself (the double guard this codebase's other
 *      action files use — see action-ownership.test.ts for objects.ts/photos.ts)
 *   3. The ownership check occurs BEFORE the mutation in source order
 *   4. markItemSold / unmarkItemSold — the one place this feature reaches outside
 *      its own tables — actually perform the wood_objects.status cascade, scoped
 *      to account_id, and unmarkItemSold reverts unconditionally rather than
 *      tracking a "previous status"
 *
 * These tests do NOT run the actions — they cannot, as server actions depend on
 * next/cache and next/headers which are only available inside Next.js. What they
 * DO catch is the class of bug where someone adds a mutation and forgets the
 * ownership guard, or removes it during a refactor.
 *
 * RLS (see the `market_events`/`market_event_items` "members full access"
 * policies in the Task 0.1 migration) is the second layer of defence; these
 * tests protect the first layer.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const marketSrc = readFileSync(resolve('./actions/market-events.ts'), 'utf8')

/**
 * Source with comments removed, so prose *about* a symbol can't satisfy (or
 * falsely trip) an assertion about actual code. This matters here in
 * particular: the JSDoc above unmarkItemSold literally contains the phrase
 * "previous status" while explaining why the code deliberately avoids that
 * concept — a raw substring search against the commented source would treat
 * that explanatory prose as if it were the concept itself.
 */
const marketCode = marketSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

function countOccurrences(src: string, search: string): number {
  let count = 0
  let pos = 0
  while ((pos = src.indexOf(search, pos)) !== -1) {
    count++
    pos += search.length
  }
  return count
}

// ---------------------------------------------------------------------------
// Derive the export list from source, rather than hardcoding it — a new
// action that forgets getOrCreateAccount() must fail this test without
// anyone remembering to add it to a maintained list.
// ---------------------------------------------------------------------------

type ExportedFn = { name: string; start: number }

function deriveExportedAsyncFunctions(src: string): ExportedFn[] {
  const re = /export async function (\w+)/g
  const fns: ExportedFn[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(src)) !== null) {
    fns.push({ name: match[1], start: match.index })
  }
  return fns
}

/** Slice of `src` covering just one exported function's body, by source order. */
function sliceForFunction(src: string, fns: ExportedFn[], index: number): string {
  const start = fns[index].start
  const end = index + 1 < fns.length ? fns[index + 1].start : src.length
  return src.slice(start, end)
}

const exportedFns = deriveExportedAsyncFunctions(marketSrc)

describe('market-events.ts — export surface', () => {
  it('finds at least the 9 actions Task 1.4 specifies', () => {
    // createMarketEvent, updateMarketEvent, deleteMarketEvent, addMarketItem,
    // addMarketItemsBulk, updateMarketItemPrice, removeMarketItem,
    // markItemSold, unmarkItemSold
    assert.ok(
      exportedFns.length >= 9,
      `Expected >=9 "export async function" declarations in market-events.ts, found ${exportedFns.length}: ${exportedFns.map((f) => f.name).join(', ')}`,
    )
  })

  it('the exported-function count matches the raw "export async function" occurrence count', () => {
    // Belt-and-braces per the tester brief: even though the list above is
    // derived (not hardcoded), confirm the derivation itself isn't silently
    // dropping matches (e.g. via a regex edge case) by cross-checking against
    // a plain substring count.
    const rawCount = countOccurrences(marketSrc, 'export async function ')
    assert.equal(
      exportedFns.length,
      rawCount,
      'derived export list must account for every "export async function" occurrence in the file',
    )
  })

  it('every exported action calls getOrCreateAccount()', () => {
    for (let i = 0; i < exportedFns.length; i++) {
      const { name } = exportedFns[i]
      const slice = sliceForFunction(marketSrc, exportedFns, i)
      assert.ok(
        slice.includes('getOrCreateAccount()'),
        `${name} must call getOrCreateAccount() to bind the session identity before touching the DB`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// createMarketEvent — no pre-existing row to own, so there is nothing to
// scope an ownership *check* to. The account boundary is enforced by writing
// account_id from the server-derived account on insert (same precedent as
// createObject in objects.ts and createPhotoRecord in photos.ts).
// ---------------------------------------------------------------------------

describe('createMarketEvent', () => {
  it('inserts with account_id from the server-derived account', () => {
    const fnStart = marketSrc.indexOf('async function createMarketEvent')
    const fnEnd = marketSrc.indexOf('async function updateMarketEvent')
    const slice = marketSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes('account_id: account.id'),
      'createMarketEvent insert must set account_id from the server-derived account, never client input',
    )
  })
})

// ---------------------------------------------------------------------------
// updateMarketEvent
// ---------------------------------------------------------------------------

describe('updateMarketEvent', () => {
  it('verifies ownership BEFORE executing the update', () => {
    const fnStart = marketSrc.indexOf('async function updateMarketEvent')
    const fnEnd = marketSrc.indexOf('async function deleteMarketEvent')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const mutationIdx = slice.indexOf('.update(payload')

    assert.ok(ownershipIdx !== -1, 'updateMarketEvent must have an account_id ownership check')
    assert.ok(mutationIdx !== -1, 'updateMarketEvent must have an .update(payload ...) call')
    assert.ok(
      ownershipIdx < mutationIdx,
      'account_id ownership check must appear BEFORE .update(payload ...) in updateMarketEvent',
    )
  })

  it('double-guards the update itself with account_id, not just the pre-fetch', () => {
    const fnStart = marketSrc.indexOf('async function updateMarketEvent')
    const fnEnd = marketSrc.indexOf('async function deleteMarketEvent')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const mutationIdx = slice.indexOf('.update(payload')
    const postMutationSlice = slice.slice(mutationIdx)
    assert.ok(
      postMutationSlice.includes(".eq('account_id', account.id)"),
      'the .update(payload ...) call must itself be followed by .eq(account_id) — double guard',
    )
  })

  it('returns early when the ownership-scoped pre-fetch finds no matching event', () => {
    const fnStart = marketSrc.indexOf('async function updateMarketEvent')
    const fnEnd = marketSrc.indexOf('async function deleteMarketEvent')
    const slice = marketSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes('if (!existing)'),
      'updateMarketEvent must return early when the account-scoped fetch returns null',
    )
  })
})

// ---------------------------------------------------------------------------
// deleteMarketEvent
// ---------------------------------------------------------------------------

describe('deleteMarketEvent', () => {
  it('verifies ownership BEFORE executing the delete', () => {
    const fnStart = marketSrc.indexOf('async function deleteMarketEvent')
    const fnEnd = marketSrc.indexOf('async function addMarketItem')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const mutationIdx = slice.indexOf('.delete()')

    assert.ok(ownershipIdx !== -1, 'deleteMarketEvent must have an account_id ownership check')
    assert.ok(mutationIdx !== -1, 'deleteMarketEvent must have a .delete() call')
    assert.ok(
      ownershipIdx < mutationIdx,
      'account_id ownership check must appear BEFORE .delete() in deleteMarketEvent',
    )
  })

  it('double-guards the delete itself with account_id, not just the pre-fetch', () => {
    const fnStart = marketSrc.indexOf('async function deleteMarketEvent')
    const fnEnd = marketSrc.indexOf('async function addMarketItem')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const mutationIdx = slice.indexOf('.delete()')
    const postMutationSlice = slice.slice(mutationIdx)
    assert.ok(
      postMutationSlice.includes(".eq('account_id', account.id)"),
      'the .delete() call must itself be followed by .eq(account_id) — double guard',
    )
  })

  it('relies on DB-level cascade for market_event_items, not a manual cleanup query', () => {
    // Per Task 1.4/1.2: market_event_items.market_event_id references
    // market_events(id) on delete cascade — no photos, no storage, unlike
    // object deletion. A manual .from('market_event_items').delete() here
    // would be redundant and a sign the cascade assumption was dropped.
    const fnStart = marketSrc.indexOf('async function deleteMarketEvent')
    const fnEnd = marketSrc.indexOf('async function addMarketItem')
    const slice = marketSrc.slice(fnStart, fnEnd)
    assert.ok(
      !slice.includes("from('market_event_items')"),
      'deleteMarketEvent should not manually touch market_event_items — the FK cascade handles it',
    )
  })
})

// ---------------------------------------------------------------------------
// addMarketItem
// ---------------------------------------------------------------------------

describe('addMarketItem', () => {
  it('verifies market event ownership BEFORE inserting the item', () => {
    const fnStart = marketSrc.indexOf('async function addMarketItem(')
    const fnEnd = marketSrc.indexOf('async function addMarketItemsBulk')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const eventOwnershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const insertIdx = slice.indexOf(".insert({")

    assert.ok(eventOwnershipIdx !== -1, 'addMarketItem must verify market event ownership')
    assert.ok(insertIdx !== -1, 'addMarketItem must have an .insert({...}) call')
    assert.ok(
      eventOwnershipIdx < insertIdx,
      'market event ownership check must appear BEFORE .insert() in addMarketItem',
    )
  })

  it('also verifies the object being added belongs to this account (not just the event)', () => {
    const fnStart = marketSrc.indexOf('async function addMarketItem(')
    const fnEnd = marketSrc.indexOf('async function addMarketItemsBulk')
    const slice = marketSrc.slice(fnStart, fnEnd)

    // Two distinct account_id-scoped fetches: the market_events lookup and
    // the wood_objects lookup. A single .eq() wouldn't be enough — an
    // attacker could otherwise add someone else's object to their own event.
    const ownershipCheckCount = countOccurrences(slice, ".eq('account_id', account.id)")
    assert.ok(
      ownershipCheckCount >= 2,
      `addMarketItem must scope both the market_events lookup and the wood_objects lookup to account.id, found ${ownershipCheckCount} account_id checks`,
    )
    assert.ok(
      slice.includes("from('wood_objects')"),
      'addMarketItem must independently verify the target object belongs to this account',
    )
  })

  it('inserts with account_id from the server-derived account', () => {
    const fnStart = marketSrc.indexOf('async function addMarketItem(')
    const fnEnd = marketSrc.indexOf('async function addMarketItemsBulk')
    const slice = marketSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes('account_id: account.id'),
      'addMarketItem insert must set account_id from the server-derived account',
    )
  })
})

// ---------------------------------------------------------------------------
// addMarketItemsBulk
// ---------------------------------------------------------------------------

describe('addMarketItemsBulk', () => {
  it('verifies market event ownership BEFORE inserting any rows', () => {
    const fnStart = marketSrc.indexOf('async function addMarketItemsBulk')
    const fnEnd = marketSrc.indexOf('async function updateMarketItemPrice')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const eventOwnershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const insertIdx = slice.indexOf('.insert(rows)')

    assert.ok(eventOwnershipIdx !== -1, 'addMarketItemsBulk must verify market event ownership')
    assert.ok(insertIdx !== -1, 'addMarketItemsBulk must have an .insert(rows) call')
    assert.ok(
      eventOwnershipIdx < insertIdx,
      'market event ownership check must appear BEFORE .insert(rows) in addMarketItemsBulk',
    )
  })

  it('scopes the candidate-objects fetch to account.id (no cross-account bulk-add)', () => {
    const fnStart = marketSrc.indexOf('async function addMarketItemsBulk')
    const fnEnd = marketSrc.indexOf('async function updateMarketItemPrice')
    const slice = marketSrc.slice(fnStart, fnEnd)

    // wood_objects fetch must itself be account-scoped, since it's the
    // membership test that filters which of the caller-supplied object_ids
    // are silently skipped vs added.
    const woodObjectsIdx = slice.indexOf("from('wood_objects')")
    assert.ok(woodObjectsIdx !== -1, 'addMarketItemsBulk must fetch candidate wood_objects')
    const afterWoodObjects = slice.slice(woodObjectsIdx, woodObjectsIdx + 200)
    assert.ok(
      afterWoodObjects.includes(".eq('account_id', account.id)"),
      'the wood_objects candidate fetch must be scoped to account.id — this is what silently excludes other accounts\' objects from the bulk add',
    )
  })

  it('inserted rows carry account_id from the server-derived account', () => {
    const fnStart = marketSrc.indexOf('async function addMarketItemsBulk')
    const fnEnd = marketSrc.indexOf('async function updateMarketItemPrice')
    const slice = marketSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes('account_id: account.id'),
      'addMarketItemsBulk must stamp every inserted row with account_id from the server-derived account',
    )
  })
})

// ---------------------------------------------------------------------------
// updateMarketItemPrice
// ---------------------------------------------------------------------------

describe('updateMarketItemPrice', () => {
  it('verifies ownership BEFORE executing the update', () => {
    const fnStart = marketSrc.indexOf('async function updateMarketItemPrice')
    const fnEnd = marketSrc.indexOf('async function removeMarketItem')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const mutationIdx = slice.indexOf('.update({ asking_price_cents')

    assert.ok(ownershipIdx !== -1, 'updateMarketItemPrice must have an account_id ownership check')
    assert.ok(mutationIdx !== -1, 'updateMarketItemPrice must have an .update({ asking_price_cents ...}) call')
    assert.ok(
      ownershipIdx < mutationIdx,
      'account_id ownership check must appear BEFORE the price update in updateMarketItemPrice',
    )
  })

  it('double-guards the update itself with account_id, not just the pre-fetch', () => {
    const fnStart = marketSrc.indexOf('async function updateMarketItemPrice')
    const fnEnd = marketSrc.indexOf('async function removeMarketItem')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const mutationIdx = slice.indexOf('.update({ asking_price_cents')
    const postMutationSlice = slice.slice(mutationIdx)
    assert.ok(
      postMutationSlice.includes(".eq('account_id', account.id)"),
      'the price .update() call must itself be followed by .eq(account_id) — double guard',
    )
  })
})

// ---------------------------------------------------------------------------
// removeMarketItem
// ---------------------------------------------------------------------------

describe('removeMarketItem', () => {
  it('verifies ownership BEFORE executing the delete', () => {
    const fnStart = marketSrc.indexOf('async function removeMarketItem')
    const fnEnd = marketSrc.indexOf('async function markItemSold')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const mutationIdx = slice.indexOf('.delete()')

    assert.ok(ownershipIdx !== -1, 'removeMarketItem must have an account_id ownership check')
    assert.ok(mutationIdx !== -1, 'removeMarketItem must have a .delete() call')
    assert.ok(
      ownershipIdx < mutationIdx,
      'account_id ownership check must appear BEFORE .delete() in removeMarketItem',
    )
  })

  it('double-guards the delete itself with account_id, not just the pre-fetch', () => {
    const fnStart = marketSrc.indexOf('async function removeMarketItem')
    const fnEnd = marketSrc.indexOf('async function markItemSold')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const mutationIdx = slice.indexOf('.delete()')
    const postMutationSlice = slice.slice(mutationIdx)
    assert.ok(
      postMutationSlice.includes(".eq('account_id', account.id)"),
      'the .delete() call must itself be followed by .eq(account_id) — double guard',
    )
  })
})

// ---------------------------------------------------------------------------
// markItemSold / unmarkItemSold
//
// These are the one place Market Mode reaches outside its own tables (per
// Task 1.4's docstring): each writes market_event_items AND wood_objects in
// the same call. Both cascades are easy to drop in a refactor, so they get
// their own explicit assertions rather than relying on the generic
// "ownership before mutation" checks above to imply they exist.
// ---------------------------------------------------------------------------

describe('markItemSold', () => {
  it('verifies item ownership BEFORE mutating anything', () => {
    const fnStart = marketSrc.indexOf('async function markItemSold')
    const fnEnd = marketSrc.indexOf('async function unmarkItemSold')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const itemMutationIdx = slice.indexOf('sold: true')
    const objectMutationIdx = slice.indexOf("status: 'sold'")

    assert.ok(ownershipIdx !== -1, 'markItemSold must have an account_id ownership check')
    assert.ok(itemMutationIdx !== -1, 'markItemSold must set sold: true on the item')
    assert.ok(objectMutationIdx !== -1, "markItemSold must set status: 'sold' on the underlying object")
    assert.ok(
      ownershipIdx < itemMutationIdx && ownershipIdx < objectMutationIdx,
      'account_id ownership check must appear BEFORE both the item update and the object status cascade in markItemSold',
    )
  })

  it('sets the item sold, with sold_price_cents and sold_at populated', () => {
    const fnStart = marketSrc.indexOf('async function markItemSold')
    const fnEnd = marketSrc.indexOf('async function unmarkItemSold')
    const slice = marketSrc.slice(fnStart, fnEnd)
    assert.ok(slice.includes('sold: true'), 'markItemSold must set sold: true')
    assert.ok(slice.includes('sold_price_cents:'), 'markItemSold must set sold_price_cents')
    assert.ok(slice.includes('sold_at:'), 'markItemSold must set sold_at')
  })

  it('cascades to wood_objects.status = "sold", scoped to account_id', () => {
    // The one place this feature reaches outside market_event_items — assert
    // the cascade exists explicitly, since a refactor could drop the second
    // .update() call while leaving the market_event_items write intact and
    // every other test in this file would still pass.
    const fnStart = marketSrc.indexOf('async function markItemSold')
    const fnEnd = marketSrc.indexOf('async function unmarkItemSold')
    const slice = marketSrc.slice(fnStart, fnEnd)

    const woodObjectsIdx = slice.indexOf("from('wood_objects')")
    assert.ok(woodObjectsIdx !== -1, 'markItemSold must update wood_objects — the status cascade')

    const woodObjectsSlice = slice.slice(woodObjectsIdx, woodObjectsIdx + 250)
    assert.ok(
      woodObjectsSlice.includes(".update({ status: 'sold'"),
      "markItemSold must set wood_objects.status to 'sold'",
    )
    assert.ok(
      woodObjectsSlice.includes(".eq('id', item.object_id)"),
      'the wood_objects cascade must target the specific object_id from the ownership-checked item',
    )
    assert.ok(
      woodObjectsSlice.includes(".eq('account_id', account.id)"),
      'the wood_objects cascade update must itself be scoped to account_id, not just rely on the item pre-fetch',
    )
  })
})

describe('unmarkItemSold', () => {
  it('verifies item ownership BEFORE mutating anything', () => {
    const fnStart = marketSrc.indexOf('async function unmarkItemSold')
    const slice = marketSrc.slice(fnStart)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const itemMutationIdx = slice.indexOf('sold: false')
    const objectMutationIdx = slice.indexOf("status: 'for_sale'")

    assert.ok(ownershipIdx !== -1, 'unmarkItemSold must have an account_id ownership check')
    assert.ok(itemMutationIdx !== -1, 'unmarkItemSold must set sold: false on the item')
    assert.ok(objectMutationIdx !== -1, "unmarkItemSold must set status: 'for_sale' on the underlying object")
    assert.ok(
      ownershipIdx < itemMutationIdx && ownershipIdx < objectMutationIdx,
      'account_id ownership check must appear BEFORE both the item update and the object status cascade in unmarkItemSold',
    )
  })

  it('clears sold_price_cents and sold_at along with sold', () => {
    const fnStart = marketSrc.indexOf('async function unmarkItemSold')
    const slice = marketSrc.slice(fnStart)
    assert.ok(slice.includes('sold: false'), 'unmarkItemSold must set sold: false')
    assert.ok(slice.includes('sold_price_cents: null'), 'unmarkItemSold must clear sold_price_cents')
    assert.ok(slice.includes('sold_at: null'), 'unmarkItemSold must clear sold_at')
  })

  it('cascades to wood_objects.status = "for_sale", scoped to account_id', () => {
    const fnStart = marketSrc.indexOf('async function unmarkItemSold')
    const slice = marketSrc.slice(fnStart)

    const woodObjectsIdx = slice.indexOf("from('wood_objects')")
    assert.ok(woodObjectsIdx !== -1, 'unmarkItemSold must update wood_objects — the status revert cascade')

    const woodObjectsSlice = slice.slice(woodObjectsIdx, woodObjectsIdx + 250)
    assert.ok(
      woodObjectsSlice.includes(".update({ status: 'for_sale'"),
      "unmarkItemSold must revert wood_objects.status to 'for_sale'",
    )
    assert.ok(
      woodObjectsSlice.includes(".eq('id', item.object_id)"),
      'the wood_objects revert cascade must target the specific object_id from the ownership-checked item',
    )
    assert.ok(
      woodObjectsSlice.includes(".eq('account_id', account.id)"),
      'the wood_objects revert cascade update must itself be scoped to account_id',
    )
  })

  it('reverts unconditionally to for_sale — never reads or tracks a "previous status"', () => {
    // Deliberate, documented decision (see the JSDoc above unmarkItemSold in
    // actions/market-events.ts): reverting to a hardcoded 'for_sale' avoids a
    // redundant "previous status" column. This test asserts the code, not
    // the comment describing the code — hence marketCode (comments stripped)
    // rather than marketSrc for the symbol-usage checks below.
    const fnStart = marketCode.indexOf('async function unmarkItemSold')
    const codeSlice = marketCode.slice(fnStart)

    assert.ok(
      !/previous.?status|prior.?status|old.?status/i.test(codeSlice),
      'unmarkItemSold must not reference any "previous status" concept in code — reverting to for_sale is unconditional',
    )

    // The item pre-fetch must not select wood_objects.status at all — if it
    // never reads the prior status, it structurally cannot branch on it.
    const rawFnStart = marketSrc.indexOf('async function unmarkItemSold')
    const rawSlice = marketSrc.slice(rawFnStart)
    const woodObjectsIdx = rawSlice.indexOf("from('wood_objects')")
    assert.ok(woodObjectsIdx !== -1, 'unmarkItemSold must touch wood_objects')
    const beforeWoodObjectsWrite = rawSlice.slice(0, woodObjectsIdx)
    assert.ok(
      !beforeWoodObjectsWrite.includes("select('id, market_event_id, object_id, status')") &&
        !/wood_objects[\s\S]{0,80}select\([^)]*status/.test(beforeWoodObjectsWrite),
      'unmarkItemSold must not read wood_objects.status before overwriting it — the revert is unconditional, not conditional on prior state',
    )

    // The only wood_objects touch in the function is a single .update(), not
    // a .select() followed by conditional logic.
    assert.equal(
      countOccurrences(rawSlice, "from('wood_objects')"),
      1,
      'unmarkItemSold should touch wood_objects exactly once — a single unconditional update, not a read-then-branch',
    )
  })
})
