'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addMarketItemsBulk } from '@/actions/market-events'
import { formatPrice } from '@/lib/money'

/** How many matches to render at once — the rest need a narrower search. */
const MAX_VISIBLE = 60

export type PickerObject = {
  id: string
  workshop_id: string
  title: string | null
  species: string | null
  typeLabel: string
  status: string | null
  price_cents: number | null
}

export function ItemPicker({
  marketEventId,
  candidates,
  capped,
  defaultOpen,
}: {
  marketEventId: string
  candidates: PickerObject[]
  /** True when the candidate query hit its row limit — search is incomplete. */
  capped: boolean
  defaultOpen: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isPending, startTransition] = useTransition()

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      (c) =>
        c.workshop_id.toLowerCase().includes(q) ||
        (c.title?.toLowerCase().includes(q) ?? false) ||
        (c.species?.toLowerCase().includes(q) ?? false),
    )
  }, [candidates, query])

  const visible = matches.slice(0, MAX_VISIBLE)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleAdd() {
    if (selected.size === 0) return
    const ids = [...selected]
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await addMarketItemsBulk(marketEventId, ids)
      if (result.error) {
        setError(result.error)
        return
      }
      const added = result.added ?? 0
      const skipped = result.skipped ?? 0
      setSelected(new Set())
      setQuery('')
      setNotice(
        `Added ${added} ${added === 1 ? 'piece' : 'pieces'}${
          skipped > 0 ? ` · ${skipped} skipped (already on this market)` : ''
        }.`,
      )
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-cedar px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-heartwood"
        >
          + Add pieces
        </button>
        {notice && <p className="mt-2 text-xs text-bark">{notice}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-md border border-hairline p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ID, title or species…"
          aria-label="Search pieces to add"
          className="min-w-0 flex-1 rounded-md border border-hairline bg-paper px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cedar"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 rounded-md border border-hairline px-3 py-2 text-sm text-bark hover:bg-sand"
        >
          Done
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && <p className="mb-2 text-xs text-bark">{notice}</p>}

      {candidates.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-bark">
          Every piece in your workshop is already on this market.
        </p>
      ) : visible.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-bark">
          No pieces match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {visible.map((obj) => {
            const isSelected = selected.has(obj.id)
            return (
              <li key={obj.id}>
                <label
                  className={`flex min-h-[3rem] cursor-pointer items-center gap-3 px-1 py-2 ${
                    isSelected ? 'bg-sand' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(obj.id)}
                    className="h-5 w-5 shrink-0 accent-cedar"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-sm font-medium">{obj.workshop_id}</span>
                    {obj.title && <span className="ml-2 text-sm text-ink">{obj.title}</span>}
                    <span className="block truncate text-xs text-bark">
                      {[obj.typeLabel, obj.species, obj.status?.replace(/_/g, ' ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {obj.price_cents != null && (
                    <span className="shrink-0 text-xs text-bark">
                      {formatPrice(obj.price_cents)}
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      )}

      {matches.length > visible.length && (
        <p className="mt-2 text-xs text-bark">
          Showing {visible.length} of {matches.length} matches — narrow your search to see
          the rest.
        </p>
      )}
      {capped && (
        <p className="mt-2 text-xs text-bark">
          Only your most recently updated pieces are listed here — older ones won&rsquo;t
          appear in this search.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={selected.size === 0 || isPending}
          className="rounded-md bg-cedar px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-heartwood disabled:opacity-40"
        >
          {isPending ? 'Adding…' : `Add ${selected.size} to market`}
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-bark hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
