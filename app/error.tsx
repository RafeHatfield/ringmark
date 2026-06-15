'use client'

import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 gap-4">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground text-center max-w-xs">
        {error.digest ? `Error ${error.digest}` : 'An unexpected error occurred.'}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 border border-input rounded-md text-sm hover:bg-accent transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="px-4 py-2 border border-input rounded-md text-sm hover:bg-accent transition-colors"
        >
          Go home
        </Link>
      </div>
    </main>
  )
}
