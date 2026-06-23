import { verifyApiKey } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MCP_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'ringmark', version: '0.3.0' }

type JsonRpcId = string | number | null
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

type ToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

const OBJECT_TYPE_DESCRIPTION =
  'source | log | chunk | slab | blank | rough_bowl | finished_bowl | pen_blank | spindle_blank | offcut | other'

const STATUS_DESCRIPTION =
  'unknown | acquired | stored | sealed | cut | drying | rough_turned | finished | for_sale | sold | gifted | scrapped'

const TOOLS: ToolDefinition[] = [
  {
    name: 'list_objects',
    description: 'List workshop objects, most recently updated first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Max results.' },
        object_type: { type: 'string', description: `Filter by type: ${OBJECT_TYPE_DESCRIPTION}` },
        status: { type: 'string', description: `Filter by status: ${STATUS_DESCRIPTION}` },
        published: { type: 'boolean', description: 'If set, filter by published state.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_objects',
    description: 'Search objects by title keyword, species, workshop ID, or public title.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_object',
    description: 'Get full details of a single object by workshop ID or UUID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workshop ID, such as RH1 or RH1-2, or UUID.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_object',
    description: 'Create a new root object. Workshop ID is auto-generated unless supplied.',
    inputSchema: {
      type: 'object',
      properties: {
        object_type: { type: 'string', default: 'source', description: `Type: ${OBJECT_TYPE_DESCRIPTION}` },
        workshop_id: { type: 'string', description: 'Optional workshop ID override, such as RH7.' },
        title: { type: 'string', description: 'Internal working title or description.' },
        species: { type: 'string', description: 'Wood species.' },
        status: { type: 'string', description: `Initial status: ${STATUS_DESCRIPTION}` },
        location_text: { type: 'string', description: 'Private source/location note.' },
        private_notes: { type: 'string', description: 'Private workshop notes.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'add_child',
    description: 'Create a child object derived from an existing piece, using flat descendant IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: 'Workshop ID or UUID of the parent object.' },
        object_type: { type: 'string', description: `Child type: ${OBJECT_TYPE_DESCRIPTION}` },
        title: { type: 'string', description: 'Internal working title or description.' },
        species: { type: 'string', description: 'Inherits from parent if omitted.' },
        status: { type: 'string', description: `Status: ${STATUS_DESCRIPTION}` },
        private_notes: { type: 'string', description: 'Private workshop notes.' },
      },
      required: ['parent_id', 'object_type'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'update_object',
    description: 'Update fields on an existing object. Only pass fields to change.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workshop ID or UUID.' },
        object_type: { type: 'string', description: `Type: ${OBJECT_TYPE_DESCRIPTION}` },
        status: { type: 'string', description: `Status: ${STATUS_DESCRIPTION}` },
        title: { type: 'string', description: 'Internal working title or description.' },
        species: { type: 'string', description: 'Wood species.' },
        dimensions_text: { type: 'string', description: 'Final or current dimensions, such as 8 in x 2.5 in.' },
        finish: { type: 'string', description: 'Applied finish.' },
        location_text: { type: 'string', description: 'Private source/location note.' },
        private_notes: { type: 'string', description: 'Private workshop notes.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'save_story',
    description: 'Set public story fields on an object. Does not publish by itself.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workshop ID or UUID.' },
        public_title: { type: 'string', description: 'Title shown on the public page.' },
        public_story: { type: 'string', description: 'Customer-facing narrative.' },
        public_notes: { type: 'string', description: 'Public notes such as species, dimensions, and finish.' },
        public_care: { type: 'string', description: 'Care instructions.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'publish_object',
    description: 'Publish or unpublish an object.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workshop ID or UUID.' },
        published: { type: 'boolean', default: true, description: 'true to publish, false to unpublish.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'MCP-Protocol-Version',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  }
}

function withCors(response: Response) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders() })
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function optionalInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

function requiredString(args: Record<string, unknown>, key: string) {
  const value = optionalString(args[key])
  if (!value) throw new Error(`Missing required argument: ${key}`)
  return value
}

function apiBase(request: Request) {
  const configured = process.env.RINGMARK_API_URL?.replace(/\/$/, '')
  return `${configured ?? new URL(request.url).origin}/api/v1`
}

async function ringmarkApi(
  request: Request,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const auth = request.headers.get('Authorization') ?? `Bearer ${process.env.RINGMARK_API_KEY ?? ''}`
  const response = await fetch(`${apiBase(request)}${endpoint}`, {
    method,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return null

  const json = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) {
    throw new Error(json?.error ?? `Ringmark API error ${response.status}`)
  }
  return json
}

function textContent(text: string, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

async function callTool(request: Request, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'list_objects': {
      const params = new URLSearchParams()
      params.set('limit', String(Math.min(Math.max(optionalInteger(args.limit, 20), 1), 50)))
      const objectType = optionalString(args.object_type)
      const status = optionalString(args.status)
      const published = optionalBoolean(args.published)
      if (objectType) params.set('type', objectType)
      if (status) params.set('status', status)
      if (published !== undefined) params.set('published', String(published))
      const data = await ringmarkApi(request, 'GET', `/objects?${params}`)
      return textContent(JSON.stringify(data, null, 2))
    }
    case 'search_objects': {
      const query = requiredString(args, 'query')
      const data = await ringmarkApi(request, 'GET', `/objects?q=${encodeURIComponent(query)}`)
      return textContent(JSON.stringify(data, null, 2))
    }
    case 'get_object': {
      const id = requiredString(args, 'id')
      const data = await ringmarkApi(request, 'GET', `/objects/${encodeURIComponent(id)}`)
      return textContent(JSON.stringify(data, null, 2))
    }
    case 'create_object': {
      const body: Record<string, unknown> = { object_type: optionalString(args.object_type) ?? 'source' }
      for (const key of ['workshop_id', 'title', 'species', 'status', 'location_text', 'private_notes']) {
        const value = optionalString(args[key])
        if (value !== undefined) body[key] = value
      }
      const created = await ringmarkApi(request, 'POST', '/objects', body) as Record<string, JsonValue>
      return textContent(
        `Created: ${created.workshop_id} (${created.id})\nPublic URL once published: /p/${created.public_slug}`
      )
    }
    case 'add_child': {
      const parentId = requiredString(args, 'parent_id')
      const body: Record<string, unknown> = { object_type: requiredString(args, 'object_type') }
      for (const key of ['title', 'species', 'status', 'private_notes']) {
        const value = optionalString(args[key])
        if (value !== undefined) body[key] = value
      }
      const created = await ringmarkApi(request, 'POST', `/objects/${encodeURIComponent(parentId)}/children`, body) as Record<string, JsonValue>
      return textContent(`Created child: ${created.workshop_id} (parent: ${parentId})\nID: ${created.id}`)
    }
    case 'update_object': {
      const id = requiredString(args, 'id')
      const body: Record<string, unknown> = {}
      for (const key of [
        'object_type',
        'status',
        'title',
        'species',
        'dimensions_text',
        'finish',
        'location_text',
        'private_notes',
      ]) {
        const value = optionalString(args[key])
        if (value !== undefined) body[key] = value
      }
      const updated = await ringmarkApi(request, 'PATCH', `/objects/${encodeURIComponent(id)}`, body) as Record<string, JsonValue>
      return textContent(`Updated ${updated.workshop_id} (${updated.id})`)
    }
    case 'save_story': {
      const id = requiredString(args, 'id')
      const body: Record<string, unknown> = {}
      for (const key of ['public_title', 'public_story', 'public_notes', 'public_care']) {
        const value = optionalString(args[key])
        if (value !== undefined) body[key] = value
      }
      const updated = await ringmarkApi(request, 'PATCH', `/objects/${encodeURIComponent(id)}`, body) as Record<string, JsonValue>
      return textContent(`Story saved for ${updated.workshop_id}. Public URL once published: /p/${updated.public_slug}`)
    }
    case 'publish_object': {
      const id = requiredString(args, 'id')
      const published = optionalBoolean(args.published) ?? true
      const updated = await ringmarkApi(request, 'PATCH', `/objects/${encodeURIComponent(id)}`, {
        is_published: published,
      }) as Record<string, JsonValue>
      return textContent(
        published
          ? `Published ${updated.workshop_id}. Public URL: /p/${updated.public_slug}`
          : `Unpublished ${updated.workshop_id}.`
      )
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

async function handleRpcMessage(request: Request, message: JsonRpcRequest) {
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id ?? null : undefined
  const method = message.method

  if (message.jsonrpc !== '2.0' || !method) {
    return id === undefined ? null : rpcError(id, -32600, 'Invalid Request')
  }

  if (id === undefined) {
    return null
  }

  try {
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      case 'ping':
        return rpcResult(id, {})
      case 'tools/list':
        return rpcResult(id, { tools: TOOLS })
      case 'tools/call': {
        const params = asObject(message.params)
        const name = requiredString(params, 'name')
        const args = asObject(params.arguments)
        return rpcResult(id, await callTool(request, name, args))
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`)
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    if (method === 'tools/call') {
      return rpcResult(id, textContent(messageText, true))
    }
    return rpcError(id, -32000, messageText)
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

export async function GET() {
  return jsonResponse(rpcError(null, -32000, 'Ringmark MCP is stateless; send JSON-RPC requests with POST.'), 405)
}

export async function POST(request: Request) {
  const authError = verifyApiKey(request)
  if (authError) return withCors(authError)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'), 400)
  }

  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((item) => handleRpcMessage(request, asObject(item))))).filter(Boolean)
    return responses.length ? jsonResponse(responses) : new Response(null, { status: 202, headers: corsHeaders() })
  }

  const response = await handleRpcMessage(request, asObject(body))
  return response ? jsonResponse(response) : new Response(null, { status: 202, headers: corsHeaders() })
}
