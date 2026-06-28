import { verifyApiKey } from '@/lib/api-auth'
import { createServiceClient, getAccount } from '@/lib/supabase/service'
import { CreateObjectSchema } from '@/lib/api-schemas'
import { suggestRootId } from '@/lib/id-gen'
import { generateSlug } from '@/lib/slug-gen'
import type { ObjectType, ObjectStatus } from '@/lib/types'

const createSchema = CreateObjectSchema

// ── GET /api/v1/objects ───────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const db = createServiceClient()
  const account = await getAccount(db)

  const url = new URL(request.url)
  const q = url.searchParams.get('q') ?? undefined
  const type = url.searchParams.get('type') ?? undefined
  const status = url.searchParams.get('status') ?? undefined
  const publishedParam = url.searchParams.get('published') ?? undefined
  const rootsParam = url.searchParams.get('roots') ?? undefined
  const limitParam = url.searchParams.get('limit')
  const offsetParam = url.searchParams.get('offset')

  const limit = Math.min(parseInt(limitParam ?? '20', 10) || 20, 50)
  const offset = parseInt(offsetParam ?? '0', 10) || 0

  let query = db
    .from('wood_objects')
    .select('id, workshop_id, object_type, status, title, species, is_published, updated_at', { count: 'exact' })
    .eq('account_id', account.id)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (q) {
    query = query.or(
      `workshop_id.ilike.${q}%,title.ilike.%${q}%,species.ilike.%${q}%,public_title.ilike.%${q}%`
    )
  }
  if (type) query = query.eq('object_type', type as ObjectType)
  if (status) query = query.eq('status', status as ObjectStatus)
  if (publishedParam === 'true') query = query.eq('is_published', true)
  if (publishedParam === 'false') query = query.eq('is_published', false)
  if (rootsParam === 'true') query = query.is('parent_id', null)

  const { data, error, count } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({
    data: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  })
}

// ── POST /api/v1/objects ──────────────────────────────────────────────────────

export async function POST(request: Request) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const db = createServiceClient()
  const account = await getAccount(db)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = createSchema.safeParse(body)
  if (!result.success) {
    return Response.json({ error: result.error.issues[0].message }, { status: 400 })
  }

  const { object_type, workshop_id, title, species, status, location_text, private_notes } = result.data

  // Resolve workshop ID
  let wid: string
  if (workshop_id) {
    wid = workshop_id.toUpperCase().trim()
  } else {
    wid = await suggestRootId(db, account.id, account.default_prefix)
  }

  const widLower = wid.toLowerCase()

  // Check for collision
  const { data: collision } = await db
    .from('wood_objects')
    .select('id')
    .eq('account_id', account.id)
    .eq('workshop_id_lower', widLower)
    .maybeSingle()

  if (collision) {
    return Response.json(
      { error: `Workshop ID "${wid}" is already taken` },
      { status: 409 }
    )
  }

  const public_slug = await generateSlug(db)

  const { data: created, error: insertError } = await db
    .from('wood_objects')
    .insert({
      account_id: account.id,
      workshop_id: wid,
      workshop_id_lower: widLower,
      public_slug,
      object_type: object_type as ObjectType,
      parent_id: null,
      root_id: null,
      title: title?.trim() || null,
      species: species?.trim() || null,
      status: status as ObjectStatus,
      location_text: location_text?.trim() || null,
      private_notes: private_notes?.trim() || null,
    })
    .select('id')
    .single()

  if (insertError || !created) {
    return Response.json({ error: insertError?.message ?? 'Failed to create object' }, { status: 500 })
  }

  // Root objects use their own id as root_id
  await db.from('wood_objects').update({ root_id: created.id }).eq('id', created.id)

  // Fetch the full created object to return
  const { data: fullObject, error: fetchError } = await db
    .from('wood_objects')
    .select('*')
    .eq('id', created.id)
    .single()

  if (fetchError || !fullObject) {
    return Response.json({ error: 'Object created but could not fetch result' }, { status: 500 })
  }

  return Response.json(fullObject, { status: 201 })
}
