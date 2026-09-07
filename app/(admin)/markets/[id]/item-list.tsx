'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import {
  markItemSold,
  removeMarketItem,
  unmarkItemSold,
  updateMarketItemPrice,
} from '@/actions/market-events'
import { centsToInputValue, formatPrice, parseDollarsToCents } from '@/lib/money'

export type MarketItemRow = {
  id: string
  object_id: string
  workshop_id: string
  title: string | null
  species: string | null
  asking_price_cents: number | null
  sold: boolean
  sold_price_cents: number | null
  sort_order: number
  thumbnailUrl: string | null
}

export function ItemList({ items }: { items: MarketItemRow[] }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  // Optimistic sold state, keyed by item id. Applied on top of server data so
  // the toggle flips the instant it's tapped — this is the button used with a
  // customer standing there. An entry is dropped once the server agrees with
  // it (or on error, when it's reverted immediately).
  const [soldOverrides, setSoldOverrides] = useState<Record<string, boolean>>({})

  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [priceValue, setPriceValue] = useState('')
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null)

  useEffect(() => {
    setSoldOverrides((prev) => {
      const entries = Object.entries(prev)
      if (entries.length === 0) return prev
      const next: Record<string, boolean> = {}
      for (const [id, sold] of entries) {
        const item = items.find((i) => i.id === id)
        // Keep only overrides the server hasn't caught up with yet.
        if (item && item.sold !== sold) next[id] = sold
      }
      return Object.keys(next).length === entries.length ? prev : next
    })
  }, [items])

  const rows = useMemo(() => {
    return [...items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => {
        const sold = soldOverrides[item.id] ?? item.sold
        return {
          ...item,
          sold,
          // While a mark-sold is in flight the server hasn't set
          // sold_price_cents yet; the action defaults it to the asking price,
          // so show that rather than a blank.
          displaySoldPrice: sold ? (item.sold_price_cents ?? item.asking_price_cents) : null,
        }
      })
  }, [items, soldOverrides])

  const totals = useMemo(
    () => ({
      count: rows.length,
      soldCount: rows.filter((r) => r.sold).length,
      asking: rows.reduce((sum, r) => sum + (r.asking_price_cents ?? 0), 0),
      sold: rows.reduce((sum, r) => sum + (r.sold ? (r.displaySoldPrice ?? 0) : 0), 0),
    }),
    [rows],
  )

  function handleToggleSold(itemId: string, currentlySold: boolean) {
    const next = !currentlySold
    setSoldOverrides((prev) => ({ ...prev, [itemId]: next }))
    setError('')
    startTransition(async () => {
      const result = next ? await markItemSold(itemId) : await unmarkItemSold(itemId)
      if (result.error) {
        setSoldOverrides((prev) => {
          const revert = { ...prev }
          delete revert[itemId]
          return revert
        })
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  function startEditPrice(item: MarketItemRow) {
    setEditingPriceId(item.id)
    setPriceValue(centsToInputValue(item.asking_price_cents))
    setError('')
  }

  function handleSavePrice(itemId: string) {
    const parsed = parseDollarsToCents(priceValue)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    startTransition(async () => {
      const result = await updateMarketItemPrice(itemId, parsed.cents)
      if (result.error) {
        setError(result.error)
      } else {
        setError('')
        setEditingPriceId(null)
        router.refresh()
      }
    })
  }

  function handleRemove(itemId: string) {
    startTransition(async () => {
      const result = await removeMarketItem(itemId)
      setConfirmingRemoveId(null)
      if (result.error) {
        setError(result.error)
      } else {
        setError('')
        router.refresh()
      }
    })
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-hairline px-4 py-8 text-center">
          <p className="text-sm text-bark">
            Nothing on this market yet. Add pieces above.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((item) => (
            <li
              key={item.id}
              className={`rounded-md border px-3 py-3 ${
                item.sold ? 'border-cedar/40 bg-sand' : 'border-hairline bg-paper'
              }`}
            >
              <div className="flex gap-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded bg-sand">
                  {item.thumbnailUrl ? (
                    <Image
                      src={item.thumbnailUrl}
                      alt=""
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] text-bark">
                      No photo
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/objects/${item.object_id}`}
                        className="font-mono text-sm font-medium hover:underline"
                      >
                        {item.workshop_id}
                      </Link>
                      {item.title && (
                        <p className="truncate text-sm text-ink">{item.title}</p>
                      )}
                      {item.species && <p className="text-xs text-bark">{item.species}</p>}
                    </div>

                    {confirmingRemoveId === item.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleRemove(item.id)}
                          disabled={isPending}
                          className="rounded border border-destructive px-2 py-1 text-xs text-destructive disabled:opacity-50"
                        >
                          {isPending ? 'Removing…' : 'Remove'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingRemoveId(null)}
                          className="rounded border border-hairline px-2 py-1 text-xs text-bark"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingRemoveId(item.id)}
                        aria-label={`Remove ${item.workshop_id} from this market`}
                        className="shrink-0 rounded border border-hairline px-2 py-1 text-xs text-bark hover:bg-sand"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {editingPriceId === item.id ? (
                    <div className="mt-2 flex items-center gap-1">
                      <span className="text-sm text-bark">$</span>
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={priceValue}
                        onChange={(e) => setPriceValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSavePrice(item.id)
                          if (e.key === 'Escape') setEditingPriceId(null)
                        }}
                        aria-label={`Asking price for ${item.workshop_id}`}
                        placeholder="120"
                        maxLength={12}
                        className="w-24 rounded border border-hairline bg-paper px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-cedar"
                      />
                      <button
                        type="button"
                        onClick={() => handleSavePrice(item.id)}
                        disabled={isPending}
                        className="rounded bg-cedar px-2 py-1 text-xs text-paper disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPriceId(null)}
                        className="rounded border border-hairline px-2 py-1 text-xs text-bark"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditPrice(item)}
                      className="mt-2 text-sm text-ink hover:underline"
                    >
                      {item.asking_price_cents != null ? (
                        formatPrice(item.asking_price_cents)
                      ) : (
                        <span className="italic text-bark">Set price…</span>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* The live-at-the-table button: big target, optimistic, no
                  confirmation step. Tapping again undoes it. */}
              <button
                type="button"
                onClick={() => handleToggleSold(item.id, item.sold)}
                aria-pressed={item.sold}
                className={`mt-3 flex min-h-[3.25rem] w-full flex-col items-center justify-center rounded-md px-4 text-base font-medium transition-colors ${
                  item.sold
                    ? 'bg-cedar text-paper hover:bg-heartwood'
                    : 'border border-hairline bg-paper text-ink hover:bg-sand'
                }`}
              >
                {item.sold ? (
                  <>
                    <span>
                      Sold
                      {item.displaySoldPrice != null && ` · ${formatPrice(item.displaySoldPrice)}`}
                    </span>
                    <span className="text-xs font-normal opacity-80">Tap to undo</span>
                  </>
                ) : (
                  <span>Mark sold</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-y-1 rounded-md border border-hairline bg-sand px-4 py-3 text-sm">
        <dt className="text-bark">Pieces</dt>
        <dd className="text-right font-medium">{totals.count}</dd>
        <dt className="text-bark">Sold</dt>
        <dd className="text-right font-medium">{totals.soldCount}</dd>
        <dt className="text-bark">Asking total</dt>
        <dd className="text-right font-medium">{formatPrice(totals.asking)}</dd>
        <dt className="text-bark">Sold total</dt>
        <dd className="text-right font-medium">{formatPrice(totals.sold)}</dd>
      </dl>
    </div>
  )
}
