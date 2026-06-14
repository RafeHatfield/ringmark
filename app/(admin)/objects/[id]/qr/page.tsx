export default async function QrCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <main className="max-w-2xl mx-auto px-4 pt-6">
      <p className="text-sm text-muted-foreground">QR card for {id} — coming in Milestone 4.</p>
    </main>
  )
}
