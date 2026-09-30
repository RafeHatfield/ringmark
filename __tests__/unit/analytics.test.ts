import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { analyticsPath } from '../../lib/analytics.ts'

describe('analyticsPath', () => {
  it('redacts invite tokens', () => {
    assert.equal(analyticsPath('/invite/abc123def'), '/invite/[token]')
    assert.equal(analyticsPath('/invite/abc123def/accept'), '/invite/[token]/accept')
  })

  it('leaves other paths, admin included, untouched', () => {
    for (const p of ['/', '/workshop', '/objects/0d27e5e2-d793-4578-9ce0-b9c463780a03/edit', '/p/AgX9', '/oauth/consent', '/settings']) {
      assert.equal(analyticsPath(p), p)
    }
  })

  it('does not redact paths that merely contain "invite"', () => {
    assert.equal(analyticsPath('/settings/invite/x'), '/settings/invite/x')
  })
})
