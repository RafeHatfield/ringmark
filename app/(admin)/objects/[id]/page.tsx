export default async function ObjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <main className="max-w-2xl mx-auto px-4 pt-6">
      <p className="text-sm text-muted-foreground">Object {id} — coming in Milestone 1.</p>
    </main>
  )
}
