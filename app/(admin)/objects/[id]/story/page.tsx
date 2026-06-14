export default async function EditStoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <main className="max-w-2xl mx-auto px-4 pt-6">
      <p className="text-sm text-muted-foreground">Edit public story for {id} — coming in Milestone 4.</p>
    </main>
  )
}
