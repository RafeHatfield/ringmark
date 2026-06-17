import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { suggestRootId } from '@/lib/id-gen'
import type { ObjectType } from '@/lib/types'
import NewObjectForm from './new-object-form'

export default async function NewObjectPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const { type } = await searchParams
  const account = await getOrCreateAccount()
  const supabase = await createClient()
  const suggestedId = await suggestRootId(supabase, account.id, account.default_prefix)

  const validTypes: ObjectType[] = [
    'source', 'log', 'chunk', 'slab', 'blank',
    'rough_bowl', 'finished_bowl', 'pen_blank', 'spindle_blank', 'offcut', 'other',
  ]
  const defaultType = validTypes.includes(type as ObjectType) ? (type as ObjectType) : undefined

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <h1 className="text-lg font-semibold mb-6">Add Object</h1>
      <NewObjectForm suggestedId={suggestedId} defaultType={defaultType} />
    </main>
  )
}
