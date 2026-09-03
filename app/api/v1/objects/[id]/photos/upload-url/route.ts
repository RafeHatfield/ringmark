/**
 * POST /api/v1/objects/:id/photos/upload-url
 *
 * Reserves a photo row and mints a single-use token for a direct upload to
 * PUT /api/upload. This is where authorization happens — the redemption route
 * has no session and no account, only a token that resolves to exactly one row.
 *
 * The storage path is derived here, entirely server-side, from the resolved
 * account and object plus a fresh UUID. The caller's filename contributes only
 * a whitelisted extension (see extensionForFilename), so no client-controlled
 * component ever reaches Storage.
 */

import { authenticateApiRequest } from '@/lib/api-auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveObject } from '@/lib/resolve-object'
import { publicOrigin } from '@/lib/mcp-auth'
import {
  ACCEPTED_MIME_TYPES,
  UPLOAD_MAX_BYTES,
  extensionForFilename,
  mintUploadToken,
} from '@/lib/photo-upload'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = createServiceClient()
  const { account, error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return authErr

  const object = await resolveObject(id, account.id, db)
  if (!object) {
    return Response.json({ error: 'Object not found' }, { status: 404 })
  }

  let body: Record<string, unknown> = {}
  if (request.headers.get('content-length') !== '0') {
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  }

  const filename = typeof body.filename === 'string' ? body.filename : ''
  if (!filename.trim()) {
    return Response.json({ error: 'Missing required field: filename' }, { status: 400 })
  }

  const caption = typeof body.caption === 'string' ? body.caption.trim() || null : null

  // Highest sort_order wins regardless of state. Deliberately NOT filtered by
  // deleted_at or status: a restored photo or a concurrently pending
  // reservation must not collide with this one.
  const { data: lastPhoto } = await db
    .from('object_photos')
    .select('sort_order')
    .eq('object_id', object.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { token, hash, expiresAt } = mintUploadToken()
  const storagePath = `${account.id}/${object.id}/${crypto.randomUUID()}.${extensionForFilename(filename)}`

  const { data: photo, error: insertError } = await db
    .from('object_photos')
    .insert({
      account_id: account.id,
      object_id: object.id,
      storage_path: storagePath,
      caption,
      is_public: true,
      sort_order: (lastPhoto?.sort_order ?? -1) + 1,
      status: 'pending',
      upload_token_hash: hash,
      upload_expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single()

  if (insertError || !photo) {
    return Response.json(
      { error: insertError?.message ?? 'Failed to reserve photo record' },
      { status: 500 }
    )
  }

  const uploadUrl = `${publicOrigin(request)}/api/upload`

  return Response.json(
    {
      photo_id: photo.id,
      upload_url: uploadUrl,
      upload_token: token,
      expires_at: expiresAt.toISOString(),
      max_bytes: UPLOAD_MAX_BYTES,
      accepted_types: [...ACCEPTED_MIME_TYPES],
      instructions:
        `Upload the image bytes with:\n` +
        `curl -sS -X PUT --data-binary @<file> ` +
        `-H 'Content-Type: image/jpeg' ` +
        `-H 'Authorization: Bearer ${token}' ` +
        `'${uploadUrl}'\n` +
        `The token is single-use and expires at ${expiresAt.toISOString()}. ` +
        `A successful PUT returns the finished photo record — no follow-up call is needed.`,
    },
    { status: 201 }
  )
}
