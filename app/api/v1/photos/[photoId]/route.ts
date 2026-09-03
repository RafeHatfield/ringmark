/**
 * GET /api/v1/photos/:photoId
 *
 * Reads a single photo's current state, account-scoped. Backs the
 * confirm_upload MCP tool: after a direct upload the PUT response already
 * carries the finished record, so this exists for the case where that response
 * was lost and the caller needs to know whether the bytes landed.
 *
 * Flat rather than nested under /objects/:id because the caller has a photo id
 * and nothing else — a reservation is identified by the photo it created.
 * Photo ids are UUIDs, and the account filter is what scopes the lookup.
 *
 * Read-only. It never consumes or extends a reservation.
 */

import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { reservationState } from '@/lib/photo-upload'

export const runtime = 'nodejs'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

export async function GET(
  request: Request,
  { params }: { params: Promise<{ photoId: string }> }
) {
  const { photoId } = await params
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  const { data: photo } = await db
    .from('object_photos')
    .select('id, object_id, storage_path, caption, is_public, sort_order, status, bytes, created_at, deleted_at, upload_expires_at, upload_consumed_at')
    .eq('id', photoId)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!photo) {
    return Response.json({ error: 'Photo not found' }, { status: 404 })
  }

  // Only a live photo has bytes behind its storage_path, so only a live photo
  // gets a signed URL. Signing a pending path would hand back a URL that 404s.
  let signedUrl: string | null = null
  if (photo.status === 'live' && !photo.deleted_at) {
    const { data } = await db.storage
      .from(BUCKET)
      .createSignedUrl(photo.storage_path, SIGNED_URL_EXPIRY_SECONDS)
    signedUrl = data?.signedUrl ?? null
  }

  const pending = photo.status === 'pending'
  const state = pending ? reservationState(photo) : null

  return Response.json({
    id: photo.id,
    object_id: photo.object_id,
    storage_path: photo.storage_path,
    caption: photo.caption,
    is_public: photo.is_public,
    sort_order: photo.sort_order,
    status: photo.status,
    bytes: photo.bytes,
    created_at: photo.created_at,
    deleted_at: photo.deleted_at,
    signed_url: signedUrl,
    upload_expires_at: pending ? photo.upload_expires_at : null,
    upload_state: state,
    message: !pending
      ? null
      : state === 'expired'
        ? 'The upload reservation expired before any bytes arrived. Call create_upload_url again for a fresh token.'
        : 'Reserved but no image uploaded yet. PUT the bytes to /api/upload with the token from create_upload_url.',
  })
}
