import Link from 'next/link'
import type { RootSummary } from '@/lib/tree-rollup'

export function RootCard({ summary }: { summary: RootSummary }) {
  const { root, descendantCount, leafStatuses } = summary
  const pieceCount = descendantCount + 1

  // Status chips: skip null/unknown, take first 3, format as "{count} {status label}"
  const chips = leafStatuses
    .filter((s) => s.status !== null && s.status !== 'unknown')
    .slice(0, 3)
    .map((s) => `${s.count} ${s.status!.replace(/_/g, ' ')}`)

  const statusText = chips.length > 0 ? ' · ' + chips.join(' · ') : ''

  const subtitle = root.title ?? root.species

  return (
    <Link
      href={`/objects/${root.id}`}
      className="flex items-center justify-between py-3 hover:opacity-70 transition-opacity gap-3"
    >
      <div>
        <div>
          <span className="font-mono text-sm font-medium">{root.workshop_id}</span>
          {subtitle && (
            <span className="text-xs text-bark ml-2">{subtitle}</span>
          )}
        </div>
        <span className="text-xs text-bark block mt-0.5">
          {pieceCount} pieces{statusText}
        </span>
      </div>
      <span className="text-xs text-bark shrink-0">→</span>
    </Link>
  )
}
