import type { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_URL } from '@/lib/constants'

// Cached like the other public routes. Without this it was prerendered once at
// build and never listed a piece published since the last deploy.
export const revalidate = 86400

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = APP_URL

  const admin = createAdminClient()

  const { data: objects, error: objectsError } = await admin
    .from('wood_objects')
    .select('public_slug, updated_at')
    .eq('is_published', true)
  if (objectsError) throw new Error(`sitemap objects lookup failed: ${objectsError.message}`)

  // Prefer /{handle}/maker when a handle is set; fall back to /maker
  const { data: accounts, error: accountsError } = await admin
    .from('accounts')
    .select('handle, updated_at')
    .not('handle', 'is', null)
  if (accountsError) throw new Error(`sitemap accounts lookup failed: ${accountsError.message}`)

  const pieceUrls: MetadataRoute.Sitemap = (objects ?? []).map((obj) => ({
    url: `${appUrl}/p/${obj.public_slug}`,
    lastModified: new Date(obj.updated_at),
    changeFrequency: 'monthly',
    priority: 0.8,
  }))

  const makerUrls: MetadataRoute.Sitemap = (accounts ?? []).map((a) => ({
    url: `${appUrl}/${a.handle}/maker`,
    lastModified: new Date(a.updated_at),
    changeFrequency: 'weekly',
    priority: 0.9,
  }))

  // Include legacy /maker only if no handle-based URL exists yet
  const legacyMaker: MetadataRoute.Sitemap = makerUrls.length === 0
    ? [{ url: `${appUrl}/maker`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 }]
    : []

  return [
    {
      url: appUrl,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1.0,
    },
    ...makerUrls,
    ...legacyMaker,
    {
      url: `${appUrl}/contact`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    ...pieceUrls,
  ]
}
