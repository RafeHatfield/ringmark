/**
 * GET /api/cron/sweep-pending-uploads
 *
 * Removes abandoned upload reservations. The common case is a client that
 * called create_upload_url and never sent the bytes — no storage object exists,
 * just a pending row. The rare case is a storage write that succeeded while the
 * finalising update failed, leaving an orphaned file; the storage remove below
 * catches that too and is a no-op otherwise.
 *
 * One hour of grace past expiry, so a reservation is never swept out from under
 * an upload that is mid-flight against a token that just lapsed.
 *
 * Scheduled hourly via vercel.json. Vercel signs cron invocations with
 * CRON_SECRET; the guard is fail-closed when that is configured.
 */

import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'object-photos'
const GRACE_MS = 60 * 60 * 1000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = createServiceClient()
  const cutoff = new Date(Date.now() - GRACE_MS).toISOString()

  // `status = 'pending'` is the load-bearing filter here: a live photo must
  // never be selected by this query under any condition. The expiry bound is
  // narrowing, not protective.
  const { data: stale, error: selectError } = await db
    .from('object_photos')
    .select('id, storage_path')
    .eq('status', 'pending')
    .lt('upload_expires_at', cutoff)
    .limit(500)

  if (selectError) {
    return Response.json({ error: selectError.message }, { status: 500 })
  }

  if (!stale?.length) {
    return Response.json({ swept: 0, storage_removed: 0 })
  }

  // Best-effort. Most of these paths hold nothing — the reservation was never
  // redeemed — and removing a path that doesn't exist is not an error worth
  // failing the sweep over.
  const { error: storageError } = await db.storage
    .from(BUCKET)
    .remove(stale.map(p => p.storage_path))

  if (storageError) {
    console.error('[sweep-pending-uploads] storage remove failed:', storageError.message)
  }

  const { error: deleteError } = await db
    .from('object_photos')
    .delete()
    .in('id', stale.map(p => p.id))
    .eq('status', 'pending')

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 })
  }

  return Response.json({
    swept: stale.length,
    storage_removed: storageError ? 0 : stale.length,
  })
}
