import { ImageResponse } from 'next/og'
import { createAdminClient } from '@/lib/supabase/admin'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Ringmark maker profile'

export default async function OgImage() {
  const admin = createAdminClient()

  const { data: account } = await admin
    .from('accounts')
    .select('display_name, workshop_name, name, bio, avatar_storage_path, website_url')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  const makerName =
    account?.workshop_name || account?.display_name || account?.name || 'Ringmark'
  const bio = account?.bio ?? null

  let avatarUrl: string | null = null
  if (account?.avatar_storage_path) {
    const { data } = admin.storage.from('avatars').getPublicUrl(account.avatar_storage_path)
    avatarUrl = data.publicUrl
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FBF6EE',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 28,
            maxWidth: 700,
            textAlign: 'center',
          }}
        >
          {/* Avatar */}
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              style={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                objectFit: 'cover',
              }}
            />
          )}

          {/* Name */}
          <div
            style={{
              fontSize: 56,
              fontWeight: 500,
              color: '#1A1714',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
            }}
          >
            {makerName}
          </div>

          {/* Bio snippet */}
          {bio && (
            <div
              style={{
                fontSize: 22,
                color: '#574F44',
                lineHeight: 1.5,
              }}
            >
              {bio.length > 120 ? bio.slice(0, 120).trim() + '…' : bio}
            </div>
          )}

          {/* Brand */}
          <div style={{ fontSize: 14, color: '#9C9080', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>
            Ringmark
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
