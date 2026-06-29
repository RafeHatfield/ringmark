import { verifyApiKey } from '@/lib/api-auth'
import { createServiceClient, getAccount } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'
import { PatchObjectSchema } from '@/lib/api-schemas'
import { computeRootId } from '@/lib/lineage-utils'
import type { WoodObjectUpdate } from '@/lib/types'

const patchSchema = PatchObjectSchema

// ── GET /api/v1/objects/:id ───────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const { id } = await params
  const db = createServiceClient()
  const account = await getAccount(db)

  const obj = await resolveObject(id, account.id, db)
  if (!obj) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  return Response.json(obj)
}

// ── PATCH /api/v1/objects/:id ─────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const { id } = await params
  const db = createServiceClient()
  const account = await getAccount(db)

  const obj = await resolveObject(id, account.id, db)
  if (!obj) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = patchSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const parsed = result.data

  // Build update payload from only the fields present in the body
  const payload: WoodObjectUpdate = {}

  if (parsed.workshop_id !== undefined) {
    const newLower = parsed.workshop_id.toLowerCase()
    // Skip the uniqueness check when the ID isn't actually changing
    if (newLower !== obj.workshop_id_lower) {
      const { data: conflict } = await db
        .from('wood_objects')
        .select('id')
        .eq('account_id', account.id)
        .eq('workshop_id_lower', newLower)
        .maybeSingle()
      if (conflict) {
        return Response.json(
          { error: `Workshop ID already in use: ${parsed.workshop_id}` },
          { status: 409 }
        )
      }
    }
    payload.workshop_id = parsed.workshop_id
    payload.workshop_id_lower = newLower
  }

  if (parsed.object_type !== undefined) payload.object_type = parsed.object_type
  if (parsed.status !== undefined) payload.status = parsed.status
  if (parsed.title !== undefined) payload.title = parsed.title || null
  if (parsed.species !== undefined) payload.species = parsed.species || null
  if (parsed.location_text !== undefined) payload.location_text = parsed.location_text || null
  if (parsed.private_notes !== undefined) payload.private_notes = parsed.private_notes || null
  if (parsed.public_title !== undefined) payload.public_title = parsed.public_title || null
  if (parsed.public_story !== undefined) payload.public_story = parsed.public_story || null
  if (parsed.public_notes !== undefined) payload.public_notes = parsed.public_notes || null
  if (parsed.public_care !== undefined) payload.public_care = parsed.public_care || null
  if (parsed.is_published !== undefined) payload.is_published = parsed.is_published

  // Re-parenting: resolve the new parent (accepts workshop ID or UUID) and recompute root_id
  if (parsed.parent_id !== undefined) {
    const newParentId = parsed.parent_id  // null = detach to root
    let resolvedParentId: string | null = null
    let newParentRootId: string | null = null

    if (newParentId) {
      const parent = await resolveObject(newParentId, account.id, db)
      if (!parent) {
        return Response.json({ error: `Parent not found: ${newParentId}` }, { status: 404 })
      }
      resolvedParentId = parent.id
      newParentRootId = parent.root_id
    }

    payload.parent_id = resolvedParentId
    payload.root_id = computeRootId(resolvedParentId, newParentRootId, obj.id)
  }

  payload.updated_at = new Date().toISOString()

  // Atomic update + read-back: .select().single() returns the post-write row in one
  // round-trip and errors if 0 rows matched (catches silent no-ops from bad WHERE conditions).
  const { data: updated, error: updateError } = await db
    .from('wood_objects')
    .update(payload)
    .eq('id', obj.id)
    .eq('account_id', account.id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return Response.json({ error: updateError?.message ?? 'Update failed' }, { status: 500 })
  }

  return Response.json(updated)
}

// ── DELETE /api/v1/objects/:id ────────────────────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const { id } = await params
  const db = createServiceClient()
  const account = await getAccount(db)

  const obj = await resolveObject(id, account.id, db)
  if (!obj) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  const force = new URL(request.url).searchParams.get('force') === 'true'

  if (obj.is_published && !force) {
    return Response.json(
      { error: 'Object is published. Unpublish first, or pass ?force=true to delete a live page.' },
      { status: 409 }
    )
  }

  const { data: children } = await db
    .from('wood_objects')
    .select('workshop_id')
    .eq('parent_id', obj.id)
    .eq('account_id', account.id)

  if (children && children.length > 0) {
    const ids = children.map(c => c.workshop_id).join(', ')
    return Response.json(
      { error: `Object has children: ${ids}. Delete or re-parent them first.` },
      { status: 409 }
    )
  }

  // Remove photo storage files (best-effort — DB records cascade automatically)
  const { data: photos } = await db
    .from('object_photos')
    .select('storage_path')
    .eq('object_id', obj.id)
    .eq('account_id', account.id)

  if (photos && photos.length > 0) {
    const { error: storageError } = await db.storage
      .from('object-photos')
      .remove(photos.map(p => p.storage_path))
    if (storageError) {
      console.error('[delete object] storage remove failed:', storageError.message)
    }
  }

  const { error: deleteError } = await db
    .from('wood_objects')
    .delete()
    .eq('id', obj.id)
    .eq('account_id', account.id)

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 })
  }

  return new Response(null, { status: 204 })
}
