import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 gap-4">
      <p className="text-4xl font-mono font-bold text-muted-foreground">404</p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link href="/" className="text-sm text-muted-foreground underline hover:text-foreground">
        Go home
      </Link>
    </main>
  )
}
