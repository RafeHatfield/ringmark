import Link from 'next/link'

export default function ObjectNotFound() {
  return (
    <main className="max-w-2xl mx-auto px-4 pt-16 pb-16 text-center">
      <p className="text-4xl font-mono font-bold text-bark mb-4">—</p>
      <h1 className="text-lg font-semibold mb-2">Object not found</h1>
      <p className="text-sm text-bark mb-6">
        This piece may have been deleted or the link is incorrect.
      </p>
      <Link href="/" className="text-sm underline hover:text-bark">
        Back to workshop
      </Link>
    </main>
  )
}
