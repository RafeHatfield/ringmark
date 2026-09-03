import { cache } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_URL, SIGNED_URL_EXPIRY, typeLabel } from '@/lib/constants'
import { getWorkshopName } from '@/lib/utils'
import { PublicFooter } from '@/components/public-chrome'
import { signPathsBatch } from '@/lib/signed-urls'
import { StagePhoto } from './stage-photo'

// Shared leaf-object lookup for generateMetadata + the page body — cache()
// dedupes the query to one call per request regardless of how many times
// it's invoked with the same slug.
const getPublishedObject = cache(async (slug: string) => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('wood_objects')
    .select('id, public_slug, account_id, is_published, object_type, title, species, public_title, public_story, public_notes, public_care, parent_id, root_id')
    .eq('public_slug', slug)
    .maybeSingle()
  return data
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params

  const object = await getPublishedObject(slug)

  if (!object || !object.is_published) {
    return { title: 'Ringmark' }
  }

  const admin = createAdminClient()
  const { data: account } = await admin
    .from('accounts')
    .select('workshop_name, display_name, name')
    .eq('id', object.account_id)
    .maybeSingle()

  const title = object.public_title || object.title || slug
  const workshopName = getWorkshopName(account)
  const description = object.public_story
    ? object.public_story.slice(0, 160).replace(/\s+/g, ' ').trim()
    : `A handmade piece from the workshop of ${workshopName}.`

  const url = `${APP_URL}/p/${slug}`

  return {
    title: `${title} — Ringmark`,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Ringmark', type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function PublicStoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  // Round 1: session + leaf object (by slug)
  const [
    { data: { user } },
    object,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getPublishedObject(slug),
  ])

  if (!object) {
    return <NotFound message="This piece could not be found." />
  }

  // Round 2: ownership + account data in parallel while we start building the lineage
  const admin = createAdminClient()
  const [ownerCheck, { data: accountData }] = await Promise.all([
    user
      ? supabase.from('accounts').select('id').eq('id', object.account_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from('accounts')
      .select('name, display_name, workshop_name, bio, avatar_storage_path, website_url, handle')
      .eq('id', object.account_id)
      .maybeSingle(),
  ])

  const isOwner = !!ownerCheck?.data

  if (!object.is_published && !isOwner) {
    return <NotFound message="This piece's story hasn't been published yet." />
  }

  // Build lineage chain root → leaf: one query fetches the whole tree by
  // root_id, then an in-memory walk from the leaf back to the root via
  // parent_id assembles the chain without a recursive CTE.
  type ChainStep = {
    id: string
    parent_id: string | null
    object_type: string
    title: string | null
    public_story: string | null
    public_notes: string | null
    public_care: string | null
    species: string | null
  }
  const chain: ChainStep[] = []

  if (object.root_id) {
    const { data: treeRows } = await admin
      .from('wood_objects')
      .select('id, parent_id, object_type, title, public_story, public_notes, public_care, species')
      .eq('root_id', object.root_id)
      .eq('account_id', object.account_id)

    const rowsById = new Map<string, ChainStep>((treeRows ?? []).map(row => [row.id, row as ChainStep]))

    const visited = new Set<string>()
    let currentId: string | null = object.id
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const step = rowsById.get(currentId)
      if (!step) break
      chain.unshift(step)
      currentId = step.parent_id
    }
  } else {
    // Legacy rows without a root_id: fall back to a chain of just the leaf.
    chain.push({
      id: object.id,
      parent_id: object.parent_id,
      object_type: object.object_type,
      title: object.title,
      public_story: object.public_story,
      public_notes: object.public_notes,
      public_care: object.public_care,
      species: object.species,
    } as ChainStep)
  }

  // Fetch ALL public photos for every step in one query so each stage can
  // show its full photo set in the lightbox (not just a single thumbnail).
  const { data: allPhotos } = await admin
    .from('object_photos')
    .select('object_id, storage_path, caption, sort_order')
    .in('object_id', chain.map(s => s.id))
    .eq('is_public', true)
    .is('deleted_at', null)
    .eq('status', 'live')
    .order('sort_order', { ascending: true })

  // Group photos by step
  const photosByStep = new Map<string, Array<{ path: string; caption: string | null }>>()
  for (const p of (allPhotos ?? [])) {
    const bucket = photosByStep.get(p.object_id)
    if (!bucket) {
      photosByStep.set(p.object_id, [{ path: p.storage_path, caption: p.caption }])
    } else {
      bucket.push({ path: p.storage_path, caption: p.caption })
    }
  }

  // Batch-generate signed URLs for every photo across all steps
  const allPaths = [...photosByStep.values()].flatMap(ps => ps.map(p => p.path))
  const signedByPath = await signPathsBatch(admin.storage, 'object-photos', allPaths, SIGNED_URL_EXPIRY)

  // Annotate each step with its display label and resolved photo array
  const steps = chain.map(step => {
    const rawPhotos = photosByStep.get(step.id) ?? []
    const photos = rawPhotos
      .map(p => ({ url: signedByPath.get(p.path) ?? '', caption: p.caption }))
      .filter(p => p.url)
    return {
      ...step,
      step_label: step.title || typeLabel(step.object_type),
      photos,
    }
  })

  // The finished piece is the leaf (last in chain).
  // Display order is chronological: source first, finished piece last.
  // The hero image above already shows the finished piece, so the reader sees
  // the end result first, then follows the story that led to it.
  const finalStep = steps[steps.length - 1]
  const hasLineage = steps.length > 1

  const workshopName = getWorkshopName(accountData)

  let makerAvatarUrl: string | null = null
  if (accountData?.avatar_storage_path) {
    const { data } = admin.storage.from('avatars').getPublicUrl(accountData.avatar_storage_path)
    makerAvatarUrl = data.publicUrl
  }

  // `object` is the leaf — use it directly for final-piece metadata and content.
  // `finalStep` provides the thumbnail_url and photo_count from the lineage pass.
  const displayTitle = object.public_title || object.title || `/${object.public_slug}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: displayTitle,
    ...(object.public_story
      ? { description: object.public_story.slice(0, 500).replace(/\s+/g, ' ').trim() }
      : {}),
    ...(finalStep.photos[0]?.url ? { image: finalStep.photos[0].url } : {}),
    brand: { '@type': 'Brand', name: workshopName },
    url: `${APP_URL}/p/${object.public_slug}`,
    ...(object.species ? { material: object.species } : {}),
  }

  const camIcon = (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#B0612F" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-3.5-3.5L9 19"/>
    </svg>
  )

  return (
    <>
      <style>{`
        @keyframes rise { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        .reveal { animation: rise .7s cubic-bezier(.2,.6,.2,1) both; }
        .reveal.d1 { animation-delay:.07s; } .reveal.d2 { animation-delay:.14s; }
        .stage { position:relative; padding-left:32px; padding-bottom:28px; animation: rise .6s cubic-bezier(.2,.6,.2,1) both; }
        .stage:nth-child(1){animation-delay:.04s;} .stage:nth-child(2){animation-delay:.12s;}
        .stage:nth-child(3){animation-delay:.20s;} .stage:nth-child(4){animation-delay:.28s;}
        .stage:nth-child(5){animation-delay:.36s;} .stage:nth-child(6){animation-delay:.44s;}
        .stage:not(:last-child)::before { content:""; position:absolute; left:6px; top:20px; bottom:-4px; width:2px; background:#E7DAC4; }
        @media (prefers-reduced-motion: reduce) { .reveal, .stage { animation:none; } }
      `}</style>

      <div className="min-h-screen bg-paper text-ink font-sans" style={{ WebkitFontSmoothing: 'antialiased' }}>
        {isOwner && (
          <div className="bg-sand border-b border-hairline">
            <div className="max-w-[480px] mx-auto px-[22px] py-[10px] flex items-center justify-between">
              <span className="text-[12px] text-bark">
                {object.is_published ? 'Published · public view' : 'Draft · not yet published'}
              </span>
              <Link href={`/objects/${object.id}/story`} className="text-[12px] text-cedar hover:text-heartwood transition-colors">
                Edit story →
              </Link>
            </div>
          </div>
        )}

        <main className="max-w-[480px] mx-auto px-[22px] pb-8">
          <article>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

            {/* Eyebrow */}
            <p className="reveal text-center text-[12px] tracking-[0.16em] uppercase text-cedar pt-[30px] pb-[18px] m-0">
              Before it was yours
            </p>

            {/* Hero — first photo of the finished piece, clickable */}
            {finalStep.photos[0]?.url ? (
              <div className="reveal aspect-[4/3] rounded-[14px] overflow-hidden bg-sand relative">
                <Image src={finalStep.photos[0].url} alt={displayTitle} fill sizes="480px" className="object-cover" priority />
              </div>
            ) : (
              <div className="reveal aspect-[4/3] rounded-[14px] bg-sand flex items-center justify-center">
                {camIcon}
              </div>
            )}

            {/* Title */}
            <header className="reveal d1">
              <h1 className="font-fraunces font-medium text-[30px] leading-[1.15] tracking-[-0.01em] mt-6 mb-[6px]">
                {displayTitle}
              </h1>
              {object.species && (
                <p className="text-[13px] tracking-[0.02em] text-cedar m-0">{object.species}</p>
              )}
            </header>

            {/* Journey timeline — only rendered when there is a lineage */}
            {hasLineage && (
              <>
                {/* "Its life so far" divider */}
                <div className="reveal d2 flex items-center gap-[14px] mt-[34px] mb-[20px]">
                  <span className="flex-1 h-px bg-hairline" />
                  <span className="text-[11px] tracking-[0.14em] uppercase text-[#9A8466]">Its life so far</span>
                  <span className="flex-1 h-px bg-hairline" />
                </div>

                <div>
                  {steps.map((step, i) => {
                    const isFirst = i === 0                        // source (oldest)
                    const isLast = i === steps.length - 1          // finished piece (newest)
                    const isBookend = isFirst || isLast

                    return (
                      <section key={step.id} className="stage">
                        {/* Timeline node */}
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-[7px] w-[14px] h-[14px] rounded-full border-2"
                          style={{
                            background: isLast ? '#B0612F' : '#FBF6EE',
                            borderColor: isFirst ? '#B0612F' : '#CDA074',
                          }}
                        />

                        {/* Step label */}
                        <p className="text-[11px] tracking-[0.09em] uppercase text-[#9A8466] mb-[10px] m-0">
                          {step.step_label}
                        </p>

                        {/* Photo — clickable, opens lightbox with all stage photos */}
                        <StagePhoto photos={step.photos} label={step.step_label} />

                        {/* Step story — serif bookend voice for source/final, italic aside for middle */}
                        {step.public_story && (
                          isBookend ? (
                            <p className="font-fraunces font-normal text-[16px] leading-[1.65] text-[#433B30] mt-[12px] mb-0 whitespace-pre-wrap">
                              {step.public_story}
                            </p>
                          ) : (
                            <p className="text-[14px] italic leading-[1.55] text-bark mt-[11px] mb-0 whitespace-pre-wrap">
                              {step.public_story}
                            </p>
                          )
                        )}
                      </section>
                    )
                  })}
                </div>
              </>
            )}

            {/* Single-object fallback: show story + notes if no lineage */}
            {!hasLineage && object.public_story && (
              <p className="font-fraunces font-normal text-[18px] leading-[1.72] text-[#433B30] mt-[22px] mb-0 whitespace-pre-wrap">
                {object.public_story}
              </p>
            )}
            {!hasLineage && object.public_notes && (
              <p className="text-[15px] leading-[1.65] text-bark mt-4 mb-0 whitespace-pre-wrap">
                {object.public_notes}
              </p>
            )}

            <hr className="h-px bg-hairline border-0 my-7" />

            {/* Maker */}
            <div className="flex items-center gap-[14px]">
              <div className="w-[46px] h-[46px] rounded-full bg-sand flex items-center justify-center shrink-0 overflow-hidden" aria-hidden="true">
                {makerAvatarUrl ? (
                  <Image src={makerAvatarUrl} alt="" width={46} height={46} className="w-full h-full object-cover" />
                ) : (
                  <svg width="30" height="30" viewBox="0 0 40 40" fill="none" stroke="#B0612F" strokeWidth="1.3">
                    <circle cx="21" cy="20" r="3"/><circle cx="20.5" cy="20" r="7"/>
                    <circle cx="20" cy="20" r="11.5"/><circle cx="19.4" cy="20" r="16" stroke="#D8A472"/>
                  </svg>
                )}
              </div>
              <div>
                <p className="text-[11px] tracking-[0.1em] uppercase text-bark m-0 mb-[2px]">From the workshop of</p>
                <Link href={accountData?.handle ? `/${accountData.handle}/maker` : '/maker'} className="font-fraunces font-medium text-[17px] text-ink hover:text-cedar transition-colors no-underline">
                  {workshopName}
                </Link>
              </div>
            </div>

            {accountData?.bio && (
              <p className="text-[14px] leading-[1.7] text-bark mt-4 mb-0">{accountData.bio}</p>
            )}

            {/* Care — from the final piece */}
            {object.public_care && (
              <section className="bg-sand rounded-[12px] px-5 py-[18px] mt-7">
                <h2 className="text-[11px] tracking-[0.12em] uppercase text-cedar mb-2 font-medium font-sans m-0">
                  Looking after it
                </h2>
                <p className="text-[15px] leading-[1.62] text-[#574F44] m-0">{object.public_care}</p>
              </section>
            )}
          </article>

          <PublicFooter />
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
