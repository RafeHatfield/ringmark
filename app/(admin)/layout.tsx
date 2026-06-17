import Link from 'next/link'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { signOut } from '@/actions/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await getOrCreateAccount()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-3 flex items-center justify-between sticky top-0 bg-background z-10">
        <Link href="/workshop" className="font-medium text-sm tracking-widest uppercase text-foreground/80 hover:text-foreground transition-colors">
          Ringmark
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
            {account.name}
          </span>
          <Link href="/settings" className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors">
            Settings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
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
