import { notFound } from 'next/navigation'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import StoryEditor from './story-editor'

export default async function EditStoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const account = await getOrCreateAccount()

  const { data: object } = await supabase
    .from('wood_objects')
    .select(
      'id, public_slug, is_published, public_title, public_story, public_notes, public_care, workshop_id',
    )
    .eq('id', id)
    .eq('account_id', account.id)
    .single()

  if (!object) notFound()

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16">
      <h1 className="text-lg font-semibold mb-1">Public Story</h1>
      <p className="text-sm text-muted-foreground mb-6">{object.workshop_id}</p>
      <StoryEditor
        objectId={id}
        publicSlug={object.public_slug}
        isPublished={object.is_published}
        publicTitle={object.public_title}
        publicStory={object.public_story}
        publicNotes={object.public_notes}
        publicCare={object.public_care}
      />
    </main>
  )
}
