'use client'

import { useState, useTransition } from 'react'
import { updateStatus } from '@/actions/objects'
import { OBJECT_STATUSES } from '@/lib/constants'
import type { ObjectStatus } from '@/lib/types'

export function StatusChanger({
  objectId,
  status,
}: {
  objectId: string
  status: ObjectStatus | null
}) {
  const [isPending, startTransition] = useTransition()
  const [optimistic, setOptimistic] = useState(status)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = (e.target.value as ObjectStatus) || null
    setOptimistic(val)
    startTransition(async () => {
      await updateStatus(objectId, val)
    })
  }

  return (
    <select
      value={optimistic ?? ''}
      onChange={handleChange}
      disabled={isPending}
      className="text-xs border border-input rounded-full px-2 py-0.5 bg-secondary text-secondary-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    >
      <option value="">No status</option>
      {OBJECT_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  )
}
