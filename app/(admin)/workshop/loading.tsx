export default function WorkshopLoading() {
  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-16 animate-pulse">
      {/* Search bar */}
      <div className="mb-5">
        <div className="h-10 w-full bg-sand rounded-md" />
      </div>

      {/* Add button */}
      <div className="mb-8">
        <div className="h-10 w-24 bg-sand rounded-md" />
      </div>

      {/* Root card rows */}
      <div className="divide-y divide-hairline">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between py-3 gap-3">
            <div>
              <div className="h-4 w-20 bg-sand rounded mb-2" />
              <div className="h-3 w-28 bg-sand rounded" />
            </div>
            <div className="h-3 w-3 bg-sand rounded" />
          </div>
        ))}
      </div>
    </main>
  )
}
