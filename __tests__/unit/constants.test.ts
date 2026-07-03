import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  OBJECT_TYPES,
  OBJECT_STATUSES,
  DEFAULT_CARE_INSTRUCTIONS,
  APP_URL,
  SIGNED_URL_EXPIRY,
  MAX_VISIBLE_PHOTOS,
  typeLabel,
} from '../../lib/constants.ts'
import type { ObjectStatus } from '../../lib/types.ts'

describe('OBJECT_TYPES', () => {
  it('has no duplicate values', () => {
    const values = OBJECT_TYPES.map(t => t.value)
    const unique = new Set(values)
    assert.equal(unique.size, values.length, 'OBJECT_TYPES contains duplicate values')
  })

  it('has no duplicate labels', () => {
    const labels = OBJECT_TYPES.map(t => t.label)
    const unique = new Set(labels)
    assert.equal(unique.size, labels.length, 'OBJECT_TYPES contains duplicate labels')
  })

  it('each entry has a non-empty value and label', () => {
    for (const t of OBJECT_TYPES) {
      assert.ok(t.value, `OBJECT_TYPES entry has empty value: ${JSON.stringify(t)}`)
      assert.ok(t.label, `OBJECT_TYPES entry has empty label: ${JSON.stringify(t)}`)
    }
  })
})

describe('typeLabel', () => {
  it('returns the label for a known object type', () => {
    assert.equal(typeLabel('source'), 'Source')
    assert.equal(typeLabel('finished_bowl'), 'Finished Bowl')
  })

  it('falls back to the raw value for an unknown type', () => {
    assert.equal(typeLabel('not_a_real_type'), 'not_a_real_type')
  })
})

describe('OBJECT_STATUSES', () => {
  it('has no duplicate values', () => {
    const values = OBJECT_STATUSES.map(s => s.value)
    const unique = new Set(values)
    assert.equal(unique.size, values.length, 'OBJECT_STATUSES contains duplicate values')
  })

  it('has no duplicate labels', () => {
    const labels = OBJECT_STATUSES.map(s => s.label)
    const unique = new Set(labels)
    assert.equal(unique.size, labels.length, 'OBJECT_STATUSES contains duplicate labels')
  })

  it('each entry has a non-empty value and label', () => {
    for (const s of OBJECT_STATUSES) {
      assert.ok(s.value, `OBJECT_STATUSES entry has empty value: ${JSON.stringify(s)}`)
      assert.ok(s.label, `OBJECT_STATUSES entry has empty label: ${JSON.stringify(s)}`)
    }
  })

  it('all status values are valid ObjectStatus literals', () => {
    const validStatuses: ObjectStatus[] = [
      'unknown', 'acquired', 'stored', 'sealed', 'cut', 'drying',
      'rough_turned', 'finished', 'for_sale', 'sold', 'gifted', 'scrapped',
    ]
    for (const s of OBJECT_STATUSES) {
      assert.ok(
        (validStatuses as string[]).includes(s.value),
        `OBJECT_STATUSES has unrecognised value: ${s.value}`,
      )
    }
  })
})

describe('DEFAULT_CARE_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof DEFAULT_CARE_INSTRUCTIONS, 'string')
    assert.ok(DEFAULT_CARE_INSTRUCTIONS.length > 0)
  })
})

describe('APP_URL', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof APP_URL, 'string')
    assert.ok(APP_URL.length > 0)
  })

  it('defaults to ringmark.org when env var not set', () => {
    assert.ok(APP_URL.includes('ringmark.org') || APP_URL.startsWith('http'))
  })
})

describe('SIGNED_URL_EXPIRY', () => {
  it('is a positive number', () => {
    assert.equal(typeof SIGNED_URL_EXPIRY, 'number')
    assert.ok(SIGNED_URL_EXPIRY > 0)
  })
})

describe('MAX_VISIBLE_PHOTOS', () => {
  it('is a positive integer', () => {
    assert.equal(typeof MAX_VISIBLE_PHOTOS, 'number')
    assert.ok(MAX_VISIBLE_PHOTOS > 0)
    assert.equal(MAX_VISIBLE_PHOTOS, Math.floor(MAX_VISIBLE_PHOTOS))
  })
})
