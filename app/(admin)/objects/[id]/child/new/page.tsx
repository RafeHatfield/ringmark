import { notFound } from 'next/navigation'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { suggestDescendantId } from '@/lib/id-gen'
import ObjectForm from '@/components/object-form'

export default async function AddChildPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: parent } = await supabase
    .from('wood_objects')
    .select('id, workshop_id, root_id, account_id')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!parent) notFound()

  // Find the root object for its workshop_id (used as the ID prefix)
  const rootId = parent.root_id ?? parent.id
  const { data: root } = await supabase
    .from('wood_objects')
    .select('id, workshop_id')
    .eq('id', rootId)
    .single()

  const rootWorkshopId = root?.workshop_id ?? parent.workshop_id
  const suggestedId = await suggestDescendantId(supabase, account.id, rootId, rootWorkshopId)

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <h1 className="text-lg font-semibold mb-6">Add Child</h1>
      <ObjectForm
        parent={{ id: parent.id, workshopId: parent.workshop_id }}
        suggestedId={suggestedId}
      />
    </main>
  )
}
