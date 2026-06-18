export default function AdminLoading() {
  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16 animate-pulse">
      {/* Search bar skeleton */}
      <div className="h-10 bg-sand rounded-md mb-5" />

      {/* CTA buttons skeleton */}
      <div className="flex gap-3 mb-8">
        <div className="flex-1 h-10 bg-sand rounded-md" />
        <div className="flex-1 h-10 bg-sand rounded-md" />
      </div>

      {/* List skeleton */}
      <div className="h-4 w-16 bg-sand rounded mb-3" />
      <div className="border border-hairline rounded-md divide-y divide-hairline">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="px-4 py-3 flex items-center justify-between">
            <div className="h-4 w-20 bg-sand rounded" />
            <div className="h-3 w-16 bg-sand rounded" />
          </div>
        ))}
      </div>
    </main>
  )
}
