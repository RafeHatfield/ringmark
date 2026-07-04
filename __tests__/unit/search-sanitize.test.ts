import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSearch } from '../../lib/utils.ts'

describe('sanitizeSearch', () => {
  it('leaves plain alphanumeric queries untouched', () => {
    assert.equal(sanitizeSearch('bowl'), 'bowl')
    assert.equal(sanitizeSearch('RH1'), 'RH1')
  })

  it('trims surrounding whitespace', () => {
    assert.equal(sanitizeSearch('  bowl  '), 'bowl')
  })

  it('caps length at 100 characters', () => {
    const long = 'a'.repeat(150)
    assert.equal(sanitizeSearch(long).length, 100)
  })

  it('strips PostgREST structural characters', () => {
    assert.equal(sanitizeSearch('bowl, maple'), 'bowl maple')
    assert.equal(sanitizeSearch('bowl(maple)'), 'bowlmaple')
    assert.equal(sanitizeSearch('bowl "maple"'), 'bowl maple')
  })

  it('escapes ilike wildcards', () => {
    assert.equal(sanitizeSearch('50%'), '50\\%')
    assert.equal(sanitizeSearch('a_b'), 'a\\_b')
  })

  it('escapes backslashes before wildcard escaping introduces new ones', () => {
    assert.equal(sanitizeSearch('a\\b'), 'a\\\\b')
  })
})
