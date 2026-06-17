import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_STRIP = 3

export default async function PublicStoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: authCheck } = await supabase
    .from('wood_objects')
    .select('id, is_published, account_id')
    .eq('public_slug', slug)
    .single()

  if (!authCheck) {
    return <NotFound message="This piece could not be found." />
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', authCheck.account_id)
      .single()
    if (account) redirect(`/objects/${authCheck.id}`)
  }

  if (!authCheck.is_published) {
    return <NotFound message="This piece's story hasn't been published yet." />
  }

  // Fetch only public fields — NEVER select private_notes, location_text, or workshop_id
  const { data: object } = await supabase
    .from('wood_objects')
    .select(
      'id, public_slug, object_type, status, title, species, public_title, public_story, public_notes, public_care, is_published',
    )
    .eq('public_slug', slug)
    .eq('is_published', true)
    .single()

  if (!object) {
    return <NotFound message="This piece could not be found." />
  }

  // Fetch public photos — finished piece first (highest sort_order)
  const { data: photos } = await supabase
    .from('object_photos')
    .select('id, storage_path, caption, sort_order')
    .eq('object_id', object.id)
    .eq('is_public', true)
    .order('sort_order', { ascending: false })

  let photoUrls: { caption: string | null; url: string }[] = []
  if (photos && photos.length > 0) {
    const { data: signed } = await supabase.storage
      .from('object-photos')
      .createSignedUrls(
        photos.map((p) => p.storage_path),
        3600,
      )
    photoUrls = photos.map((p, i) => ({
      caption: p.caption,
      url: signed?.[i]?.signedUrl ?? '',
    }))
  }

  // Fetch account name via service role (anon role can't read accounts)
  const admin = createAdminClient()
  const { data: accountData } = await admin
    .from('accounts')
    .select('name')
    .eq('id', authCheck.account_id)
    .single()
  const workshopName = accountData?.name ?? 'Ringmark'

  const displayTitle = object.public_title || object.title || `/${object.public_slug}`
  const heroPhoto = photoUrls[0] ?? null
  const stripPhotos = photoUrls.slice(1)
  const visibleStrip =
    stripPhotos.length <= MAX_STRIP
      ? stripPhotos
      : stripPhotos.slice(0, MAX_STRIP - 1)
  const overflowCount =
    stripPhotos.length > MAX_STRIP ? stripPhotos.length - (MAX_STRIP - 1) : 0

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
        .reveal:nth-child(6) { animation-delay: .30s; }
        .reveal:nth-child(7) { animation-delay: .36s; }
        @media (prefers-reduced-motion: reduce) { .reveal { animation: none; } }
      `}</style>

      <div className="min-h-screen bg-paper text-ink font-sans" style={{ WebkitFontSmoothing: 'antialiased' }}>
        <main className="max-w-[480px] mx-auto px-[22px] pb-8">
          <article>

            {/* Eyebrow */}
            <p className="reveal text-center text-[12px] tracking-[0.16em] uppercase text-cedar pt-[30px] pb-[18px] m-0">
              Before it was yours
            </p>

            {/* Hero */}
            {heroPhoto?.url ? (
              <div className="reveal aspect-[4/3] rounded-[14px] overflow-hidden bg-sand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={heroPhoto.url}
                  alt={heroPhoto.caption ?? displayTitle}
                  className="w-full h-full object-cover block"
                />
              </div>
            ) : (
              <div className="reveal aspect-[4/3] rounded-[14px] bg-sand flex items-center justify-center">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#B0612F" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-3.5-3.5L9 19"/>
                </svg>
              </div>
            )}

            {/* Title block */}
            <header className="reveal">
              <h1 className="font-fraunces font-medium text-[30px] leading-[1.15] tracking-[-0.01em] mt-6 mb-[6px]">
                {displayTitle}
              </h1>
              {object.species && (
                <p className="text-[13px] tracking-[0.02em] text-cedar m-0">
                  {object.species}
                </p>
              )}
            </header>

            {/* Story */}
            {object.public_story && (
              <p className="reveal font-fraunces font-normal text-[18px] leading-[1.72] text-[#433B30] mt-[22px] mb-0 whitespace-pre-wrap">
                {object.public_story}
              </p>
            )}

            {/* Notes */}
            {object.public_notes && (
              <p className="reveal text-[15px] leading-[1.65] text-bark mt-4 mb-0 whitespace-pre-wrap">
                {object.public_notes}
              </p>
            )}

            <hr className="reveal h-px bg-hairline border-0 my-7" />

            {/* Maker */}
            <div className="reveal flex items-center gap-[14px]">
              <div className="w-[46px] h-[46px] rounded-full bg-sand flex items-center justify-center shrink-0 overflow-hidden" aria-hidden="true">
                <svg width="30" height="30" viewBox="0 0 40 40" fill="none" stroke="#B0612F" strokeWidth="1.3">
                  <circle cx="21" cy="20" r="3"/>
                  <circle cx="20.5" cy="20" r="7"/>
                  <circle cx="20" cy="20" r="11.5"/>
                  <circle cx="19.4" cy="20" r="16" stroke="#D8A472"/>
                </svg>
              </div>
              <div>
                <p className="text-[11px] tracking-[0.1em] uppercase text-bark m-0 mb-[2px]">
                  From the workshop of
                </p>
                <p className="font-fraunces font-medium text-[17px] text-ink m-0">
                  {workshopName}
                </p>
              </div>
            </div>

            {/* Photo strip */}
            {stripPhotos.length > 0 && (
              <>
                <hr className="reveal h-px bg-hairline border-0 my-7" />
                <div className="reveal grid grid-cols-3 gap-2">
                  {visibleStrip.map((p, i) =>
                    p.url ? (
                      <div key={i} className="aspect-square rounded-[9px] bg-sand overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={p.caption ?? ''} className="w-full h-full object-cover" />
                      </div>
                    ) : null,
                  )}
                  {overflowCount > 0 && (
                    <div className="aspect-square rounded-[9px] bg-sand flex items-center justify-center">
                      <span className="text-[14px] text-heartwood font-medium">+{overflowCount}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Care */}
            {object.public_care && (
              <section className="reveal bg-sand rounded-[12px] px-5 py-[18px] mt-7">
                <h2 className="text-[11px] tracking-[0.12em] uppercase text-cedar mb-2 font-medium font-sans m-0">
                  Looking after it
                </h2>
                <p className="text-[15px] leading-[1.62] text-[#574F44] m-0">
                  {object.public_care}
                </p>
              </section>
            )}

          </article>

          {/* Footer */}
          <footer className="text-center py-[30px]">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[#9C9080] no-underline text-[12px] tracking-[0.05em] rounded-md px-2 py-1.5 hover:text-heartwood transition-colors"
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

function NotFound({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <p className="text-[14px] text-bark">{message}</p>
    </div>
  )
}
