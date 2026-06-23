/**
 * API key authentication for REST API v1 routes.
 * Uses timing-safe comparison to prevent timing attacks.
 */

import { timingSafeEqual } from 'crypto'

export function verifyApiKey(request: Request): Response | null {
  const authHeader = request.headers.get('Authorization')
  const expectedKey = process.env.RINGMARK_API_KEY

  if (!expectedKey) {
    // Server misconfiguration — fail closed
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const providedKey = authHeader.slice('Bearer '.length)

  // Timing-safe comparison — never use === for secret comparison
  let keysMatch: boolean
  try {
    const expected = Buffer.from(expectedKey, 'utf-8')
    const provided = Buffer.from(providedKey, 'utf-8')

    if (expected.length !== provided.length) {
      // Length mismatch: compare expected against itself to consume constant time,
      // then return false — this prevents length-based timing leaks.
      timingSafeEqual(expected, expected)
      keysMatch = false
    } else {
      keysMatch = timingSafeEqual(expected, provided)
    }
  } catch {
    keysMatch = false
  }

  if (!keysMatch) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
