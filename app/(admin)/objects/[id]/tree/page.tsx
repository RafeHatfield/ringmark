import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { buildTree } from '@/lib/build-tree'
import { ObjectTree } from '@/components/object-tree'

export default async function ObjectTreePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const account = await getOrCreateAccount()
  const supabase = await createClient()

  const { data: root } = await supabase
    .from('wood_objects')
    .select('id, workshop_id, title, object_type, parent_id')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!root) notFound()
  if (root.parent_id !== null) notFound()

  const { data: allNodes } = await supabase
    .from('wood_objects')
    .select('id, workshop_id, object_type, status, title, parent_id')
    .eq('root_id', id)
    .eq('account_id', account.id)
    .order('workshop_id')

  const treeNodes = buildTree(allNodes ?? [])

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16">
      <div className="mb-5">
        <Link href={`/objects/${id}`} className="text-sm text-bark hover:text-ink">
          ← {root.workshop_id}
        </Link>
      </div>
      <h1 className="text-xl font-mono font-bold mb-1">{root.workshop_id}</h1>
      {root.title && <p className="text-bark text-sm mb-6">{root.title}</p>}
      <section>
        <h2 className="text-xs text-bark tracking-wider mb-3">Full tree</h2>
        <div className="border border-hairline rounded-md overflow-hidden">
          <ObjectTree nodes={treeNodes} />
        </div>
      </section>
    </main>
  )
}
