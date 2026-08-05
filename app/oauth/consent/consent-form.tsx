'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { approveAuthorization, denyAuthorization } from '@/actions/oauth'

export function ConsentForm({ authorizationId }: { authorizationId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function decide(decision: 'approve' | 'deny') {
    setError('')
    startTransition(async () => {
      const action = decision === 'approve' ? approveAuthorization : denyAuthorization
      // On success the action redirects, so anything returned here is a failure.
      const result = await action(authorizationId)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          type="button"
          onClick={() => decide('approve')}
          disabled={pending}
          className="flex-1"
        >
          {pending ? 'Working…' : 'Allow access'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => decide('deny')}
          disabled={pending}
          className="flex-1"
        >
          Deny
        </Button>
      </div>
    </div>
  )
}
