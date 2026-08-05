import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── POST /api/v1/objects/:id/photos/:photoId/restore ─────────────────────────
//
// Reverses a soft delete, putting the photo back at its original sort_order.
// sort_order is never reclaimed while a photo is soft-deleted (see the comment
// in actions/photos.ts:createPhotoRecord), so restoring can't collide.

export async function POST(
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
    .select('id')
    .eq('id', photoId)
    .eq('object_id', object.id)
    .eq('account_id', account.id)
    .not('deleted_at', 'is', null)
    .maybeSingle()

  if (!photo) {
    return Response.json(
      { error: 'No deleted photo with that ID on this object' },
      { status: 404 }
    )
  }

  const { data: restored, error: restoreError } = await db
    .from('object_photos')
    .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
    .eq('id', photo.id)
    .eq('account_id', account.id)
    .select('id, object_id, storage_path, caption, is_public, sort_order, created_at')
    .single()

  if (restoreError || !restored) {
    return Response.json(
      { error: restoreError?.message ?? 'Restore failed' },
      { status: 500 }
    )
  }

  const { data: signedData } = await db.storage
    .from(BUCKET)
    .createSignedUrl(restored.storage_path, SIGNED_URL_EXPIRY_SECONDS)

  return Response.json({ ...restored, signed_url: signedData?.signedUrl ?? null })
}
