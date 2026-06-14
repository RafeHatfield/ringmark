import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function PublicStoryPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: object } = await supabase
    .from('wood_objects')
    .select('id, is_published, account_id')
    .eq('public_slug', slug)
    .single()

  if (!object) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">This piece could not be found.</p>
      </main>
    )
  }

  // If the logged-in user owns this object, redirect to admin view
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('owner_user_id', user.id)
      .single()

    if (account?.id === object.account_id) {
      redirect(`/objects/${object.id}`)
    }
  }

  if (!object.is_published) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">
          This piece&apos;s story hasn&apos;t been published yet.
        </p>
      </main>
    )
  }

  // Full public story page — coming in Milestone 4
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <p className="text-sm text-muted-foreground">Public story — coming in Milestone 4.</p>
    </main>
  )
}
