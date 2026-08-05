/**
 * OAuth 2.0 Protected Resource Metadata — RFC 9728.
 *
 * This is the document an MCP client fetches after a 401 tells it where to
 * look (see the WWW-Authenticate challenge in lib/mcp-auth.ts). It names the
 * canonical resource identifier for /api/mcp and points at the authorization
 * server that issues tokens for it.
 *
 * The resource URL here MUST match the `resource` value clients send in their
 * authorization and token requests (RFC 8707), and the `aud` claim the AS puts
 * in the resulting token. If those three drift apart, audience validation
 * rejects every token.
 *
 * Authorization server: Supabase Auth's OAuth 2.1 server, whose issuer is
 * <project>.supabase.co/auth/v1 (its own metadata lives at
 * /.well-known/oauth-authorization-server/auth/v1).
 */

import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from 'mcp-handler'
import { authorizationServerIssuer, mcpResourceUrl } from '@/lib/mcp-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return protectedResourceHandler({
    authServerUrls: [authorizationServerIssuer()],
    resourceUrl: mcpResourceUrl(request),
  })(request)
}

// MCP clients running in a browser preflight this endpoint.
export const OPTIONS = metadataCorsOptionsRequestHandler()
