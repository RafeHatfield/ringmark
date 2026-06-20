import { ImageResponse } from 'next/og'
import { createAdminClient } from '@/lib/supabase/admin'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Ringmark piece story'

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = createAdminClient()

  const { data: object } = await admin
    .from('wood_objects')
    .select('id, public_title, title, species, account_id')
    .eq('public_slug', slug)
    .eq('is_published', true)
    .single()

  const title = object?.public_title || object?.title || slug

  const { data: account } = object?.account_id
    ? await admin
        .from('accounts')
        .select('workshop_name, display_name, name')
        .eq('id', object.account_id)
        .single()
    : { data: null }

  const workshopName =
    account?.workshop_name || account?.display_name || account?.name || 'Ringmark'

  let heroUrl: string | null = null
  if (object?.id) {
    const { data: photos } = await admin
      .from('object_photos')
      .select('storage_path')
      .eq('object_id', object.id)
      .eq('is_public', true)
      .order('sort_order', { ascending: false })
      .limit(1)

    if (photos?.[0]?.storage_path) {
      const { data: signed } = await admin.storage
        .from('object-photos')
        .createSignedUrls([photos[0].storage_path], 60)
      heroUrl = signed?.[0]?.signedUrl ?? null
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          backgroundColor: '#FBF6EE',
          fontFamily: 'Georgia, serif',
        }}
      >
        {/* Photo panel */}
        {heroUrl && (
          <img
            src={heroUrl}
            alt=""
            style={{
              width: 420,
              height: 630,
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        )}

        {/* Text panel */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: heroUrl ? '60px 64px' : '80px 80px',
          }}
        >
          {/* Top: eyebrow */}
          <div
            style={{
              fontSize: 14,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: '#B0612F',
            }}
          >
            Before it was yours
          </div>

          {/* Middle: title + species */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                fontSize: heroUrl ? 48 : 64,
                fontWeight: 500,
                color: '#1A1714',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
              }}
            >
              {title}
            </div>
            {object?.species && (
              <div style={{ fontSize: 20, color: '#B0612F', letterSpacing: '0.02em' }}>
                {object.species}
              </div>
            )}
          </div>

          {/* Bottom: maker + brand */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13, color: '#6E6456', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              From the workshop of
            </div>
            <div style={{ fontSize: 22, color: '#1A1714', fontWeight: 500 }}>
              {workshopName}
            </div>
            <div style={{ fontSize: 13, color: '#9C9080', marginTop: 4 }}>
              ringmark.org
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
