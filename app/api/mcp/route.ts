/**
 * Remote MCP endpoint for Ringmark.
 *
 * Streamable HTTP via mcp-handler (MCP SDK v2). Compatible with claude.ai
 * Remote MCP and any standard MCP client.
 *
 * Authentication: Authorization: Bearer <account API key>
 *   Generate a key at Settings → API Keys. The same key authenticates both
 *   this endpoint and the underlying REST API calls it makes. OAuth 2.1 is
 *   the next auth mode to land here; the key path stays for scripts and CI.
 *
 * Tool surface: same tools as the local stdio server, with one difference —
 *   tools are registered without allowForceDelete, so delete_object has no
 *   `force` parameter here. Combined with the API's existing guards, the only
 *   object this endpoint can delete is an unpublished leaf. delete_photo is a
 *   soft delete and is reversible via restore_photo.
 *
 * The handler is built per request because the API key it proxies with comes
 * from that request's Authorization header. Construction is pure object
 * allocation — no I/O — so this is cheap, and it replaces the previous
 * approach of standing up a linked client/server transport pair per call.
 *
 * To add in claude.ai → Settings → Connectors → Add custom connector:
 *   URL:  https://ringmark.org/api/mcp
 *   Auth: Bearer <your account API key from Settings → API Keys>
 *
 * For local Claude Code / Desktop (mcp/index.ts stdio entry point):
 *   Set RINGMARK_API_KEY in .env.local to your account API key.
 */

import { createMcpHandler } from 'mcp-handler'
import { registerTools, SERVER_INFO } from '@/mcp/server'
import { createServiceClient } from '@/lib/supabase/service'
import { authenticateApiRequest } from '@/lib/api-auth'
import { PROTECTED_RESOURCE_PATH, unauthorized } from '@/lib/mcp-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

function apiBase(): string {
  return (process.env.RINGMARK_API_URL ?? 'https://ringmark.org').replace(/\/$/, '') + '/api/v1'
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return unauthorized(request)

  const apiKey = authHeader.slice('Bearer '.length).trim()
  if (!apiKey) return unauthorized(request)

  const db = createServiceClient()
  const { error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return unauthorized(request)

  const handler = createMcpHandler(
    // 55s tool timeout — stays under Vercel's 60s function limit
    server => registerTools(server, apiKey, apiBase(), 55_000, { hosted: true }),
    { serverInfo: SERVER_INFO },
  )

  return handler(request)
}

/** Streamable HTTP clients may open a GET stream; same auth applies. */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    // Unauthenticated GET is treated as a health check rather than an error, so
    // `curl https://ringmark.org/api/mcp` still tells you what this endpoint is.
    return Response.json({
      service: 'Ringmark MCP',
      version: SERVER_INFO.version,
      transport: 'streamable-http',
      usage: 'POST with Authorization: Bearer <account API key> and a JSON-RPC 2.0 body',
      keysUrl: '/settings',
      resourceMetadata: PROTECTED_RESOURCE_PATH,
    })
  }

  const apiKey = authHeader.slice('Bearer '.length).trim()
  if (!apiKey) return unauthorized(request)

  const db = createServiceClient()
  const { error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) return unauthorized(request)

  const handler = createMcpHandler(
    server => registerTools(server, apiKey, apiBase(), 55_000, { hosted: true }),
    { serverInfo: SERVER_INFO },
  )

  return handler(request)
}
