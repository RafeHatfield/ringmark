'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteObject } from '@/actions/objects'

export function DeleteObjectButton({ objectId }: { objectId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteObject(objectId)
      if (result.error) {
        setConfirming(false)
        return
      }
      router.push('/')
    })
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={handleConfirm}
          disabled={isPending}
          className="px-4 py-2.5 bg-destructive text-destructive-foreground rounded-md text-sm font-medium disabled:opacity-50 transition-opacity"
        >
          {isPending ? 'Deleting…' : 'Yes, delete permanently'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="px-4 py-2.5 border border-destructive/40 text-destructive rounded-md text-sm font-medium hover:bg-destructive hover:text-destructive-foreground transition-colors"
    >
      Delete object
    </button>
  )
}
