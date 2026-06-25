import { verifyApiKey } from '@/lib/api-auth'
import { createServiceClient, getAccount } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'

const BUCKET = 'object-photos'

// ── DELETE /api/v1/objects/:id/photos/:photoId ────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const { id, photoId } = await params
  const db = createServiceClient()
  const account = await getAccount(db)

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
