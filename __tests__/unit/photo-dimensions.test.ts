/**
 * Pixel dimension parsing.
 *
 * readImageDimensions() reads width and height straight out of an image's
 * header rather than decoding it, so these tests care about two things: that it
 * agrees with a real encoder, and that it refuses to guess when the bytes are
 * malformed or truncated.
 *
 * The PNG and WebP fixtures are genuine Pillow output, small enough to inline.
 * The JPEG cases are constructed, because the interesting behaviour there is
 * the marker walk — a phone puts kilobytes of EXIF, ICC and thumbnail data
 * ahead of the frame header — and building those segments explicitly is clearer
 * than shipping a large binary blob and hoping it contains them.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readImageDimensions } from '../../lib/photo-upload.ts'

// ── Real encoder output (Pillow) ──────────────────────────────────────────────

const PNG_17x43 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABEAAAArCAIAAAAR7vRmAAAAMElEQVR4nO3QsQ0AIBDDQH/Yf2ckmCDty+6v8UwOZWmB5hX6okGDBo0PfqEvGraZC7S5AFwqWXPZAAAAAElFTkSuQmCC',
  'base64',
)

const WEBP_LOSSY_640x480 = Buffer.from(
  'UklGRlgCAABXRUJQVlA4IEwCAADQQwCdASqAAuABPpFIoU0lpCMiIAgAsBIJaW7hd2EbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99smIAAD+/9o7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'base64',
)

const WEBP_LOSSLESS_17x43 = Buffer.from(
  'UklGRh4AAABXRUJQVlA4TBEAAAAvEIAKAAfQhCY0of+BiOh/AAA=',
  'base64',
)

/** RGBA input, which Pillow writes as an extended VP8X container. */
const WEBP_VP8X_333x222 = Buffer.from(
  'UklGRuoAAABXRUJQVlA4WAoAAAAQAAAATAEA3QAAQUxQSBYAAAABB1DAiAgQSNqsf/7tj+h/cv/vv2wAVlA4IK4AAADwEgCdASpNAd4APm02mUmkIyKhICgAgA2JaW7hd2EbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkN4AP7/6lwAAAAAAAAAAAA=',
  'base64',
)

describe('readImageDimensions — real encoder output', () => {
  it('reads a PNG', () => {
    assert.deepEqual(readImageDimensions(PNG_17x43), { width: 17, height: 43 })
  })

  it('reads a lossy WebP', () => {
    assert.deepEqual(readImageDimensions(WEBP_LOSSY_640x480), { width: 640, height: 480 })
  })

  it('reads a lossless WebP', () => {
    assert.deepEqual(readImageDimensions(WEBP_LOSSLESS_17x43), { width: 17, height: 43 })
  })

  it('reads an extended (VP8X) WebP, where the size is the canvas', () => {
    assert.deepEqual(readImageDimensions(WEBP_VP8X_333x222), { width: 333, height: 222 })
  })
})

// ── JPEG construction helpers ─────────────────────────────────────────────────

/** A marker segment: FF, marker, 2-byte length covering itself, then payload. */
function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header[0] = 0xff
  header[1] = marker
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

/** SOF payload: precision, height, width, component count. */
function sofPayload(width: number, height: number): Buffer {
  const p = Buffer.alloc(6)
  p[0] = 8
  p.writeUInt16BE(height, 1)
  p.writeUInt16BE(width, 3)
  p[5] = 3
  return p
}

function jpeg(width: number, height: number, opts: { before?: Buffer[]; sofMarker?: number } = {}): Buffer {
  const { before = [], sofMarker = 0xc0 } = opts
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    ...before,
    segment(sofMarker, sofPayload(width, height)),
  ])
}

describe('readImageDimensions — JPEG marker walk', () => {
  it('reads a frame header immediately after SOI', () => {
    assert.deepEqual(readImageDimensions(jpeg(640, 480)), { width: 640, height: 480 })
  })

  it('walks past a large EXIF segment, as a phone photo has', () => {
    const exif = segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), Buffer.alloc(4000)]))
    assert.deepEqual(
      readImageDimensions(jpeg(4032, 3024, { before: [exif] })),
      { width: 4032, height: 3024 },
    )
  })

  it('walks past several segments in a row', () => {
    const before = [
      segment(0xe0, Buffer.from('JFIF\0\0\0\0\0\0')), // APP0
      segment(0xe2, Buffer.alloc(600)),                                        // ICC
      segment(0xdb, Buffer.alloc(65)),                                         // quantisation table
      segment(0xc4, Buffer.alloc(30)),                                         // DHT — in the SOF range but not a frame
    ]
    assert.deepEqual(readImageDimensions(jpeg(1200, 900, { before })), { width: 1200, height: 900 })
  })

  it('is not fooled by DHT, JPG or DAC, which sit inside the SOF marker range', () => {
    for (const decoy of [0xc4, 0xc8, 0xcc]) {
      const bytes = jpeg(300, 200, { before: [segment(decoy, Buffer.alloc(20))] })
      assert.deepEqual(readImageDimensions(bytes), { width: 300, height: 200 }, `decoy ${decoy.toString(16)}`)
    }
  })

  it('reads progressive JPEG (SOF2) as well as baseline (SOF0)', () => {
    assert.deepEqual(readImageDimensions(jpeg(800, 600, { sofMarker: 0xc2 })), { width: 800, height: 600 })
  })

  it('tolerates 0xFF padding between segments', () => {
    const padded = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      segment(0xe0, Buffer.alloc(10)),
      Buffer.from([0xff, 0xff, 0xff]),
      segment(0xc0, sofPayload(120, 60)),
    ])
    assert.deepEqual(readImageDimensions(padded), { width: 120, height: 60 })
  })

  it('skips standalone markers, which carry no length field', () => {
    const withRestart = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xd0]), // RST0
      segment(0xc0, sofPayload(64, 32)),
    ])
    assert.deepEqual(readImageDimensions(withRestart), { width: 64, height: 32 })
  })
})

// ── Refusing to guess ─────────────────────────────────────────────────────────

describe('readImageDimensions — returns null rather than guessing', () => {
  it('returns null for HEIC, which is stored but deliberately unmeasured', () => {
    const heic = Buffer.alloc(32)
    heic.writeUInt32BE(32, 0)
    heic.write('ftyp', 4, 'ascii')
    heic.write('heic', 8, 'ascii')
    assert.equal(readImageDimensions(heic), null)
  })

  it('returns null for a non-image', () => {
    assert.equal(readImageDimensions(Buffer.from('just some text')), null)
    assert.equal(readImageDimensions(Buffer.alloc(0)), null)
  })

  it('returns null for a JPEG truncated before its frame header', () => {
    const truncated = jpeg(640, 480).subarray(0, 8)
    assert.equal(readImageDimensions(truncated), null)
  })

  it('returns null for a JPEG whose frame header is cut short', () => {
    const full = jpeg(640, 480)
    assert.equal(readImageDimensions(full.subarray(0, full.length - 4)), null)
  })

  it('returns null on a corrupt segment length rather than looping', () => {
    const corrupt = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x00]), // length 0 — impossible, minimum is 2
      segment(0xc0, sofPayload(100, 100)),
    ])
    assert.equal(readImageDimensions(corrupt), null)
  })

  it('returns null for a truncated PNG', () => {
    assert.equal(readImageDimensions(PNG_17x43.subarray(0, 20)), null)
  })

  it('returns null for a WebP whose VP8 start code is wrong', () => {
    const broken = Buffer.from(WEBP_LOSSY_640x480)
    broken[23] = 0x00
    assert.equal(readImageDimensions(broken), null)
  })

  it('returns null for a RIFF container that is not WebP', () => {
    const avi = Buffer.alloc(32)
    avi.write('RIFF', 0, 'ascii')
    avi.write('AVI ', 8, 'ascii')
    assert.equal(readImageDimensions(avi), null)
  })
})

// ── Boundaries ────────────────────────────────────────────────────────────────

describe('readImageDimensions — boundaries', () => {
  it('handles a 1×1 image', () => {
    assert.deepEqual(readImageDimensions(jpeg(1, 1)), { width: 1, height: 1 })
  })

  it('handles JPEG at its 65535px maximum', () => {
    assert.deepEqual(readImageDimensions(jpeg(65535, 65535)), { width: 65535, height: 65535 })
  })

  it('keeps width and height the right way round', () => {
    // The JPEG frame header stores height first, so a transposed read would
    // pass every square-image test and fail on real photos.
    const portrait = readImageDimensions(jpeg(3024, 4032))
    assert.deepEqual(portrait, { width: 3024, height: 4032 })
    assert.ok(portrait!.height > portrait!.width, 'portrait must stay portrait')
  })
})
