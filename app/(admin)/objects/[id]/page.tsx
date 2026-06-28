import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { OBJECT_TYPES } from '@/lib/constants'
import { StatusChanger } from '@/components/status-changer'
import { PhotoSection, type PhotoData } from '@/components/photo-section'
import { DeleteObjectButton } from '@/components/delete-object-button'

export default async function ObjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: object } = await supabase
    .from('wood_objects')
    .select('*')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!object) notFound()

  const parent = object.parent_id
    ? (
        await supabase
          .from('wood_objects')
          .select('id, workshop_id, object_type')
          .eq('id', object.parent_id)
          .single()
      ).data
    : null

  const { data: children } = await supabase
    .from('wood_objects')
    .select('id, workshop_id, object_type, status')
    .eq('parent_id', id)
    .order('workshop_id')

  // Fetch photos with signed URLs (1h expiry)
  const { data: rawPhotos } = await supabase
    .from('object_photos')
    .select('id, storage_path, caption, is_public, sort_order')
    .eq('object_id', id)
    .eq('account_id', account.id)
    .order('sort_order')

  let photos: PhotoData[] = []
  if (rawPhotos && rawPhotos.length > 0) {
    const { data: signedData } = await supabase.storage
      .from('object-photos')
      .createSignedUrls(rawPhotos.map((p) => p.storage_path), 3600)

    const urlMap = new Map(signedData?.map((s) => [s.path, s.signedUrl]) ?? [])
    photos = rawPhotos.map((p) => ({
      ...p,
      signedUrl: urlMap.get(p.storage_path) ?? null,
    }))
  }

  const typeLabel =
    OBJECT_TYPES.find((t) => t.value === object.object_type)?.label ?? object.object_type

  const hasDetails =
    object.species ||
    object.dimensions_text ||
    object.finish ||
    object.location_text ||
    object.lineage_confidence

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16">
      {/* Nav */}
      <div className="flex items-center justify-between mb-5">
        <Link href="/" className="text-sm text-bark hover:text-ink">
          ← Back
        </Link>
        <Link
          href={`/objects/${id}/edit`}
          className="text-sm font-medium px-3 py-1.5 border border-hairline rounded-md hover:bg-sand transition-colors"
        >
          Edit
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-mono font-bold tracking-tight mb-1">{object.workshop_id}</h1>
        {object.title && (
          <p className="text-bark text-sm mt-1">{object.title}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <span className="text-xs px-2 py-0.5 rounded-full border text-bark">
            {typeLabel}
          </span>
          <StatusChanger objectId={id} status={object.status} />
          {object.is_published && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">
              Published
            </span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 flex-wrap mb-8">
        <Link
          href={`/objects/${id}/child/new`}
          className="px-3 py-1.5 border border-hairline rounded-md text-sm hover:bg-sand transition-colors"
        >
          + Add Child
        </Link>
        <Link
          href={`/objects/${id}/story`}
          className="px-3 py-1.5 border border-hairline rounded-md text-sm hover:bg-sand transition-colors"
        >
          Edit Story
        </Link>
        <Link
          href={`/objects/${id}/qr`}
          className="px-3 py-1.5 border border-hairline rounded-md text-sm hover:bg-sand transition-colors"
        >
          QR Card
        </Link>
      </div>

      {/* Lineage */}
      {(parent || (children && children.length > 0)) && (
        <section className="mb-6">
          <h2 className="text-xs text-bark tracking-wider mb-3">
            Lineage
          </h2>
          <div className="border border-hairline rounded-md divide-y divide-hairline">
            {parent && (
              <div className="px-4 py-3">
                <p className="text-xs text-bark mb-0.5">Parent</p>
                <Link
                  href={`/objects/${parent.id}`}
                  className="font-mono text-sm font-medium hover:underline"
                >
                  {parent.workshop_id}
                </Link>
                <span className="text-xs text-bark ml-2">
                  {OBJECT_TYPES.find((t) => t.value === parent.object_type)?.label}
                </span>
              </div>
            )}
            {children && children.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-xs text-bark mb-2">
                  Children ({children.length})
                </p>
                <ul className="space-y-1.5">
                  {children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/objects/${child.id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {child.workshop_id}
                      </Link>
                      <span className="text-xs text-bark ml-2">
                        {OBJECT_TYPES.find((t) => t.value === child.object_type)?.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="px-4 py-3 border-t border-hairline">
              <Link
                href={`/objects/${object.root_id ?? id}/tree`}
                className="text-xs text-bark hover:text-ink underline"
              >
                View full tree →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Photos */}
      <section className="mb-6">
        <h2 className="text-xs text-bark tracking-wider mb-3">
          Photos
        </h2>
        <PhotoSection objectId={id} accountId={account.id} initialPhotos={photos} />
      </section>

      {/* Details */}
      <section className="mb-6">
        <h2 className="text-xs text-bark tracking-wider mb-3">
          Details
        </h2>
        {hasDetails ? (
          <dl className="border border-hairline rounded-md divide-y divide-hairline">
            {object.species && (
              <div className="px-4 py-3 flex justify-between gap-4">
                <dt className="text-sm text-bark shrink-0">Species</dt>
                <dd className="text-sm text-right">
                  {object.species}
                  {object.species_confidence && (
                    <span className="text-bark ml-1 text-xs capitalize">
                      ({object.species_confidence})
                    </span>
                  )}
                </dd>
              </div>
            )}
            {object.dimensions_text && (
              <div className="px-4 py-3 flex justify-between gap-4">
                <dt className="text-sm text-bark shrink-0">Dimensions</dt>
                <dd className="text-sm text-right">{object.dimensions_text}</dd>
              </div>
            )}
            {object.finish && (
              <div className="px-4 py-3 flex justify-between gap-4">
                <dt className="text-sm text-bark shrink-0">Finish</dt>
                <dd className="text-sm text-right">{object.finish}</dd>
              </div>
            )}
            {object.location_text && (
              <div className="px-4 py-3 flex justify-between gap-4">
                <dt className="text-sm text-bark shrink-0">
                  Location{' '}
                  <span className="text-xs text-bark font-normal">(private)</span>
                </dt>
                <dd className="text-sm text-right">{object.location_text}</dd>
              </div>
            )}
            {object.lineage_confidence && (
              <div className="px-4 py-3 flex justify-between gap-4">
                <dt className="text-sm text-bark shrink-0">Lineage</dt>
                <dd className="text-sm text-right capitalize">
                  {object.lineage_confidence.replace('_', ' ')}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="border border-hairline rounded-md px-4 py-4">
            <p className="text-sm text-bark">
              No details yet.{' '}
              <Link href={`/objects/${id}/edit`} className="underline">
                Add details →
              </Link>
            </p>
          </div>
        )}
        {object.private_notes && (
          <div className="mt-3 border border-hairline rounded-md px-4 py-3">
            <p className="text-xs text-bark mb-1">Private notes</p>
            <p className="text-sm whitespace-pre-wrap">{object.private_notes}</p>
          </div>
        )}
      </section>

      {/* Public story + QR */}
      <section className="mb-12 border-t border-hairline pt-6">
        <h2 className="text-xs text-bark tracking-wider mb-4">Public</h2>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-sm">
              {object.is_published ? 'Published' : 'Not published'}
            </p>
            {object.is_published ? (
              <a
                href={`/p/${object.public_slug}`}
                className="font-mono text-bark text-xs mt-0.5 underline block"
              >
                /p/{object.public_slug}
              </a>
            ) : (
              <p className="font-mono text-bark text-xs mt-0.5">
                /p/{object.public_slug}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Link
              href={`/objects/${id}/story`}
              className="text-sm px-3 py-1.5 border border-hairline rounded-md hover:bg-sand transition-colors"
            >
              {object.public_story ? 'Edit Story' : 'Add Story'}
            </Link>
            <Link
              href={`/objects/${id}/qr`}
              className="text-sm px-3 py-1.5 border border-hairline rounded-md hover:bg-sand transition-colors"
            >
              QR
            </Link>
          </div>
        </div>
      </section>

      {/* Danger zone */}
      <section className="border-t border-hairline pt-8">
        <h2 className="text-xs text-bark tracking-wider mb-3">
          Danger Zone
        </h2>
        <p className="text-xs text-bark mb-4">
          Permanently deletes this object, all its photos, and removes it from any lineage trees.
          Children are not deleted but become roots.
        </p>
        <DeleteObjectButton objectId={id} />
      </section>
    </main>
  )
}
