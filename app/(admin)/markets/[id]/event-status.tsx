'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateMarketEvent } from '@/actions/market-events'
import type { MarketEventStatus } from '@/lib/types'

const MARKET_EVENT_STATUSES: { value: MarketEventStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function EventStatus({
  eventId,
  status,
}: {
  eventId: string
  status: MarketEventStatus
}) {
  const router = useRouter()
  const [optimistic, setOptimistic] = useState<MarketEventStatus>(status)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // Re-sync when the server sends fresh data (after a refresh elsewhere).
  useEffect(() => setOptimistic(status), [status])

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as MarketEventStatus
    const previous = optimistic
    setOptimistic(next)
    setError('')
    startTransition(async () => {
      const result = await updateMarketEvent(eventId, { status: next })
      if (result.error) {
        setOptimistic(previous)
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <select
        value={optimistic}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Event status"
        className="rounded-full border border-hairline bg-sand px-3 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-cedar disabled:opacity-50"
      >
        {MARKET_EVENT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  )
}
