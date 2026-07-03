export default function PublicStoryLoading() {
  return (
    <div className="min-h-screen bg-paper text-ink font-sans">
      <main className="max-w-[480px] mx-auto px-[22px] pb-8 animate-pulse">
        {/* Eyebrow */}
        <div className="pt-[30px] pb-[18px] flex justify-center">
          <div className="h-3 w-32 bg-sand rounded" />
        </div>

        {/* Hero */}
        <div className="aspect-[4/3] rounded-[14px] bg-sand" />

        {/* Title */}
        <div className="mt-6 mb-[6px]">
          <div className="h-7 w-3/4 bg-sand rounded mb-2" />
          <div className="h-3 w-24 bg-sand rounded" />
        </div>
      </main>
    </div>
  )
}
