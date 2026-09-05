import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import type { MarketEventStatus } from '@/lib/types'

const STATUS_TABS: { value: MarketEventStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_VALUES: MarketEventStatus[] = ['planning', 'active', 'completed', 'cancelled']

// event_date is a date-only column ('YYYY-MM-DD'). Parse the parts directly
// rather than `new Date(dateStr)` to avoid a UTC-midnight/local-timezone
// off-by-one-day shift.
function formatEventDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const account = await getOrCreateAccount()
  const supabase = await createClient()

  const statusFilter = STATUS_VALUES.includes(status as MarketEventStatus)
    ? (status as MarketEventStatus)
    : undefined

  let query = supabase
    .from('market_events')
    .select('id, name, event_date, location_text, status')
    .eq('account_id', account.id)
    .order('event_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (statusFilter) query = query.eq('status', statusFilter)

  const { data: events } = await query

  // Item counts per event — one extra query, grouped in JS. No N+1.
  const itemCounts = new Map<string, number>()
  if (events && events.length > 0) {
    const { data: items } = await supabase
      .from('market_event_items')
      .select('market_event_id')
      .eq('account_id', account.id)
      .in('market_event_id', events.map((e) => e.id))
    for (const item of items ?? []) {
      itemCounts.set(item.market_event_id, (itemCounts.get(item.market_event_id) ?? 0) + 1)
    }
  }

  const isEmpty = !events || events.length === 0
  // Genuinely no markets at all — vs. the current filter just has no matches.
  const trulyEmpty = !statusFilter && isEmpty

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <h1 className="text-lg font-semibold mb-6">Markets</h1>

      {!trulyEmpty && (
        <div className="mb-8">
          <Link
            href="/markets/new"
            className="inline-flex items-center justify-center px-4 py-2.5 bg-cedar text-paper rounded-md text-sm font-medium hover:bg-heartwood transition-colors"
          >
            + New market
          </Link>
        </div>
      )}

      {!trulyEmpty && (
        <div className="flex items-center gap-1 mb-4 flex-wrap">
          <span className="text-xs text-bark mr-1">Status:</span>
          {STATUS_TABS.map((tab) => {
            const active = tab.value === (statusFilter ?? 'all')
            return (
              <Link
                key={tab.value}
                href={tab.value === 'all' ? '/markets' : `/markets?status=${tab.value}`}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  active ? 'bg-cedar text-paper' : 'text-bark hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      )}

      {isEmpty ? (
        <div className="text-center py-16">
          <p className="text-bark text-sm mb-4">
            {statusFilter
              ? `No ${statusFilter} markets.`
              : 'No markets yet. Create one to start planning your next sale.'}
          </p>
          {trulyEmpty && (
            <Link
              href="/markets/new"
              className="inline-flex items-center justify-center px-4 py-2.5 bg-cedar text-paper rounded-md text-sm font-medium hover:bg-heartwood transition-colors"
            >
              + New market
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {events!.map((event) => {
            const count = itemCounts.get(event.id) ?? 0
            return (
              <li key={event.id}>
                <Link
                  href={`/markets/${event.id}`}
                  className="flex items-center justify-between py-3 hover:opacity-70 transition-opacity gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{event.name}</span>
                      <span className="text-xs text-bark capitalize">{event.status}</span>
                    </div>
                    <p className="text-xs text-bark mt-0.5 truncate">
                      {event.event_date ? formatEventDate(event.event_date) : 'No date set'}
                      {event.location_text && ` · ${event.location_text}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-bark">
                      {count} item{count === 1 ? '' : 's'}
                    </span>
                    <span className="text-xs text-bark">→</span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
