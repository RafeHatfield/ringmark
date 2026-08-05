/**
 * MCP ↔ REST API contract drift.
 *
 * The MCP tools are a thin proxy over the REST API: every tool handler calls
 * api()/apiUpload() with a method and path. Nothing links those strings to the
 * routes they target, so renaming or removing an endpoint leaves the tool
 * compiling happily and failing at runtime — in a chat session, where the
 * failure surfaces as a confusing error rather than a build break.
 *
 * This test parses those call sites out of mcp/server.ts and asserts each
 * method+path pair exists in the generated OpenAPI document. lib/api-spec.ts is
 * the single source of truth for the API surface, so if a route changes without
 * the spec being updated, that is caught by the spec's own tests; if the spec
 * changes without the tools following, it is caught here.
 *
 * Paths are compared with parameters collapsed to `*`, since the tool source
 * interpolates values while the spec uses named placeholders.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// api-schemas must be imported first: it calls extendZodWithOpenApi(z) as a
// module side effect, and api-spec.ts's own z.string().openapi() calls depend
// on it having run. Under Next.js the import graph guarantees the order; under
// the bare test runner it does not, so make it explicit.
import '../../lib/api-schemas.ts'
import { generateSpec } from '../../lib/api-spec.ts'

const serverSrc = readFileSync(resolve('./mcp/server.ts'), 'utf8')

/**
 * Collapses a path to its shape: parameters become `*`, query strings go away.
 *
 * `${qs}` and `${params}` are query-string builders in the tool source, not
 * path segments, so they are dropped rather than turned into wildcards.
 */
function canonicalise(path: string): string {
  return path
    .replace(/\?.*$/, '')
    .replace(/\$\{(qs|params)\}/g, '')
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/\{[^}]*\}/g, '*')
    .replace(/\*+/g, '*')
    .replace(/\/+$/, '')
}

/** Every method+path the MCP tools actually call. */
function toolCallSites(): Array<{ method: string; path: string; raw: string }> {
  const sites: Array<{ method: string; path: string; raw: string }> = []

  // api('GET', `/objects/${id}`) — or with a single-quoted literal path
  const apiCall = /\bapi\(\s*'(GET|POST|PATCH|DELETE)'\s*,\s*(`[^`]*`|'[^']*')/g
  for (const m of serverSrc.matchAll(apiCall)) {
    const raw = m[2].slice(1, -1)
    sites.push({ method: m[1], path: canonicalise(raw), raw })
  }

  // apiUpload(`/objects/${id}/photos`, form) — always multipart POST
  const uploadCall = /\bapiUpload\(\s*(`[^`]*`|'[^']*')/g
  for (const m of serverSrc.matchAll(uploadCall)) {
    const raw = m[1].slice(1, -1)
    sites.push({ method: 'POST', path: canonicalise(raw), raw })
  }

  return sites
}

/** Every method+path the OpenAPI spec declares, minus the /api/v1 prefix. */
function specOperations(): Set<string> {
  const spec = generateSpec() as { paths?: Record<string, Record<string, unknown>> }
  const ops = new Set<string>()
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(methods)) {
      const withoutPrefix = path.replace(/^\/api\/v1/, '')
      ops.add(`${method.toUpperCase()} ${canonicalise(withoutPrefix)}`)
    }
  }
  return ops
}

describe('MCP tools ↔ REST API contract', () => {
  it('finds the tool call sites at all (guards the parser itself)', () => {
    const sites = toolCallSites()
    // If a refactor changes how tools call the API, this test must fail loudly
    // rather than silently verifying nothing.
    assert.ok(
      sites.length >= 12,
      `expected to parse at least 12 API call sites from mcp/server.ts, found ${sites.length}`,
    )
  })

  it('every endpoint an MCP tool calls exists in the OpenAPI spec', () => {
    const ops = specOperations()
    const missing: string[] = []

    for (const site of toolCallSites()) {
      const key = `${site.method} ${site.path}`
      if (!ops.has(key)) missing.push(`${key}   (source: ${site.raw})`)
    }

    assert.deepEqual(
      missing,
      [],
      `MCP tools call endpoints the API spec does not declare:\n  ${missing.join('\n  ')}\n\n` +
      `Spec declares:\n  ${[...ops].sort().join('\n  ')}`,
    )
  })

  it('the photo restore endpoint is wired end to end', () => {
    // Explicit because it is the newest route and the one a soft delete is
    // useless without.
    const ops = specOperations()
    assert.ok(
      ops.has('POST /objects/*/photos/*/restore'),
      'spec is missing POST /objects/{id}/photos/{photoId}/restore',
    )
    assert.ok(
      toolCallSites().some(s => s.method === 'POST' && s.path === '/objects/*/photos/*/restore'),
      'no MCP tool calls the restore endpoint',
    )
  })
})
