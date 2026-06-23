import { z } from 'zod'
import { verifyApiKey } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'
import { suggestDescendantId } from '@/lib/id-gen'
import { generateSlug } from '@/lib/slug-gen'
import type { ObjectType, ObjectStatus } from '@/lib/types'

// ── Zod schema ────────────────────────────────────────────────────────────────

const objectTypeValues = [
  'source', 'log', 'chunk', 'slab', 'blank', 'rough_bowl',
  'finished_bowl', 'pen_blank', 'spindle_blank', 'offcut', 'other',
] as const

const objectStatusValues = [
  'unknown', 'acquired', 'stored', 'sealed', 'cut', 'drying',
  'rough_turned', 'finished', 'for_sale', 'sold', 'gifted', 'scrapped',
] as const

const createChildSchema = z.object({
  object_type: z.enum(objectTypeValues),
  title: z.string().optional(),
  species: z.string().optional(),
  status: z.enum(objectStatusValues).optional(),
  private_notes: z.string().optional(),
})

// ── Account helper ────────────────────────────────────────────────────────────

async function getAccount(db: ReturnType<typeof createServiceClient>) {
  const { data, error } = await db
    .from('accounts')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new Error('No account found in database')
  return data
}

// ── POST /api/v1/objects/:id/children ────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const { id } = await params
  const db = createServiceClient()
  const account = await getAccount(db)

  // Resolve parent
  const parent = await resolveObject(id, account.id, db)
  if (!parent) {
    return Response.json({ error: 'Parent object not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = createChildSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const { object_type, title, species, status, private_notes } = result.data

  // Resolve root for descendant ID generation (same as add_child in MCP server)
  const rootId = parent.root_id ?? parent.id

  const { data: root } = await db
    .from('wood_objects')
    .select('workshop_id')
    .eq('id', rootId)
    .single()
  const rootWorkshopId = root?.workshop_id ?? parent.workshop_id

  const wid = await suggestDescendantId(db, account.id, rootId, rootWorkshopId)
  const public_slug = await generateSlug(db)

  const { data: created, error: insertError } = await db
    .from('wood_objects')
    .insert({
      account_id: account.id,
      workshop_id: wid,
      workshop_id_lower: wid.toLowerCase(),
      public_slug,
      object_type: object_type as ObjectType,
      parent_id: parent.id,
      root_id: rootId,
      title: title?.trim() || null,
      species: species?.trim() || parent.species,
      status: (status ?? null) as ObjectStatus | null,
      private_notes: private_notes?.trim() || null,
    })
    .select('id')
    .single()

  if (insertError || !created) {
    return Response.json({ error: insertError?.message ?? 'Failed to create child' }, { status: 500 })
  }

  // Fetch the full created object to return
  const { data: fullObject, error: fetchError } = await db
    .from('wood_objects')
    .select('*')
    .eq('id', created.id)
    .single()

  if (fetchError || !fullObject) {
    return Response.json({ error: 'Child created but could not fetch result' }, { status: 500 })
  }

  return Response.json(fullObject, { status: 201 })
}
