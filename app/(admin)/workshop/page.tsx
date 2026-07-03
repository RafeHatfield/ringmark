import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { typeLabel } from '@/lib/constants'
import { SearchInput } from '@/components/search-input'
import { rollupRoots } from '@/lib/tree-rollup'
import { RootCard } from '@/components/root-card'

const PAGE_SIZE = 50

const SORT_COLS = ['workshop_id', 'title', 'object_type', 'created_at'] as const
type SortCol = (typeof SORT_COLS)[number]

const SORT_LABELS: Record<SortCol, string> = {
  workshop_id: 'ID',
  title: 'Title',
  object_type: 'Type',
  created_at: 'Date added',
}

// Map to the actual DB column used for ordering
const DB_COL: Record<SortCol, string> = {
  workshop_id: 'workshop_id_lower',
  title: 'title',
  object_type: 'object_type',
  created_at: 'created_at',
}

function buildUrl(params: Record<string, string>) {
  const p = new URLSearchParams(params)
  return `?${p.toString()}`
}

export default async function WorkshopPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string }>
}) {
  const { q, sort, dir, page: pageParam } = await searchParams
  const account = await getOrCreateAccount()
  const supabase = await createClient()

  const query = q?.trim().slice(0, 100) ?? ''
  const sortCol: SortCol = SORT_COLS.includes(sort as SortCol) ? (sort as SortCol) : 'created_at'
  const sortDir: 'asc' | 'desc' = dir === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Search branch: flat list of matching objects
  let searchObjects: { id: string; workshop_id: string; object_type: string; status: string | null; title: string | null }[] | null = null
  // No-search branch
  let summaries: ReturnType<typeof rollupRoots> = []
  let totalRoots = 0

  if (query) {
    const { data } = await supabase
      .from('wood_objects')
      .select('id, workshop_id, object_type, status, title')
      .eq('account_id', account.id)
      .or(`workshop_id_lower.ilike.%${query.toLowerCase()}%,title.ilike.%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(50)
    searchObjects = data
  } else {
    // Count roots for pagination
    const { count } = await supabase
      .from('wood_objects')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', account.id)
      .is('parent_id', null)
    totalRoots = count ?? 0

    // Fetch paginated, sorted roots
    const { data: pagedRoots } = await supabase
      .from('wood_objects')
      .select('id, workshop_id, object_type, status, title, species, parent_id, root_id, updated_at')
      .eq('account_id', account.id)
      .is('parent_id', null)
      .order(DB_COL[sortCol], { ascending: sortDir === 'asc', nullsFirst: false })
      .range(from, to)

    if (pagedRoots && pagedRoots.length > 0) {
      const rootIds = pagedRoots.map((r) => r.id)

      // Fetch all descendants for this page's roots
      const { data: children } = await supabase
        .from('wood_objects')
        .select('id, workshop_id, object_type, status, title, species, parent_id, root_id, updated_at')
        .eq('account_id', account.id)
        .in('root_id', rootIds)
        .not('parent_id', 'is', null)

      summaries = rollupRoots([...pagedRoots, ...(children ?? [])])

      // rollupRoots re-sorts by lastActivity — restore the DB sort order
      const orderMap = new Map(pagedRoots.map((r, i) => [r.id, i]))
      summaries.sort((a, b) => (orderMap.get(a.root.id) ?? 0) - (orderMap.get(b.root.id) ?? 0))
    }
  }

  const totalPages = Math.ceil(totalRoots / PAGE_SIZE)

  function sortLinkUrl(col: SortCol) {
    const newDir = col === sortCol && sortDir === 'asc' ? 'desc' : 'asc'
    return buildUrl({ sort: col, dir: newDir })
  }

  function pageLinkUrl(p: number) {
    return buildUrl({ sort: sortCol, dir: sortDir, page: String(p) })
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <div className="mb-5">
        <SearchInput defaultValue={q} />
      </div>

      <div className="mb-8">
        <Link
          href="/objects/new"
          className="inline-flex items-center justify-center px-4 py-2.5 bg-cedar text-paper rounded-md text-sm font-medium hover:bg-heartwood transition-colors"
        >
          + Add
        </Link>
      </div>

      {query ? (
        // ── Search branch ─────────────────────────────────────────────────────
        !searchObjects || searchObjects.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-bark text-sm">No results for &ldquo;{query}&rdquo;.</p>
          </div>
        ) : (
          <div>
            <h2 className="text-xs text-bark tracking-wider mb-2">
              Results for &ldquo;{query}&rdquo;
            </h2>
            <ul className="divide-y divide-hairline">
              {searchObjects.map((obj) => {
                const label = typeLabel(obj.object_type)
                return (
                  <li key={obj.id}>
                    <Link
                      href={`/objects/${obj.id}`}
                      className="flex items-center justify-between py-3 hover:opacity-70 transition-opacity gap-3"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-sm font-medium">{obj.workshop_id}</span>
                        {obj.title && (
                          <span className="text-xs text-bark ml-2 truncate">{obj.title}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {obj.status && (
                          <span className="text-xs text-bark capitalize">
                            {obj.status.replace('_', ' ')}
                          </span>
                        )}
                        <span className="text-xs text-bark">{label}</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      ) : (
        // ── No-search branch: root-centric summaries ──────────────────────────
        summaries.length === 0 && totalRoots === 0 ? (
          <div className="text-center py-16">
            <p className="text-bark text-sm">
              No pieces yet. Add your first source to get started.
            </p>
          </div>
        ) : (
          <div>
            {/* Sort controls */}
            <div className="flex items-center gap-1 mb-4 flex-wrap">
              <span className="text-xs text-bark mr-1">Sort:</span>
              {SORT_COLS.map((col) => {
                const active = col === sortCol
                const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
                return (
                  <Link
                    key={col}
                    href={sortLinkUrl(col)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      active ? 'bg-cedar text-paper' : 'text-bark hover:text-ink'
                    }`}
                  >
                    {SORT_LABELS[col]}{arrow}
                  </Link>
                )
              })}
            </div>

            <ul className="divide-y divide-hairline">
              {summaries.map((s) => (
                <li key={s.root.id}>
                  <RootCard summary={s} />
                </li>
              ))}
            </ul>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                {page > 1 ? (
                  <Link
                    href={pageLinkUrl(page - 1)}
                    className="text-sm text-bark hover:text-ink transition-colors"
                  >
                    ← Prev
                  </Link>
                ) : (
                  <span className="text-sm text-bark opacity-30">← Prev</span>
                )}
                <span className="text-xs text-bark">
                  {page} / {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={pageLinkUrl(page + 1)}
                    className="text-sm text-bark hover:text-ink transition-colors"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="text-sm text-bark opacity-30">Next →</span>
                )}
              </div>
            )}
          </div>
        )
      )}
    </main>
  )
}
