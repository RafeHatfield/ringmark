'use client'

import { useState } from 'react'
import { createApiKey, revokeApiKey } from '@/actions/api-keys'
import type { ApiKey } from '@/lib/types'

type KeyRow = Pick<ApiKey, 'id' | 'key_prefix' | 'label' | 'created_at' | 'last_used_at'>

export function ApiKeyManager({ keys }: { keys: KeyRow[] }) {
  const [mode, setMode]           = useState<'list' | 'creating' | 'showing'>('list')
  const [label, setLabel]         = useState('')
  const [revealedKey, setRevealed] = useState('')
  const [copied, setCopied]       = useState(false)
  const [creating, setCreating]   = useState(false)
  const [revokeId, setRevokeId]   = useState<string | null>(null)
  const [error, setError]         = useState('')

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreating(true)
    setError('')

    const result = await createApiKey(label.trim())
    setCreating(false)

    if ('error' in result) { setError(result.error); return }

    setRevealed(result.rawKey)
    setLabel('')
    setMode('showing')
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(revealedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  function handleDone() {
    setRevealed('')
    setCopied(false)
    setMode('list')
  }

  async function handleRevoke(keyId: string) {
    setError('')
    const result = await revokeApiKey(keyId)
    if (result.error) setError(result.error)
    setRevokeId(null)
  }

  // ── Show-once reveal state ────────────────────────────────────────────────
  if (mode === 'showing') {
    return (
      <div className="border border-cedar/30 rounded-md p-4 space-y-3 bg-cedar/5">
        <p className="text-sm font-medium">Copy your key — it won&rsquo;t be shown again.</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-xs bg-paper border border-hairline rounded px-3 py-2 break-all select-all">
            {revealedKey}
          </code>
          <button
            onClick={handleCopy}
            className="shrink-0 px-3 py-1.5 border border-hairline rounded-md text-xs hover:bg-sand transition-colors"
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <button
          onClick={handleDone}
          className="text-xs text-bark hover:text-ink transition-colors"
        >
          Done, I&rsquo;ve saved it
        </button>
      </div>
    )
  }

  // ── Create form ───────────────────────────────────────────────────────────
  if (mode === 'creating') {
    return (
      <form onSubmit={handleCreate} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="key-label" className="block text-sm">
            Label <span className="text-bark text-xs">(required — e.g. &ldquo;claude.ai MCP&rdquo;, &ldquo;local dev&rdquo;)</span>
          </label>
          <input
            id="key-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What's this key for?"
            required
            autoFocus
            className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={creating || !label.trim()}
            className="px-3 py-1.5 bg-cedar text-paper rounded-md text-sm hover:bg-heartwood disabled:opacity-50 transition-colors"
          >
            {creating ? 'Generating…' : 'Generate key'}
          </button>
          <button
            type="button"
            onClick={() => { setMode('list'); setLabel(''); setError('') }}
            className="px-3 py-1.5 border border-hairline rounded-md text-sm hover:bg-sand transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  // ── Key list ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {keys.length > 0 && (
        <div className="border border-hairline rounded-md divide-y divide-hairline">
          {keys.map((k) => (
            <div key={k.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm">{k.key_prefix}…</p>
                <p className="text-xs text-bark mt-0.5 truncate">
                  {k.label ?? 'Unlabelled'}
                  {' · '}
                  Created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && (
                    <> · Last used {new Date(k.last_used_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <div className="shrink-0">
                {revokeId === k.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-bark">Revoke?</span>
                    <button
                      onClick={() => handleRevoke(k.id)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setRevokeId(null)}
                      className="text-xs text-bark hover:text-ink"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRevokeId(k.id)}
                    className="px-2.5 py-1 text-xs text-bark border border-hairline rounded hover:bg-sand hover:text-ink transition-colors"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        onClick={() => setMode('creating')}
        className="px-3 py-1.5 border border-hairline rounded-md text-sm hover:bg-sand transition-colors"
      >
        Generate new key
      </button>
    </div>
  )
}
