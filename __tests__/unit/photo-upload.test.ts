/**
 * Signed direct upload — token scheme and format sniffing.
 *
 * These are the two pieces of the upload flow that carry security weight and
 * can be tested without a database: the token must be unguessable and stored
 * only as a hash, and the format check must go by bytes rather than by anything
 * the caller claims. The route-level behaviour (expiry, single use, 413/415)
 * is covered in e2e/photo-direct-upload.spec.ts.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  UPLOAD_TOKEN_TTL_MS,
  extensionForFilename,
  extensionForMime,
  hashUploadToken,
  mintUploadToken,
  reservationState,
  sniffImageMime,
} from '../../lib/photo-upload.ts'

// ── Token scheme ──────────────────────────────────────────────────────────────

describe('mintUploadToken', () => {
  it('produces a distinct token every time', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintUploadToken().token))
    assert.equal(tokens.size, 200)
  })

  it('encodes 32 bytes as URL-safe base64 with no padding', () => {
    const { token } = mintUploadToken()
    assert.match(token, /^[A-Za-z0-9_-]+$/)
    assert.equal(Buffer.from(token, 'base64url').length, 32)
  })

  it('stores the SHA-256 hash, never the token itself', () => {
    const { token, hash } = mintUploadToken()
    assert.equal(hash, createHash('sha256').update(token).digest('hex'))
    assert.notEqual(hash, token)
    assert.equal(hash.length, 64)
  })

  it('expires 15 minutes out', () => {
    const now = new Date('2026-09-02T12:00:00.000Z')
    const { expiresAt } = mintUploadToken(now)
    assert.equal(expiresAt.getTime() - now.getTime(), UPLOAD_TOKEN_TTL_MS)
    assert.equal(expiresAt.toISOString(), '2026-09-02T12:15:00.000Z')
  })
})

describe('hashUploadToken', () => {
  it('is deterministic, so a presented token resolves to its stored row', () => {
    assert.equal(hashUploadToken('abc'), hashUploadToken('abc'))
  })

  it('separates tokens differing by one character', () => {
    assert.notEqual(hashUploadToken('abc'), hashUploadToken('abd'))
  })
})

// ── Format sniffing ───────────────────────────────────────────────────────────

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])

function riff(formType: string): Buffer {
  const buf = Buffer.alloc(16)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(8, 4)
  buf.write(formType, 8, 'ascii')
  return buf
}

function isoBmff(brand: string): Buffer {
  const buf = Buffer.alloc(16)
  buf.writeUInt32BE(16, 0)
  buf.write('ftyp', 4, 'ascii')
  buf.write(brand, 8, 'ascii')
  return buf
}

describe('sniffImageMime', () => {
  it('identifies JPEG', () => assert.equal(sniffImageMime(JPEG), 'image/jpeg'))
  it('identifies PNG', () => assert.equal(sniffImageMime(PNG), 'image/png'))
  it('identifies WebP', () => assert.equal(sniffImageMime(riff('WEBP')), 'image/webp'))

  it('identifies the HEIF brand family iPhones actually emit', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'hevc']) {
      assert.equal(sniffImageMime(isoBmff(brand)), 'image/heic', `brand ${brand}`)
    }
  })

  it('rejects a text file renamed .jpg — the whole point of sniffing', () => {
    assert.equal(sniffImageMime(Buffer.from('not an image, just text\n')), null)
  })

  it('rejects other RIFF containers, which share WebP\'s first four bytes', () => {
    assert.equal(sniffImageMime(riff('AVI ')), null)
    assert.equal(sniffImageMime(riff('WAVE')), null)
  })

  it('rejects non-image ISO-BMFF, which shares HEIC\'s ftyp header', () => {
    assert.equal(sniffImageMime(isoBmff('mp42')), null)
    assert.equal(sniffImageMime(isoBmff('isom')), null)
  })

  it('rejects formats the bucket does not accept', () => {
    assert.equal(sniffImageMime(Buffer.from('GIF89a')), null)
    assert.equal(sniffImageMime(Buffer.from([0x42, 0x4d, 0x00, 0x00])), null) // BMP
    assert.equal(sniffImageMime(Buffer.from('%PDF-1.7')), null)
  })

  it('does not read past the end of a truncated buffer', () => {
    assert.equal(sniffImageMime(Buffer.alloc(0)), null)
    assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8])), null)
    assert.equal(sniffImageMime(Buffer.from('RIFF')), null)
    assert.equal(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null)
  })
})

// ── Extension whitelist ───────────────────────────────────────────────────────

describe('extensionForFilename', () => {
  it('normalises the aliases phones produce', () => {
    assert.equal(extensionForFilename('IMG_1719.jpeg'), 'jpg')
    assert.equal(extensionForFilename('IMG_1719.JPEG'), 'jpg')
    assert.equal(extensionForFilename('IMG_1719.heif'), 'heic')
  })

  it('passes through accepted extensions', () => {
    assert.equal(extensionForFilename('a.png'), 'png')
    assert.equal(extensionForFilename('a.webp'), 'webp')
    assert.equal(extensionForFilename('a.heic'), 'heic')
  })

  it('falls back to jpg rather than echoing anything unrecognised', () => {
    // The filename must never reach the storage path verbatim. Everything not
    // on the whitelist collapses to jpg, so traversal and script extensions
    // have nowhere to land.
    assert.equal(extensionForFilename('payload.php'), 'jpg')
    assert.equal(extensionForFilename('payload.svg'), 'jpg')
    assert.equal(extensionForFilename('../../../etc/passwd'), 'jpg')
    assert.equal(extensionForFilename('no-extension'), 'jpg')
    assert.equal(extensionForFilename(''), 'jpg')
    assert.equal(extensionForFilename('trailing.'), 'jpg')
  })
})

describe('extensionForMime', () => {
  it('maps every accepted type', () => {
    assert.equal(extensionForMime('image/jpeg'), 'jpg')
    assert.equal(extensionForMime('image/png'), 'png')
    assert.equal(extensionForMime('image/webp'), 'webp')
    assert.equal(extensionForMime('image/heic'), 'heic')
  })

  it('falls back to jpg for anything else', () => {
    assert.equal(extensionForMime('application/octet-stream'), 'jpg')
  })
})

// ── Reservation state ─────────────────────────────────────────────────────────

describe('reservationState', () => {
  const now = new Date('2026-09-02T12:00:00.000Z')
  const future = '2026-09-02T12:10:00.000Z'
  const past = '2026-09-02T11:50:00.000Z'

  it('is usable while unconsumed and unexpired', () => {
    assert.equal(
      reservationState({ upload_consumed_at: null, upload_expires_at: future }, now),
      'usable',
    )
  })

  it('is consumed once redeemed, regardless of remaining time', () => {
    assert.equal(
      reservationState({ upload_consumed_at: past, upload_expires_at: future }, now),
      'consumed',
    )
  })

  it('reports consumed before expired, so a reused token never reads as merely stale', () => {
    assert.equal(
      reservationState({ upload_consumed_at: past, upload_expires_at: past }, now),
      'consumed',
    )
  })

  it('is expired at exactly the expiry instant, not a moment after', () => {
    assert.equal(
      reservationState({ upload_consumed_at: null, upload_expires_at: now.toISOString() }, now),
      'expired',
    )
  })

  it('treats a missing expiry as expired rather than as never expiring', () => {
    assert.equal(
      reservationState({ upload_consumed_at: null, upload_expires_at: null }, now),
      'expired',
    )
  })
})
