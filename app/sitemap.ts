import type { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ringmark.org'

  const admin = createAdminClient()
  const { data: objects } = await admin
    .from('wood_objects')
    .select('public_slug, updated_at')
    .eq('is_published', true)

  const pieceUrls: MetadataRoute.Sitemap = (objects ?? []).map((obj) => ({
    url: `${appUrl}/p/${obj.public_slug}`,
    lastModified: new Date(obj.updated_at),
    changeFrequency: 'monthly',
    priority: 0.8,
  }))

  return [
    {
      url: `${appUrl}/maker`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    ...pieceUrls,
  ]
}
