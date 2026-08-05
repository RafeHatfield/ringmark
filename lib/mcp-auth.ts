/**
 * Auth helpers shared by the remote MCP endpoint and its metadata routes.
 *
 * The piece that matters for spec compliance is the WWW-Authenticate header on
 * 401s. RFC 9728 §5.1 is how an MCP client discovers which authorization
 * server to talk to: it gets a 401, reads `resource_metadata` out of the
 * challenge, fetches that document, and finds the AS from there. A bare 401
 * gives the client nowhere to go, so the OAuth flow can never start.
 */

import { getPublicOrigin } from 'mcp-handler'

/** Canonical path of this resource server's RFC 9728 metadata document. */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource'

/** Canonical resource identifier — the URL tokens must be audience-bound to. */
export const MCP_RESOURCE_PATH = '/api/mcp'

/**
 * Origin to advertise. Prefers the configured public URL so the value stays
 * stable behind Vercel's proxy, falling back to proxy-header detection.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  return getPublicOrigin(request)
}

export function protectedResourceUrl(request: Request): string {
  return `${publicOrigin(request)}${PROTECTED_RESOURCE_PATH}`
}

export function mcpResourceUrl(request: Request): string {
  return `${publicOrigin(request)}${MCP_RESOURCE_PATH}`
}

/**
 * 401 with the RFC 9728 discovery challenge attached.
 *
 * Body stays JSON-RPC shaped (-32001) so existing MCP clients and the endpoint
 * tests keep parsing it, while the header carries the OAuth discovery hint.
 */
export function unauthorized(request: Request, description = 'Unauthorized'): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: description } }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate':
          `Bearer realm="ringmark", ` +
          `error="invalid_token", ` +
          `error_description="${description}", ` +
          `resource_metadata="${protectedResourceUrl(request)}"`,
      },
    }
  )
}
