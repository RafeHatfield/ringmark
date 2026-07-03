import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_URL } from '@/lib/constants'

export async function generateMetadata(): Promise<Metadata> {
  const admin = createAdminClient()
  const { data: account } = await admin
    .from('accounts')
    .select('display_name, workshop_name, name, bio, handle')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (account?.handle) {
    permanentRedirect(`/${account.handle}/maker`)
  }

  const makerName = account?.workshop_name || account?.display_name || account?.name || 'The Maker'
  const description = account?.bio
    ? account.bio.slice(0, 160).replace(/\s+/g, ' ').trim()
    : `Handmade wooden pieces by ${makerName}.`

  const url = `${APP_URL}/maker`

  return {
    title: `${makerName} — Ringmark`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: makerName,
      description,
      url,
      siteName: 'Ringmark',
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title: makerName,
      description,
    },
  }
}

export default async function MakerPage() {
  const admin = createAdminClient()

  const { data: account } = await admin
    .from('accounts')
    .select('id, display_name, workshop_name, name, bio, avatar_storage_path, website_url, handle')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!account) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-4">
        <p className="text-[14px] text-bark">Nothing here yet.</p>
      </div>
    )
  }

  if (account.handle) {
    permanentRedirect(`/${account.handle}/maker`)
  }

  // Fetch published pieces — public fields only, never private_notes / location_text / workshop_id
  const { data: pieces } = await admin
    .from('wood_objects')
    .select('public_slug, public_title, title, species, updated_at')
    .eq('account_id', account.id)
    .eq('is_published', true)
    .order('updated_at', { ascending: false })

  const makerName = account.workshop_name || account.display_name || account.name

  let avatarUrl: string | null = null
  if (account.avatar_storage_path) {
    const { data } = admin.storage.from('avatars').getPublicUrl(account.avatar_storage_path)
    avatarUrl = data.publicUrl
  }

  const displayWebsite = account.website_url
    ? account.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : null

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: makerName,
    ...(account.bio ? { description: account.bio } : {}),
    url: account.website_url || `${APP_URL}/maker`,
    ...(avatarUrl ? { image: avatarUrl } : {}),
  }

  return (
    <>
      <style>{`
        @keyframes rise {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: none; }
        }
        .reveal { animation: rise .7s cubic-bezier(.2,.6,.2,1) both; }
        .reveal:nth-child(2) { animation-delay: .06s; }
        .reveal:nth-child(3) { animation-delay: .12s; }
        .reveal:nth-child(4) { animation-delay: .18s; }
        .reveal:nth-child(5) { animation-delay: .24s; }
        @media (prefers-reduced-motion: reduce) { .reveal { animation: none; } }
      `}</style>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-paper text-ink font-sans" style={{ WebkitFontSmoothing: 'antialiased' }}>
        <main className="max-w-[480px] mx-auto px-[22px] pb-8">

          {/* Header */}
          <div className="reveal pt-[48px] pb-[28px] flex flex-col items-center text-center">
            <div className="w-[80px] h-[80px] rounded-full bg-sand mx-auto mb-[18px] overflow-hidden flex items-center justify-center shrink-0">
              {avatarUrl ? (
                <Image src={avatarUrl} alt="" width={80} height={80} className="w-full h-full object-cover" />
              ) : (
                <RingsIcon />
              )}
            </div>

            <h1 className="font-fraunces font-medium text-[26px] leading-[1.2] tracking-[-0.01em] mb-[8px]">
              {makerName}
            </h1>

            {displayWebsite && account.website_url && (
              <a
                href={account.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-cedar hover:text-heartwood transition-colors"
                style={{ textDecoration: 'none' }}
              >
                {displayWebsite}
              </a>
            )}
          </div>

          {account.bio && (
            <p className="reveal text-[16px] leading-[1.72] text-[#574F44] text-center mb-[36px]">
              {account.bio}
            </p>
          )}

          {pieces && pieces.length > 0 && (
            <>
              <hr className="reveal h-px bg-hairline border-0 mb-[28px]" />
              <h2 className="reveal text-[11px] tracking-[0.12em] uppercase text-cedar mb-5 font-medium font-sans">
                Work
              </h2>
              <div className="reveal">
                {pieces.map((piece) => {
                  const name = piece.public_title || piece.title || piece.public_slug
                  return (
                    <Link
                      key={piece.public_slug}
                      href={`/p/${piece.public_slug}`}
                      className="flex items-center justify-between py-[14px] border-t border-hairline hover:text-cedar transition-colors group"
                      style={{ textDecoration: 'none' }}
                    >
                      <div>
                        <span className="text-[15px] font-medium">{name}</span>
                        {piece.species && (
                          <span className="text-[13px] text-bark ml-2">{piece.species}</span>
                        )}
                      </div>
                      <span className="text-bark group-hover:text-cedar transition-colors text-[14px]">→</span>
                    </Link>
                  )
                })}
              </div>
            </>
          )}

          {/* Footer */}
          <footer className="text-center py-[36px]">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[#9C9080] text-[12px] tracking-[0.05em] rounded-md px-2 py-1.5 hover:text-heartwood transition-colors"
              style={{ textDecoration: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="20.5" cy="20" r="4"/>
                <circle cx="20" cy="20" r="10"/>
                <circle cx="19.5" cy="20" r="16"/>
              </svg>
              <span>Tracked with Ringmark</span>
            </Link>
          </footer>

        </main>
      </div>
    </>
  )
}

function RingsIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 40 40" fill="none" stroke="#B0612F" strokeWidth="1.3" aria-hidden="true">
      <circle cx="21" cy="20" r="3"/>
      <circle cx="20.5" cy="20" r="7"/>
      <circle cx="20" cy="20" r="11.5"/>
      <circle cx="19.4" cy="20" r="16" stroke="#D8A472"/>
    </svg>
  )
}
