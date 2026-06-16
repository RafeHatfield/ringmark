import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { signOut } from '@/actions/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await getOrCreateAccount()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-3 flex items-center justify-between sticky top-0 bg-background z-10">
        <Link href="/" className="font-semibold text-base tracking-tight">
          Ringmark
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground truncate max-w-[120px]">
            {account.name}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
