import { verifyApiKey } from '@/lib/api-auth'
import { createServiceClient, getAccount } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'

const BUCKET = 'object-photos'
const SIGNED_URL_EXPIRY_SECONDS = 3600

// ── GET /api/v1/objects/:id/photos ───────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const { id } = await params
  const db = createServiceClient()
  const account = await getAccount(db)

  const object = await resolveObject(id, account.id, db)
  if (!object) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  const { data: photos, error } = await db
    .from('object_photos')
    .select('id, caption, is_public, sort_order, storage_path, created_at')
    .eq('object_id', object.id)
    .eq('account_id', account.id)
    .order('sort_order', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = photos ?? []
  const paths = rows.map(p => p.storage_path)
  const signedByPath = new Map<string, string>()

  if (paths.length > 0) {
    const { data: signed } = await db.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_EXPIRY_SECONDS)
    for (const s of (signed ?? [])) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl)
    }
  }

  const data = rows.map(p => ({
    id: p.id,
    caption: p.caption,
    is_public: p.is_public,
    sort_order: p.sort_order,
    signed_url: signedByPath.get(p.storage_path) ?? null,
    created_at: p.created_at,
  }))

  return Response.json({ data, total: data.length })
}

// ── POST /api/v1/objects/:id/photos ──────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyApiKey(request)
  if (authError) return authError

  const { id } = await params
  const db = createServiceClient()
  const account = await getAccount(db)

  const object = await resolveObject(id, account.id, db)
  if (!object) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data body' }, { status: 400 })
  }

  const file = form.get('file')
  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'Missing required file field' }, { status: 400 })
  }
  if (file.size === 0) {
    return Response.json({ error: 'Uploaded file is empty' }, { status: 400 })
  }

  const caption = form.get('caption')
  const captionStr = typeof caption === 'string' ? caption.trim() || null : null

  const ext = extFromFilename(file.name) || extFromMime(file.type) || 'jpg'
  const storagePath = `${account.id}/${object.id}/${crypto.randomUUID()}.${ext}`

  const { error: storageError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, file, { upsert: false })

  if (storageError) {
    return Response.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 })
  }

  const { data: lastPhoto } = await db
    .from('object_photos')
    .select('sort_order')
    .eq('object_id', object.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: photo, error: insertError } = await db
    .from('object_photos')
    .insert({
      account_id: account.id,
      object_id: object.id,
      storage_path: storagePath,
      caption: captionStr,
      is_public: true,
      sort_order: (lastPhoto?.sort_order ?? -1) + 1,
    })
    .select('id, object_id, storage_path, caption, is_public, sort_order, created_at')
    .single()

  if (insertError || !photo) {
    await db.storage.from(BUCKET).remove([storagePath])
    return Response.json({ error: insertError?.message ?? 'Failed to save photo record' }, { status: 500 })
  }

  const { data: signedData } = await db.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS)

  return Response.json({ ...photo, signed_url: signedData?.signedUrl ?? null }, { status: 201 })
}

function extFromFilename(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  }
  return map[mimeType] ?? ''
}
