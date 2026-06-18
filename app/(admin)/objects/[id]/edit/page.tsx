import { notFound } from 'next/navigation'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import EditObjectForm from './edit-object-form'

export default async function EditObjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: object } = await supabase
    .from('wood_objects')
    .select('*')
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!object) notFound()

  const parentWorkshopId = object.parent_id
    ? (
        await supabase
          .from('wood_objects')
          .select('workshop_id')
          .eq('id', object.parent_id)
          .single()
      ).data?.workshop_id ?? null
    : null

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <h1 className="text-lg font-semibold mb-1">Edit {object.workshop_id}</h1>
      {object.title && <p className="text-sm text-bark mb-6">{object.title}</p>}
      {!object.title && <div className="mb-6" />}
      <EditObjectForm object={object} parentWorkshopId={parentWorkshopId} />
    </main>
  )
}
