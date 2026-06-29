import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── PATCH /api/v1/objects/:id/photos/:photoId ─────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id, photoId } = await params
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  const object = await resolveObject(id, account.id, db)
  if (!object) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  const { data: photo } = await db
    .from('object_photos')
    .select('id, storage_path')
    .eq('id', photoId)
    .eq('object_id', object.id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!photo) {
    return Response.json({ error: 'Photo not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!('caption' in body)) {
    return Response.json({ error: 'Body must include "caption"' }, { status: 400 })
  }

  const caption = typeof body.caption === 'string' ? body.caption.trim() || null : null

  const { data: updated, error: updateError } = await db
    .from('object_photos')
    .update({ caption, updated_at: new Date().toISOString() })
    .eq('id', photo.id)
    .eq('account_id', account.id)
    .select('id, object_id, storage_path, caption, is_public, sort_order, created_at')
    .single()

  if (updateError || !updated) {
    return Response.json({ error: updateError?.message ?? 'Update failed' }, { status: 500 })
  }

  const { data: signedData } = await db.storage
    .from(BUCKET)
    .createSignedUrl(updated.storage_path, SIGNED_URL_EXPIRY_SECONDS)

  return Response.json({ ...updated, signed_url: signedData?.signedUrl ?? null })
}

// ── DELETE /api/v1/objects/:id/photos/:photoId ────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id, photoId } = await params
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  // Verify the object exists and belongs to this account
  const object = await resolveObject(id, account.id, db)
  if (!object) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  // Fetch the photo, confirming it belongs to this object and account
  const { data: photo } = await db
    .from('object_photos')
    .select('id, storage_path')
    .eq('id', photoId)
    .eq('object_id', object.id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!photo) {
    return Response.json({ error: 'Photo not found' }, { status: 404 })
  }

  // Remove from storage (best-effort — log but don't block on failure)
  const { error: storageError } = await db.storage
    .from(BUCKET)
    .remove([photo.storage_path])
  if (storageError) {
    console.error('[delete photo] storage remove failed:', storageError.message)
  }

  // Delete the DB record
  const { error: deleteError } = await db
    .from('object_photos')
    .delete()
    .eq('id', photo.id)
    .eq('account_id', account.id)

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 })
  }

  return new Response(null, { status: 204 })
}
