/**
 * PUT /api/upload
 *
 * Redeems an upload token minted by POST /api/v1/objects/:id/photos/upload-url
 * and stores the request body as that photo's image.
 *
 * This route has no session and no account of its own. The token in the
 * Authorization header resolves to exactly one object_photos row, which is
 * already bound to one object and one account, so there is nothing for a
 * caller to redirect: the row decides where the bytes go, not the request.
 *
 * The token travels in the header rather than the path because Vercel's
 * request logs record full paths. A 15-minute single-use credential in a log
 * is a small exposure, but a free one to avoid.
 *
 * Node runtime: needs Buffer and the service-role Supabase client.
 */

import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import {
  ACCEPTED_MIME_TYPES,
  UPLOAD_MAX_BYTES,
  extensionForMime,
  hashUploadToken,
  readImageDimensions,
  reservationState,
  sniffImageMime,
} from '@/lib/photo-upload'

export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

/**
 * Reads the body, refusing to buffer more than the cap.
 *
 * Content-Length is checked first so an oversized upload is rejected before a
 * single chunk is held, but it is only a hint — the stream is hard-stopped at
 * the same limit for a caller that lies or omits it.
 */
async function readBodyCapped(request: Request): Promise<Buffer | 'too-large'> {
  const declared = request.headers.get('content-length')
  if (declared && Number(declared) > UPLOAD_MAX_BYTES) return 'too-large'

  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > UPLOAD_MAX_BYTES) {
      await reader.cancel()
      return 'too-large'
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks)
}

export async function PUT(request: Request) {
  const authHeader = request.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return Response.json({ error: 'Missing upload token' }, { status: 401 })
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return Response.json({ error: 'Missing upload token' }, { status: 401 })
  }

  const db = createServiceClient()

  const { data: photo } = await db
    .from('object_photos')
    .select('id, account_id, object_id, storage_path, caption, is_public, sort_order, status, upload_expires_at, upload_consumed_at, created_at')
    .eq('upload_token_hash', hashUploadToken(token))
    .maybeSingle()

  // An unknown hash and a consumed-then-nulled hash are indistinguishable here,
  // which is intended: neither tells the caller anything about the other.
  if (!photo) {
    return Response.json({ error: 'Unknown or already-used upload token' }, { status: 404 })
  }

  const state = reservationState(photo)
  if (state !== 'usable') {
    return Response.json(
      {
        error:
          state === 'consumed'
            ? 'This upload token has already been used'
            : 'This upload token has expired. Request a new one with create_upload_url.',
      },
      { status: 410 }
    )
  }

  const body = await readBodyCapped(request)
  if (body === 'too-large') {
    return Response.json(
      { error: `Image exceeds the ${UPLOAD_MAX_BYTES} byte limit. Resize it and retry — the token is still valid.` },
      { status: 413 }
    )
  }
  if (body.length === 0) {
    return Response.json({ error: 'Request body is empty' }, { status: 400 })
  }

  // Bytes, not the Content-Type header. The header is caller-supplied and this
  // route trusts nothing a caller says about the payload.
  const mime = sniffImageMime(body)
  if (!mime) {
    return Response.json(
      { error: `Body is not a supported image. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}. The token is still valid.` },
      { status: 415 }
    )
  }

  // The reserved path's extension came from the caller's filename; the sniffed
  // format is authoritative, so correct it if they disagree.
  const expectedExt = extensionForMime(mime)
  const storagePath = photo.storage_path.replace(/\.[^./]+$/, `.${expectedExt}`)

  // Null for HEIC and for anything whose header won't parse. Not an error —
  // the columns are nullable and nothing renders differently without them.
  const dimensions = readImageDimensions(body)

  const { error: storageError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType: mime, upsert: true })

  if (storageError) {
    // Row stays pending and the token stays live, so the caller can just retry
    // until it expires.
    return Response.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 })
  }

  const { data: updated, error: updateError } = await db
    .from('object_photos')
    .update({
      status: 'live',
      storage_path: storagePath,
      bytes: body.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      upload_consumed_at: new Date().toISOString(),
      upload_token_hash: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photo.id)
    .eq('status', 'pending')
    .select('id, object_id, storage_path, caption, is_public, sort_order, status, bytes, width, height, created_at')
    .single()

  if (updateError || !updated) {
    // Bytes are in Storage but the row never went live. The daily sweep will
    // remove both, but this is the one ordering hazard in the flow, so it is
    // reported rather than left to a log nobody reads.
    Sentry.captureException(
      new Error(`Upload stored but photo row not finalised: ${updateError?.message ?? 'no row updated'}`),
      { extra: { photoId: photo.id, storagePath } }
    )
    return Response.json(
      { error: 'Image was stored but the photo record could not be finalised. It will be cleaned up automatically.' },
      { status: 500 }
    )
  }

  const { data: signedData } = await db.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS)

  return Response.json({ ...updated, signed_url: signedData?.signedUrl ?? null })
}
