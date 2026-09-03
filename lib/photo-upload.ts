/**
 * Signed direct photo upload — pure helpers.
 *
 * Kept free of Supabase and Next so the token scheme and the format sniffing
 * are unit-testable without a database or a running server. The routes that
 * use these live in app/api/v1/objects/[id]/photos/upload-url and app/api/upload.
 */

import { createHash, randomBytes } from 'crypto'

/**
 * Body cap. Vercel's serverless request limit is 4.5 MB; this leaves headroom
 * so an oversized upload fails with our 413 and a useful message rather than
 * the platform's opaque one.
 */
export const UPLOAD_MAX_BYTES = 4_000_000

/** Reservation lifetime. Long enough to resize and upload, short enough to matter. */
export const UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000

/**
 * Formats accepted on upload. Matches the object-photos bucket's
 * allowed_mime_types (20260614000005_storage.sql) — keep the two in step.
 */
export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number]

/**
 * Storage extension per format. This is the *only* source of a file extension —
 * the caller-supplied filename never reaches the storage path, so there is no
 * client-controlled component in it.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

/** Maps a caller's filename to a whitelisted extension, defaulting to jpg. */
export function extensionForFilename(filename: string): string {
  const raw = filename.split('.').pop()?.toLowerCase() ?? ''
  const normalised = raw === 'jpeg' ? 'jpg' : raw === 'heif' ? 'heic' : raw
  return Object.values(EXTENSION_BY_MIME).includes(normalised) ? normalised : 'jpg'
}

export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime] ?? 'jpg'
}

// ── Token scheme ──────────────────────────────────────────────────────────────

export type MintedUploadToken = {
  /** Returned to the caller once. Never stored, never logged. */
  token: string
  /** SHA-256 hex. This is what goes in the database. */
  hash: string
  expiresAt: Date
}

/**
 * 32 random bytes, base64url. 256 bits of entropy against a single-use,
 * 15-minute-lived, row-bound credential — brute force is not a live concern,
 * which is why there is no rate limit in code on the redemption route.
 */
export function mintUploadToken(now: Date = new Date()): MintedUploadToken {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    hash: hashUploadToken(token),
    expiresAt: new Date(now.getTime() + UPLOAD_TOKEN_TTL_MS),
  }
}

export function hashUploadToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ── Format sniffing ───────────────────────────────────────────────────────────

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
])

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((b, i) => bytes[offset + i] === b)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

/**
 * Identifies the image format from its leading bytes.
 *
 * Deliberately does not consult the Content-Type header: a caller can claim
 * anything there, and this endpoint is authenticated only by a bearer token,
 * so the bytes are the only thing worth trusting.
 *
 * Returns null for anything not in ACCEPTED_MIME_TYPES.
 */
export function sniffImageMime(bytes: Uint8Array): AcceptedMimeType | null {
  // JPEG: SOI marker
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'

  // PNG: 8-byte signature
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'

  // WebP: RIFF container with a WEBP form type
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'

  // HEIC/HEIF: ISO-BMFF box with an ftyp header and a HEIF-family brand.
  // Stored as-is, exactly like the existing multipart upload path does — note
  // that Safari renders HEIC and most other browsers do not.
  if (ascii(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.has(ascii(bytes, 8, 4))) return 'image/heic'

  return null
}

// ── Reservation state ─────────────────────────────────────────────────────────

export type ReservationState = 'usable' | 'consumed' | 'expired'

/** Whether a pending row's token can still be redeemed. */
export function reservationState(
  row: { upload_consumed_at: string | null; upload_expires_at: string | null },
  now: Date = new Date(),
): ReservationState {
  if (row.upload_consumed_at) return 'consumed'
  if (!row.upload_expires_at || new Date(row.upload_expires_at).getTime() <= now.getTime()) {
    return 'expired'
  }
  return 'usable'
}
