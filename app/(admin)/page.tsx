import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const account = await getOrCreateAccount()
  const supabase = await createClient()

  const { data: recents } = await supabase
    .from('wood_objects')
    .select('id, workshop_id, object_type, status, title')
    .eq('account_id', account.id)
    .order('updated_at', { ascending: false })
    .limit(10)

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <div className="mb-6">
        <input
          type="search"
          placeholder="Search by workshop ID or title..."
          className="w-full border border-input rounded-md px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          disabled
          title="Search coming in Milestone 1"
        />
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

      {!recents || recents.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground text-sm">
            No pieces yet. Add your first source to get started.
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Recent
          </h2>
          <ul className="divide-y divide-border rounded-md border">
            {recents.map((obj) => (
              <li key={obj.id}>
                <Link
                  href={`/objects/${obj.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
                >
                  <span className="font-mono text-sm font-medium">{obj.workshop_id}</span>
                  <span className="text-xs text-muted-foreground capitalize">
                    {obj.object_type.replace('_', ' ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  )
}
