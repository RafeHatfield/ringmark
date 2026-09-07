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

// ── Dimensions ────────────────────────────────────────────────────────────────

export type ImageDimensions = { width: number; height: number }

/**
 * Reads pixel dimensions out of an image's header bytes.
 *
 * Hand-parsed rather than delegated to sharp or image-size. Dimensions live in
 * the first few dozen bytes of every format here, so a dependency — especially a
 * native one in a serverless bundle — buys nothing a small reader can't do.
 *
 * Returns null when the dimensions can't be determined. That is not an error:
 * the columns are nullable, HEIC is deliberately unsupported (its dimensions sit
 * in a nested ISO-BMFF `ispe` box, which is a real parser rather than a header
 * read), and a photo is perfectly usable without them.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  switch (sniffImageMime(bytes)) {
    case 'image/jpeg': return jpegDimensions(bytes)
    case 'image/png': return pngDimensions(bytes)
    case 'image/webp': return webpDimensions(bytes)
    // HEIC: see above. Stored fine, just unmeasured.
    default: return null
  }
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i] << 8) | b[i + 1]
}

function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}

function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8)
}

function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
}

/**
 * Walks JPEG marker segments to the first Start Of Frame.
 *
 * The frame header is not at a fixed offset — a phone photo puts EXIF, ICC and
 * thumbnail segments ahead of it — so the segments have to be walked rather
 * than indexed into.
 */
function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  let i = 2 // past the SOI marker

  while (i + 3 < b.length) {
    // Not aligned on a marker: give up rather than guess at an offset.
    if (b[i] !== 0xff) return null

    const marker = b[i + 1]

    // Padding between segments is legal and encoded as repeated 0xFF.
    if (marker === 0xff) { i++; continue }

    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }

    const segmentLength = u16be(b, i + 2)
    if (segmentLength < 2) return null

    // SOF0–SOF15 hold the frame header. C4 (DHT), C8 (JPG) and CC (DAC) share
    // the marker range but are not frame headers.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

    if (isStartOfFrame) {
      // Payload is precision, then height, then width.
      if (i + 8 >= b.length) return null
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) }
    }

    i += 2 + segmentLength
  }

  return null
}

/** PNG puts width and height at a fixed offset in the mandatory IHDR chunk. */
function pngDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null
  return { width: u32be(b, 16), height: u32be(b, 20) }
}

/** WebP has three container variants, each storing its size differently. */
function webpDimensions(b: Uint8Array): ImageDimensions | null {
  const chunk = b.length >= 16 ? String.fromCharCode(b[12], b[13], b[14], b[15]) : ''

  // Lossy: VP8 keyframe header, behind a 3-byte start code.
  if (chunk === 'VP8 ') {
    if (b.length < 30) return null
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }

  // Lossless: 14 bits each, packed little-endian, stored as size-1.
  if (chunk === 'VP8L') {
    if (b.length < 25) return null
    if (b[20] !== 0x2f) return null
    const packed = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    }
  }

  // Extended (alpha, animation, EXIF): canvas size as 24-bit, also size-1.
  if (chunk === 'VP8X') {
    if (b.length < 30) return null
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  }

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
