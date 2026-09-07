import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import QrCard from '@/app/(admin)/objects/[id]/qr/qr-card'

type LabelItem = {
  id: string
  workshopId: string
  publicSlug: string
}

// One QrCard per item, reused as-is (see market-mode-plan.md Task 3.4 — the
// QR card layout is being redesigned separately, so this page collates
// existing cards rather than building a purpose-made label component).
export default async function MarketLabelsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: event } = await supabase
    .from('market_events')
    .select('id, name')
    .eq('id', id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!event) notFound()

  const { data: rows } = await supabase
    .from('market_event_items')
    .select('id, object_id, sort_order')
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)
    .order('sort_order', { ascending: true })

  const itemRows = rows ?? []
  const objectIds = [...new Set(itemRows.map((r) => r.object_id))]

  const { data: objects } = objectIds.length
    ? await supabase
        .from('wood_objects')
        .select('id, workshop_id, public_slug')
        .eq('account_id', account.id)
        .in('id', objectIds)
    : { data: [] }
  const objectById = new Map((objects ?? []).map((o) => [o.id, o]))

  const items: LabelItem[] = itemRows
    .map((row) => {
      const obj = objectById.get(row.object_id)
      if (!obj) return null
      return { id: row.id, workshopId: obj.workshop_id, publicSlug: obj.public_slug }
    })
    .filter((item): item is LabelItem => item !== null)

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-6">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/markets/${event.id}`} className="text-sm text-bark hover:text-ink">
          ← Back to market
        </Link>
      </div>

      <h1 className="mb-1 font-fraunces text-2xl tracking-tight">QR Labels</h1>
      <p className="mb-6 text-sm text-bark">{event.name}</p>

      {items.length === 0 ? (
        <p className="text-sm text-bark">Nothing on this market yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          {items.map((item) => (
            <QrCard
              key={item.id}
              workshopId={item.workshopId}
              publicUrl={`https://ringmark.org/p/${item.publicSlug}`}
              publicSlug={item.publicSlug}
            />
          ))}
        </div>
      )}

      {/*
        QrCard's own print CSS (qr-card.tsx) targets #qr-print-card /
        #qr-print-label by id and force-positions them at
        position: absolute; top: 0; left: 0 — correct for the single-object
        QR page it was built for, but with N QrCards on this page (duplicate
        ids, one per item, by design) that would stack every card on top of
        the others. Overriding position back to static here lets the grid
        hold instead. This isn't a restyle of QrCard's look — it's the
        minimum needed to render "many" per the task, and the card layout
        itself is left untouched pending its own redesign.
      */}
      <style>{`
        @media print {
          @page { margin: 12mm; }
          header { display: none !important; }
          #qr-print-card, #qr-print-label {
            position: static !important;
            top: auto !important;
            left: auto !important;
            break-inside: avoid;
            margin: 0 auto 24px;
          }
        }
      `}</style>
    </main>
  )
}
