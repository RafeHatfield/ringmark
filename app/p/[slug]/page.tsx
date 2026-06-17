import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function PublicStoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  // Auth routing check — only select what's needed
  const { data: authCheck } = await supabase
    .from('wood_objects')
    .select('id, is_published, account_id')
    .eq('public_slug', slug)
    .single()

  if (!authCheck) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">This piece could not be found.</p>
      </main>
    )
  }

  // If the logged-in user owns this object, redirect to admin view
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('owner_user_id', user.id)
      .single()

    if (account?.id === authCheck.account_id) {
      redirect(`/objects/${authCheck.id}`)
    }
  }

  if (!authCheck.is_published) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">
          This piece&apos;s story hasn&apos;t been published yet.
        </p>
      </main>
    )
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
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">This piece could not be found.</p>
      </main>
    )
  }

  // Fetch public photos only — signed URLs for display
  const { data: photos } = await supabase
    .from('object_photos')
    .select('id, storage_path, caption, sort_order')
    .eq('object_id', object.id)
    .eq('is_public', true)
    .order('sort_order')

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

  const displayTitle = object.public_title || object.title || `/${object.public_slug}`

  return (
    <main className="max-w-lg mx-auto px-5 pt-12 pb-20">
      {/* Header */}
      <h1 className="font-fraunces text-3xl font-semibold leading-tight mb-1">
        {displayTitle}
      </h1>
      {object.species && (
        <p className="text-sm text-muted-foreground mt-1 mb-8">{object.species}</p>
      )}
      {!object.species && <div className="mb-8" />}

      {/* Photos — full bleed on mobile */}
      {photoUrls.length > 0 && (
        <div className="mb-10 -mx-5 space-y-1">
          {photoUrls.map((p, i) =>
            p.url ? (
              <figure key={i} className="rounded-md overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption ?? ''} className="w-full object-cover" />
                {p.caption && (
                  <figcaption className="px-5 pt-2 text-xs text-muted-foreground">
                    {p.caption}
                  </figcaption>
                )}
              </figure>
            ) : null,
          )}
        </div>
      )}

      {/* Story */}
      {object.public_story && (
        <section className="mb-8">
          <p className="text-base leading-8 text-foreground/90 whitespace-pre-wrap">
            {object.public_story}
          </p>
        </section>
      )}

      {/* Notes */}
      {object.public_notes && (
        <section className="mb-8 border-l-2 border-border pl-4">
          <p className="text-sm leading-7 text-muted-foreground whitespace-pre-wrap">
            {object.public_notes}
          </p>
        </section>
      )}

      {/* Care */}
      {object.public_care && (
        <section className="mb-10">
          <h2 className="text-xs text-muted-foreground tracking-wider mb-3">Care</h2>
          <p className="text-sm leading-7">{object.public_care}</p>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t pt-5">
        <p className="text-xs text-muted-foreground/60">
          Tracked with{' '}
          <Link href="/" className="underline underline-offset-2">
            Ringmark
          </Link>
        </p>
      </footer>
    </main>
  )
}
