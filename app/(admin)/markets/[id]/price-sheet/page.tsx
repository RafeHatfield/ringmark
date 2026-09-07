import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/money'

/** 'YYYY-MM-DD' -> a readable date, parsed as local parts so it never shifts a day. */
function formatEventDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

type PriceSheetItem = {
  id: string
  workshopId: string
  title: string | null
  askingPriceCents: number | null
}

// Asking price per item + a running total — the sheet a maker can glance at
// (or hand to a helper working the table) without prices living on the pack
// list. No checkboxes here, unlike /pack.
export default async function MarketPriceSheetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: event } = await supabase
    .from('market_events')
    .select('id, name, event_date')
    .eq('id', id)
    .eq('account_id', account.id)
    .maybeSingle()

  if (!event) notFound()

  const { data: rows } = await supabase
    .from('market_event_items')
    .select('id, object_id, sort_order, asking_price_cents')
    .eq('market_event_id', event.id)
    .eq('account_id', account.id)
    .order('sort_order', { ascending: true })

  const itemRows = rows ?? []
  const objectIds = [...new Set(itemRows.map((r) => r.object_id))]

  const { data: objects } = objectIds.length
    ? await supabase
        .from('wood_objects')
        .select('id, workshop_id, title')
        .eq('account_id', account.id)
        .in('id', objectIds)
    : { data: [] }
  const objectById = new Map((objects ?? []).map((o) => [o.id, o]))

  const items: PriceSheetItem[] = itemRows.map((row) => {
    const obj = objectById.get(row.object_id)
    return {
      id: row.id,
      workshopId: obj?.workshop_id ?? '—',
      title: obj?.title ?? null,
      askingPriceCents: row.asking_price_cents,
    }
  })

  const totalCents = items.reduce((sum, item) => sum + (item.askingPriceCents ?? 0), 0)

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/markets/${event.id}`} className="text-sm text-bark hover:text-ink">
          ← Back to market
        </Link>
      </div>

      <h1 className="mb-1 font-fraunces text-2xl tracking-tight">Price Sheet</h1>
      <p className="mb-6 text-sm text-bark">
        {event.name}
        {event.event_date && <span className="ml-2">· {formatEventDate(event.event_date)}</span>}
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-bark">Nothing on this market yet.</p>
      ) : (
        <>
          <div className="divide-y divide-hairline rounded-md border border-hairline">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 break-inside-avoid px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">{item.workshopId}</p>
                  {item.title && <p className="truncate text-sm text-bark">{item.title}</p>}
                </div>
                <p className="shrink-0 text-sm font-medium">
                  {item.askingPriceCents != null ? formatPrice(item.askingPriceCents) : '—'}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-1 flex items-center justify-between border-t-2 border-ink px-4 py-3 text-sm font-semibold">
            <span>Total asking value</span>
            <span>{formatPrice(totalCents)}</span>
          </div>
        </>
      )}

      <style>{`
        @media print {
          @page { margin: 12mm; }
          header { display: none !important; }
        }
      `}</style>
    </main>
  )
}
