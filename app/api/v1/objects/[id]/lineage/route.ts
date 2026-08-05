import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'
import { typeLabel } from '@/lib/constants'

const SIGNED_URL_EXPIRY = 3600

// ── GET /api/v1/objects/:id/lineage ──────────────────────────────────────────
//
// Returns the full ancestry chain from the root object down to :id, ordered
// root-first. Each step includes its public_story and a signed thumbnail URL
// so the public journey page can render the timeline without extra requests.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  const target = await resolveObject(id, account.id, db)
  if (!target) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  // Walk parent_id chain from target up to root, prepend each step so the
  // resulting array is ordered root → target.
  type Step = { id: string; parent_id: string | null; workshop_id: string; object_type: string; title: string | null; public_story: string | null; status: string | null }
  const chain: Step[] = []
  let currentId: string | null = target.id

  while (currentId) {
    const nextId: string = currentId
    const { data: step } = await db
      .from('wood_objects')
      .select('id, parent_id, workshop_id, object_type, title, public_story, status')
      .eq('id', nextId)
      .eq('account_id', account.id)
      .maybeSingle()

    if (!step) break
    chain.unshift(step as Step)
    currentId = step.parent_id
  }

  // Batch-fetch public photos for all objects in the chain in one query.
  const { data: allPhotos } = await db
    .from('object_photos')
    .select('object_id, storage_path, sort_order')
    .in('object_id', chain.map(s => s.id))
    .eq('is_public', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })

  // Group: first photo path + count per object
  const photoMeta = new Map<string, { path: string; count: number }>()
  for (const photo of (allPhotos ?? [])) {
    const existing = photoMeta.get(photo.object_id)
    if (!existing) {
      photoMeta.set(photo.object_id, { path: photo.storage_path, count: 1 })
    } else {
      existing.count++
    }
  }

  // Generate signed URLs for thumbnails in one batch call
  const thumbPaths = [...photoMeta.values()].map(p => p.path).filter((p): p is string => !!p)
  const signedByPath = new Map<string, string>()
  if (thumbPaths.length > 0) {
    const { data: signed } = await db.storage
      .from('object-photos')
      .createSignedUrls(thumbPaths, SIGNED_URL_EXPIRY)
    for (const s of (signed ?? [])) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl)
    }
  }

  const steps = chain.map(step => {
    const meta = photoMeta.get(step.id)
    return {
      id: step.id,
      workshop_id: step.workshop_id,
      object_type: step.object_type,
      step_label: step.title || typeLabel(step.object_type),
      public_story: step.public_story,
      status: step.status,
      photo_count: meta?.count ?? 0,
      thumbnail_url: meta ? (signedByPath.get(meta.path) ?? null) : null,
    }
  })

  return Response.json({ steps })
}
