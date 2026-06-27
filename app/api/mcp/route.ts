/**
 * Remote MCP endpoint for Ringmark.
 *
 * Implements MCP JSON-RPC 2.0 over HTTP (Streamable HTTP transport, stateless
 * mode) using the existing in-process server factory. Compatible with
 * claude.ai Remote MCP and any standard MCP client.
 *
 * Authentication: Authorization: Bearer <MCP_SECRET>
 *
 * To add in claude.ai → Settings → Integrations → Add MCP server:
 *   URL:  https://ringmark.org/api/mcp
 *   Auth: Bearer <value of MCP_SECRET env var>
 *
 * Environment variables required (set in Vercel dashboard):
 *   MCP_SECRET          — shared secret for this endpoint (generate a random hex string)
 *   RINGMARK_API_KEY    — already set
 *   RINGMARK_API_URL    — already set
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createServer } from '@/mcp/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const SERVER_INFO = { name: 'ringmark', version: '0.2.0' } as const

function verifySecret(request: Request): boolean {
  const secret = process.env.MCP_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

function jsonRpcOk(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcErr(id: unknown, code: number, message: string, status = 200): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const apiKey = process.env.RINGMARK_API_KEY ?? ''
  const apiBase =
    (process.env.RINGMARK_API_URL ?? 'https://ringmark.org').replace(/\/$/, '') + '/api/v1'

  // 55s timeout — stays under Vercel's 60s function limit
  const mcpServer = createServer(apiKey, apiBase, 55_000, { hosted: true })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'ringmark-http-proxy', version: '1.0.0' })

  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)])
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

// ── POST — all MCP messages ───────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return jsonRpcErr(null, -32001, 'Unauthorized', 401)
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonRpcErr(null, -32700, 'Parse error', 400)
  }

  const { id = null, method, params } = body

  try {
    switch (method) {
      // ── Lifecycle ───────────────────────────────────────────────────────────
      case 'initialize':
        return jsonRpcOk(id, {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })

      case 'notifications/initialized':
        // Client acknowledges init — no response body required
        return new Response(null, { status: 202 })

      case 'ping':
        return jsonRpcOk(id, {})

      // ── Tool discovery ──────────────────────────────────────────────────────
      case 'tools/list': {
        const result = await withClient(c => c.listTools())
        return jsonRpcOk(id, result)
      }

      // ── Tool execution ──────────────────────────────────────────────────────
      case 'tools/call': {
        const p = params as { name: string; arguments?: Record<string, unknown> }
        const result = await withClient(c =>
          c.callTool({ name: p.name, arguments: p.arguments ?? {} })
        )
        return jsonRpcOk(id, result)
      }

      default:
        return jsonRpcErr(id, -32601, `Method not found: ${method}`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonRpcErr(id, -32603, message)
  }
}

// ── GET — health check / method hint ─────────────────────────────────────────

export async function GET() {
  return Response.json({
    service: 'Ringmark MCP',
    version: SERVER_INFO.version,
    protocol: LATEST_PROTOCOL_VERSION,
    usage: 'POST with Authorization: Bearer <MCP_SECRET> and a JSON-RPC 2.0 body',
  })
}
