import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types'

// Signs a batch of storage paths and returns them as a path → signed URL map.
// Skips entries where signing failed (null signedUrl); returns an empty map
// for an empty input instead of making a request.
export async function signPathsBatch(
  storage: SupabaseClient<Database>['storage'],
  bucket: string,
  paths: string[],
  expiresIn: number,
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>()
  if (paths.length === 0) return urlMap

  const { data: signed } = await storage.from(bucket).createSignedUrls(paths, expiresIn)

  for (const s of signed ?? []) {
    if (s.signedUrl && s.path) urlMap.set(s.path, s.signedUrl)
  }

  return urlMap
}
