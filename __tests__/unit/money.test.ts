/**
 * lib/money.ts — the dollars/cents boundary.
 *
 * Every price in this system is an integer number of cents. Dollars exist only
 * where a person types or reads one, and this file is that boundary. Getting it
 * wrong is quiet and expensive: a float artifact turns $19.99 into 1998 cents,
 * an empty field turns an unpriced piece into a free one.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatPrice, centsToInputValue, parseDollarsToCents } from '../../lib/money.ts'

function cents(result: ReturnType<typeof parseDollarsToCents>): number | null {
  assert.ok(!('error' in result), `expected a parsed value, got error: ${JSON.stringify(result)}`)
  return result.cents
}

describe('formatPrice', () => {
  it('drops the decimals on whole dollars', () => {
    assert.equal(formatPrice(12000), '$120')
    assert.equal(formatPrice(100), '$1')
  })

  it('pads a single-digit remainder', () => {
    // 12005 is $120.05, not $120.5 — the classic off-by-a-factor-of-ten bug.
    assert.equal(formatPrice(12005), '$120.05')
    assert.equal(formatPrice(12050), '$120.50')
  })

  it('handles zero and sub-dollar amounts', () => {
    assert.equal(formatPrice(0), '$0')
    assert.equal(formatPrice(5), '$0.05')
    assert.equal(formatPrice(99), '$0.99')
  })

  it('stays exact on values a float round-trip would corrupt', () => {
    assert.equal(formatPrice(1999), '$19.99')
    assert.equal(formatPrice(1000000), '$10000')
  })
})

describe('centsToInputValue', () => {
  it('renders null as an empty field, not as zero', () => {
    // An unpriced piece and a free piece are different things.
    assert.equal(centsToInputValue(null), '')
  })

  it('renders a bare number with no currency symbol', () => {
    assert.equal(centsToInputValue(12000), '120')
    assert.equal(centsToInputValue(12050), '120.50')
    assert.equal(centsToInputValue(0), '0')
  })
})

describe('parseDollarsToCents', () => {
  it('treats empty input as no price rather than zero', () => {
    assert.equal(cents(parseDollarsToCents('')), null)
    assert.equal(cents(parseDollarsToCents('   ')), null)
  })

  it('parses whole dollars and cents', () => {
    assert.equal(cents(parseDollarsToCents('120')), 12000)
    assert.equal(cents(parseDollarsToCents('120.50')), 12050)
    assert.equal(cents(parseDollarsToCents('0.99')), 99)
    assert.equal(cents(parseDollarsToCents('0')), 0)
  })

  it('treats a single decimal place as tenths', () => {
    // "120.5" means $120.50, not $120.05.
    assert.equal(cents(parseDollarsToCents('120.5')), 12050)
  })

  it('is immune to the float artifact that breaks naive parsing', () => {
    // parseFloat('19.99') * 100 === 1998.9999999999998 — truncating gives 1998.
    assert.equal(cents(parseDollarsToCents('19.99')), 1999)
    assert.equal(cents(parseDollarsToCents('1.10')), 110)
    assert.equal(cents(parseDollarsToCents('2.30')), 230)
  })

  it('tolerates what people actually type', () => {
    assert.equal(cents(parseDollarsToCents('$120')), 12000)
    assert.equal(cents(parseDollarsToCents(' 120.50 ')), 12050)
    assert.equal(cents(parseDollarsToCents('1,200')), 120000)
  })

  it('rejects malformed input instead of guessing', () => {
    for (const bad of ['abc', '12.345', '1.2.3', '-5', '12-', '1e3']) {
      const result = parseDollarsToCents(bad)
      assert.ok('error' in result, `expected "${bad}" to be rejected, got ${JSON.stringify(result)}`)
    }
  })

  it('rejects values too large to represent exactly', () => {
    const result = parseDollarsToCents('999999999999999999')
    assert.ok('error' in result, 'unsafe integers must be rejected, not silently rounded')
  })
})

describe('round trip', () => {
  it('survives cents -> input -> cents unchanged', () => {
    // This is the loop the edit form and the market price editor both run: read
    // a stored price into a field, let it be re-submitted untouched, store it.
    // Drift here silently rewrites prices on every save.
    for (const original of [0, 5, 99, 100, 1999, 12000, 12050, 123456]) {
      assert.equal(
        cents(parseDollarsToCents(centsToInputValue(original))),
        original,
        `round trip changed ${original}`,
      )
    }
  })
})
