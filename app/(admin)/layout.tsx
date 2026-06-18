import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { signOut } from '@/actions/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await getOrCreateAccount()

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-hairline px-4 py-3 flex items-center justify-between sticky top-0 bg-paper z-10">
        <Link href="/workshop" className="font-medium text-sm tracking-widest uppercase text-ink/70 hover:text-ink transition-colors">
          Ringmark
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-xs text-bark truncate max-w-[120px]">
            {account.name}
          </span>
          <Link href="/profile" className="text-xs text-bark/70 hover:text-bark transition-colors">
            Profile
          </Link>
          <Link href="/settings" className="text-xs text-bark/70 hover:text-bark transition-colors">
            Settings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-bark/70 hover:text-bark transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  )
}
