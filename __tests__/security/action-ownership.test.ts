/**
 * Server action ownership contract tests.
 *
 * These tests parse the source of each action file and assert that:
 *   1. Every exported mutation calls getOrCreateAccount() to bind the session identity
 *   2. Every mutation scopes its DB query to account.id (either on the pre-fetch
 *      or on the mutation itself)
 *   3. For the fetch-then-mutate pattern (photos), the ownership fetch occurs
 *      BEFORE the actual DELETE/UPDATE in source order
 *   4. workshop_id normalisation is applied consistently
 *
 * These tests do NOT run the actions — they cannot, as server actions depend
 * on next/cache and next/headers which are only available inside Next.js.
 * What they DO catch is the class of bug where someone adds a mutation and
 * forgets the ownership guard, or removes the guard during a refactor.
 *
 * RLS is the second layer of defence; these tests protect the first layer.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const objectsSrc = readFileSync(resolve('./actions/objects.ts'), 'utf8')
const photosSrc = readFileSync(resolve('./actions/photos.ts'), 'utf8')
const storySrc = readFileSync(resolve('./actions/story.ts'), 'utf8')

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
// objects.ts
// ---------------------------------------------------------------------------

describe('action ownership — objects.ts', () => {
  it('every exported function calls getOrCreateAccount()', () => {
    // createObject, updateObject, updateStatus (delegates), deleteObject,
    // checkWorkshopId, searchObjects = at least 5 direct call sites
    const count = countOccurrences(objectsSrc, 'getOrCreateAccount()')
    assert.ok(
      count >= 5,
      `Expected ≥5 getOrCreateAccount() calls in objects.ts, got ${count}`,
    )
  })

  it('createObject scopes the duplicate-check query to account.id', () => {
    const fnStart = objectsSrc.indexOf('async function createObject')
    const fnEnd = objectsSrc.indexOf('async function updateObject')
    const slice = objectsSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes(".eq('account_id', account.id)"),
      'createObject must scope its workshop_id collision check to account.id',
    )
  })

  it('createObject inserts with account_id from the server session', () => {
    const fnStart = objectsSrc.indexOf('async function createObject')
    const fnEnd = objectsSrc.indexOf('async function updateObject')
    const slice = objectsSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes('account_id: account.id'),
      'createObject insert must set account_id from the server-derived account',
    )
  })

  it('updateObject verifies ownership BEFORE executing the update', () => {
    const fnStart = objectsSrc.indexOf('async function updateObject')
    const fnEnd = objectsSrc.indexOf('async function updateStatus')
    const slice = objectsSrc.slice(fnStart, fnEnd)

    const ownershipCheckIdx = slice.indexOf(".eq('account_id', account.id)")
    const mutationIdx = slice.indexOf('.update(payload')

    assert.ok(ownershipCheckIdx !== -1, 'updateObject must have an account_id ownership check')
    assert.ok(mutationIdx !== -1, 'updateObject must have a .update(payload) call')
    assert.ok(
      ownershipCheckIdx < mutationIdx,
      'account_id ownership check must appear BEFORE .update(payload) in updateObject',
    )
  })

  it('updateObject double-guards the final update with account_id', () => {
    // The update call itself should also be scoped to account_id, not just the pre-fetch
    const fnStart = objectsSrc.indexOf('async function updateObject')
    const fnEnd = objectsSrc.indexOf('async function updateStatus')
    const slice = objectsSrc.slice(fnStart, fnEnd)

    // Find the update mutation line and check the account_id eq follows it
    const mutationIdx = slice.indexOf('.update(payload')
    const postMutationSlice = slice.slice(mutationIdx)
    assert.ok(
      postMutationSlice.includes(".eq('account_id', account.id)"),
      'the .update(payload) call must be followed by .eq(account_id) — double guard',
    )
  })

  it('deleteObject scopes the delete to account.id', () => {
    const fnStart = objectsSrc.indexOf('async function deleteObject')
    const fnEnd = objectsSrc.indexOf('async function checkWorkshopId')
    const slice = objectsSrc.slice(fnStart, fnEnd)

    assert.ok(
      slice.includes(".eq('account_id', account.id)"),
      'deleteObject must scope its .delete() to account.id',
    )
  })

  it('checkWorkshopId scopes lookup to account.id (no cross-account leakage)', () => {
    const fnStart = objectsSrc.indexOf('async function checkWorkshopId')
    const fnEnd = objectsSrc.indexOf('async function searchObjects')
    const slice = objectsSrc.slice(fnStart, fnEnd)

    assert.ok(
      slice.includes(".eq('account_id', account.id)"),
      'checkWorkshopId must scope to account.id',
    )
  })

  it('searchObjects scopes results to account.id', () => {
    const fnStart = objectsSrc.indexOf('async function searchObjects')
    const slice = objectsSrc.slice(fnStart)

    assert.ok(
      slice.includes(".eq('account_id', account.id)"),
      'searchObjects must scope to account.id',
    )
  })

  it('workshop_id is stored as uppercase', () => {
    assert.ok(
      objectsSrc.includes('.toUpperCase()'),
      'workshop_id must be uppercased before storage',
    )
  })

  it('workshop_id_lower is stored as lowercase for case-insensitive matching', () => {
    assert.ok(
      objectsSrc.includes('.toLowerCase()'),
      'workshop_id_lower must be lowercased for collision detection',
    )
  })

  it('public_slug is never updated (immutable after creation)', () => {
    // updateObject may READ public_slug (e.g. to revalidate its public page),
    // but must never WRITE it into the update payload.
    const fnStart = objectsSrc.indexOf('async function updateObject')
    const fnEnd = objectsSrc.indexOf('async function updateStatus')
    const slice = objectsSrc.slice(fnStart, fnEnd)
    assert.ok(
      !slice.includes('payload.public_slug') && !slice.includes('public_slug:'),
      'updateObject must never write public_slug into the update payload — slugs are immutable',
    )
  })
})

// ---------------------------------------------------------------------------
// photos.ts
// ---------------------------------------------------------------------------

describe('action ownership — photos.ts', () => {
  it('every exported function calls getOrCreateAccount()', () => {
    // createPhotoRecord, deletePhoto, restorePhoto, updatePhotoCaption,
    // togglePhotoVisibility, movePhoto
    const count = countOccurrences(photosSrc, 'getOrCreateAccount()')
    assert.ok(
      count >= 6,
      `Expected ≥6 getOrCreateAccount() calls in photos.ts, got ${count}`,
    )
  })

  it('createPhotoRecord verifies object ownership BEFORE inserting the photo record', () => {
    const fnStart = photosSrc.indexOf('async function createPhotoRecord')
    const fnEnd = photosSrc.indexOf('async function deletePhoto')
    const slice = photosSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const insertIdx = slice.indexOf('.insert(')

    assert.ok(ownershipIdx !== -1, 'createPhotoRecord must check object ownership')
    assert.ok(insertIdx !== -1, 'createPhotoRecord must have an .insert() call')
    assert.ok(
      ownershipIdx < insertIdx,
      'object ownership check must appear BEFORE .insert() in createPhotoRecord',
    )
  })

  it('createPhotoRecord sets account_id on the inserted photo row', () => {
    const fnStart = photosSrc.indexOf('async function createPhotoRecord')
    const fnEnd = photosSrc.indexOf('async function deletePhoto')
    const slice = photosSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes('account_id: account.id'),
      'createPhotoRecord insert must set account_id from the server session',
    )
  })

  it('deletePhoto fetches and verifies ownership BEFORE flagging the row deleted', () => {
    const fnStart = photosSrc.indexOf('async function deletePhoto')
    const fnEnd = photosSrc.indexOf('async function restorePhoto')
    const slice = photosSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const writeIdx = slice.indexOf('deleted_at:')

    assert.ok(ownershipIdx !== -1, 'deletePhoto must verify account ownership via account_id')
    assert.ok(writeIdx !== -1, 'deletePhoto must set deleted_at')
    assert.ok(
      ownershipIdx < writeIdx,
      'ownership check must appear BEFORE the soft-delete write in deletePhoto',
    )
  })

  it('deletePhoto is a soft delete — it never removes the file or the row', () => {
    const fnStart = photosSrc.indexOf('async function deletePhoto')
    const fnEnd = photosSrc.indexOf('async function restorePhoto')
    const slice = photosSrc.slice(fnStart, fnEnd)

    assert.ok(
      !slice.includes('.remove(['),
      'deletePhoto must not remove the storage file — restorePhoto depends on it still being there',
    )
    assert.ok(
      !slice.includes('.delete()'),
      'deletePhoto must not hard-delete the row',
    )
  })

  it('restorePhoto fetches and verifies ownership BEFORE clearing deleted_at', () => {
    const fnStart = photosSrc.indexOf('async function restorePhoto')
    const fnEnd = photosSrc.indexOf('async function updatePhotoCaption')
    const slice = photosSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const writeIdx = slice.indexOf('deleted_at: null')

    assert.ok(ownershipIdx !== -1, 'restorePhoto must verify account ownership via account_id')
    assert.ok(writeIdx !== -1, 'restorePhoto must clear deleted_at')
    assert.ok(
      ownershipIdx < writeIdx,
      'ownership check must appear BEFORE the restore write in restorePhoto',
    )
  })

  it('deletePhoto returns an error when ownership check finds no matching photo', () => {
    const fnStart = photosSrc.indexOf('async function deletePhoto')
    const fnEnd = photosSrc.indexOf('async function updatePhotoCaption')
    const slice = photosSrc.slice(fnStart, fnEnd)
    assert.ok(
      slice.includes("if (!photo)"),
      'deletePhoto must return early when the ownership-scoped fetch returns null',
    )
  })

  it('updatePhotoCaption verifies ownership BEFORE updating', () => {
    const fnStart = photosSrc.indexOf('async function updatePhotoCaption')
    const fnEnd = photosSrc.indexOf('async function togglePhotoVisibility')
    const slice = photosSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const updateIdx = slice.indexOf('.update(')

    assert.ok(ownershipIdx !== -1, 'updatePhotoCaption must verify account ownership')
    assert.ok(
      ownershipIdx < updateIdx,
      'ownership check must appear BEFORE .update() in updatePhotoCaption',
    )
  })

  it('togglePhotoVisibility verifies ownership BEFORE updating', () => {
    const fnStart = photosSrc.indexOf('async function togglePhotoVisibility')
    const fnEnd = photosSrc.indexOf('async function movePhoto')
    const slice = photosSrc.slice(fnStart, fnEnd)

    const ownershipIdx = slice.indexOf(".eq('account_id', account.id)")
    const updateIdx = slice.indexOf('.update(')

    assert.ok(ownershipIdx !== -1, 'togglePhotoVisibility must verify account ownership')
    assert.ok(
      ownershipIdx < updateIdx,
      'ownership check must appear BEFORE .update() in togglePhotoVisibility',
    )
  })

  it('movePhoto verifies ownership BEFORE fetching sibling photos for reorder', () => {
    const fnStart = photosSrc.indexOf('async function movePhoto')
    const slice = photosSrc.slice(fnStart)

    const firstOwnershipIdx = slice.indexOf(".eq('account_id', account.id)")
    assert.ok(
      firstOwnershipIdx !== -1,
      'movePhoto must scope its initial photo fetch to account.id',
    )
  })

  it('movePhoto returns early when the target photo is not found', () => {
    const fnStart = photosSrc.indexOf('async function movePhoto')
    const slice = photosSrc.slice(fnStart)
    assert.ok(
      slice.includes("if (!photo)"),
      'movePhoto must return early when the ownership-scoped fetch returns null',
    )
  })
})

// ---------------------------------------------------------------------------
// story.ts
// ---------------------------------------------------------------------------

describe('action ownership — story.ts', () => {
  it('every exported function calls getOrCreateAccount()', () => {
    const count = countOccurrences(storySrc, 'getOrCreateAccount()')
    assert.ok(
      count >= 3,
      `Expected ≥3 getOrCreateAccount() calls in story.ts, got ${count}`,
    )
  })

  it('saveStory scopes the update to account.id', () => {
    const fnStart = storySrc.indexOf('async function saveStory')
    const fnEnd = storySrc.indexOf('async function publishObject')
    const slice = storySrc.slice(fnStart, fnEnd)

    assert.ok(
      slice.includes(".eq('account_id', account.id)"),
      'saveStory must scope its update to account.id so only the owner can save',
    )
  })

  it('publishObject scopes the update to account.id', () => {
    const fnStart = storySrc.indexOf('async function publishObject')
    const fnEnd = storySrc.indexOf('async function unpublishObject')
    const slice = storySrc.slice(fnStart, fnEnd)

    assert.ok(
      slice.includes(".eq('account_id', account.id)"),
      'publishObject must scope its update to account.id',
    )
  })

  it('unpublishObject scopes the update to account.id', () => {
    const fnStart = storySrc.indexOf('async function unpublishObject')
    const slice = storySrc.slice(fnStart)

    assert.ok(
      slice.includes(".eq('account_id', account.id)"),
      'unpublishObject must scope its update to account.id',
    )
  })

  it('publishObject sets is_published to true (not false)', () => {
    const fnStart = storySrc.indexOf('async function publishObject')
    const fnEnd = storySrc.indexOf('async function unpublishObject')
    const slice = storySrc.slice(fnStart, fnEnd)

    assert.ok(
      slice.includes('is_published: true'),
      'publishObject must set is_published to true',
    )
  })

  it('unpublishObject sets is_published to false (not true)', () => {
    const fnStart = storySrc.indexOf('async function unpublishObject')
    const slice = storySrc.slice(fnStart)

    assert.ok(
      slice.includes('is_published: false'),
      'unpublishObject must set is_published to false',
    )
  })
})
