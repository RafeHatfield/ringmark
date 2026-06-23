import { verifyApiKey } from '@/lib/api-auth'
import { createServiceClient, getAccount } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'
import { PatchObjectSchema } from '@/lib/api-schemas'
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
  payload.updated_at = new Date().toISOString()

  const { error: updateError } = await db
    .from('wood_objects')
    .update(payload)
    .eq('id', obj.id)
    .eq('account_id', account.id)

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 })
  }

  // Fetch updated object to return
  const { data: updated, error: fetchError } = await db
    .from('wood_objects')
    .select('*')
    .eq('id', obj.id)
    .single()

  if (fetchError || !updated) {
    return Response.json({ error: 'Update succeeded but could not fetch result' }, { status: 500 })
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

  // Delete the object (cascades to children via DB foreign key or deletes the record;
  // follows the same pattern as deleteObject in actions/objects.ts)
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
