import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { OBJECT_TYPES } from '@/lib/constants'
import { SearchInput } from '@/components/search-input'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const account = await getOrCreateAccount()
  const supabase = await createClient()

  const query = q?.trim().slice(0, 100) ?? ''

  let objects: { id: string; workshop_id: string; object_type: string; status: string | null; title: string | null }[] | null = null

  if (query) {
    const { data } = await supabase
      .from('wood_objects')
      .select('id, workshop_id, object_type, status, title')
      .eq('account_id', account.id)
      .or(`workshop_id_lower.ilike.%${query.toLowerCase()}%,title.ilike.%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(30)
    objects = data
  } else {
    const { data } = await supabase
      .from('wood_objects')
      .select('id, workshop_id, object_type, status, title')
      .eq('account_id', account.id)
      .order('updated_at', { ascending: false })
      .limit(10)
    objects = data
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <div className="mb-5">
        <SearchInput defaultValue={q} />
      </div>

      <div className="flex gap-3 mb-8">
        <Link
          href="/objects/new?type=source"
          className="flex-1 flex items-center justify-center px-4 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          + Add Source
        </Link>
        <Link
          href="/objects/new"
          className="flex-1 flex items-center justify-center px-4 py-2.5 border border-input rounded-md text-sm font-medium hover:bg-accent transition-colors"
        >
          + Add Object
        </Link>
      </div>

      {!objects || objects.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-sm">
            {query ? `No results for "${query}".` : 'No pieces yet. Add your first source to get started.'}
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            {query ? `Results for "${query}"` : 'Recent'}
          </h2>
          <ul className="divide-y divide-border rounded-md border">
            {objects.map((obj) => {
              const typeLabel = OBJECT_TYPES.find((t) => t.value === obj.object_type)?.label ?? obj.object_type
              return (
                <li key={obj.id}>
                  <Link
                    href={`/objects/${obj.id}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors gap-3"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-medium">{obj.workshop_id}</span>
                      {obj.title && (
                        <span className="text-xs text-muted-foreground ml-2 truncate">{obj.title}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {obj.status && (
                        <span className="text-xs text-muted-foreground capitalize">
                          {obj.status.replace('_', ' ')}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{typeLabel}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </main>
  )
}
