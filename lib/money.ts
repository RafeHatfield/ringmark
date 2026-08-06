/**
 * Money helpers. Shared by the object detail page, the market builder, and the
 * market print views.
 *
 * Everything in the system — DB columns, server actions, API payloads — is
 * INTEGER CENTS. Dollars exist only at the display/input boundary, which is
 * this file. All arithmetic here is integer arithmetic so no float rounding
 * artifact can ever reach the database.
 */

/** 12000 -> "$120", 12050 -> "$120.50". */
export function formatPrice(cents: number): string {
  const dollars = Math.trunc(cents / 100)
  const remainder = cents % 100
  return remainder === 0 ? `$${dollars}` : `$${dollars}.${String(remainder).padStart(2, '0')}`
}

/** Cents -> the bare dollar string an <input> should start with. Null -> ''. */
export function centsToInputValue(cents: number | null): string {
  if (cents == null) return ''
  const dollars = Math.trunc(cents / 100)
  const remainder = cents % 100
  return remainder === 0 ? String(dollars) : `${dollars}.${String(remainder).padStart(2, '0')}`
}

export type ParsedPrice = { cents: number | null } | { error: string }

/**
 * Parses what a person typed into the price field. Empty input means "no
 * price" (null), not zero — an unpriced piece and a free piece are different
 * things.
 */
export function parseDollarsToCents(input: string): ParsedPrice {
  const cleaned = input.trim().replace(/[$,\s]/g, '')
  if (!cleaned) return { cents: null }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { error: 'Enter a price like 120 or 120.50.' }
  }
  const [whole, frac = ''] = cleaned.split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return { error: 'That price is too large.' }
  return { cents }
}
