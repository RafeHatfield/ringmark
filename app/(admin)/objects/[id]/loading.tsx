export default function ObjectDetailLoading() {
  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16 animate-pulse">
      {/* Nav */}
      <div className="flex items-center justify-between mb-5">
        <div className="h-4 w-12 bg-muted rounded" />
        <div className="h-8 w-14 bg-muted rounded-md" />
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="h-9 w-24 bg-muted rounded mb-2" />
        <div className="h-4 w-40 bg-muted rounded mb-3" />
        <div className="flex gap-2">
          <div className="h-6 w-16 bg-muted rounded-full" />
          <div className="h-6 w-20 bg-muted rounded-full" />
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 mb-8">
        <div className="h-8 w-24 bg-muted rounded-md" />
        <div className="h-8 w-24 bg-muted rounded-md" />
        <div className="h-8 w-20 bg-muted rounded-md" />
      </div>

      {/* Photos section */}
      <div className="mb-6">
        <div className="h-3 w-14 bg-muted rounded mb-3" />
        <div className="grid grid-cols-2 gap-2">
          <div className="aspect-square bg-muted rounded-md" />
          <div className="aspect-square bg-muted rounded-md" />
        </div>
      </div>

      {/* Details section */}
      <div className="mb-6">
        <div className="h-3 w-14 bg-muted rounded mb-3" />
        <div className="border rounded-md divide-y divide-border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 flex justify-between">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-4 w-24 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
