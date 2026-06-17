import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createClient } from '@/lib/supabase/server'
import { ProfileForm } from './profile-form'

export default async function ProfilePage() {
  const account = await getOrCreateAccount()
  const supabase = await createClient()

  let avatarUrl: string | null = null
  if (account.avatar_storage_path) {
    const { data } = supabase.storage
      .from('avatars')
      .getPublicUrl(account.avatar_storage_path)
    avatarUrl = data.publicUrl
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16">
      <div className="mb-5">
        <Link href="/workshop" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <h1 className="text-lg font-medium mb-8">Profile</h1>

      <ProfileForm
        accountId={account.id}
        initialDisplayName={account.display_name ?? ''}
        initialWorkshopName={account.workshop_name ?? ''}
        initialBio={account.bio ?? ''}
        initialWebsiteUrl={account.website_url ?? ''}
        initialAvatarUrl={avatarUrl}
        initialAvatarPath={account.avatar_storage_path}
      />
    </main>
  )
}
