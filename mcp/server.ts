import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/**
 * Builds and returns the configured McpServer with all tools registered.
 * Separated from the transport startup in index.ts so tests can import it
 * without triggering stdio or process.exit.
 */
export function createServer(apiKey: string, apiBase: string, timeoutMs = 30_000): McpServer {

  // ── API client ────────────────────────────────────────────────────────────

  async function api(method: string, endpoint: string, body?: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(`${apiBase}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(msg.includes('abort') ? `Request timed out: ${method} ${endpoint}` : msg)
    } finally {
      clearTimeout(timeout)
    }

    if (res.status === 204) return null

    // Guard against HTML error pages (wrong URL, auth redirect, Next.js 404, etc.)
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      const preview = (await res.text()).slice(0, 200)
      throw new Error(`API returned non-JSON (HTTP ${res.status}): ${preview}`)
    }

    const json = await res.json() as { error?: string }
    if (!res.ok) throw new Error(json?.error ?? `API error ${res.status}`)
    return json
  }

  // ── Server ────────────────────────────────────────────────────────────────

  const server = new McpServer({ name: 'ringmark', version: '0.2.0' })

  // ── list_objects ──────────────────────────────────────────────────────────

  server.tool(
    'list_objects',
    'List workshop objects, most recently updated first.',
    {
      limit: z.number().int().min(1).max(50).default(20).describe('Max results (default 20)'),
      object_type: z.string().optional().describe(
        'Filter by type: source | log | chunk | slab | blank | rough_bowl | ' +
        'finished_bowl | pen_blank | spindle_blank | offcut | other'
      ),
      status: z.string().optional().describe(
        'Filter by status: acquired | stored | sealed | cut | drying | ' +
        'rough_turned | finished | for_sale | sold | gifted | scrapped'
      ),
      published: z.boolean().optional().describe('If true, return only published objects'),
    },
    async ({ limit, object_type, status, published }) => {
      const params = new URLSearchParams()
      params.set('limit', String(limit ?? 20))
      if (object_type) params.set('type', object_type)
      if (status) params.set('status', status)
      if (published !== undefined) params.set('published', String(published))
      const data = await api('GET', `/objects?${params}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ── get_object ────────────────────────────────────────────────────────────

  server.tool(
    'get_object',
    'Get full details of a single object by its workshop ID (e.g. "RH1") or UUID.',
    { id: z.string().describe('Workshop ID (e.g. RH1, RH1-2) or UUID') },
    async ({ id }) => {
      try {
        const data = await api('GET', `/objects/${encodeURIComponent(id)}`)
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('not found')) {
          return { content: [{ type: 'text' as const, text: `No object found: ${id}` }] }
        }
        throw err
      }
    }
  )

  // ── search_objects ────────────────────────────────────────────────────────

  server.tool(
    'search_objects',
    'Search objects by title keyword, species, workshop ID, or public title.',
    { query: z.string().describe('Search term') },
    async ({ query }) => {
      const data = await api('GET', `/objects?q=${encodeURIComponent(query.trim())}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ── create_object ─────────────────────────────────────────────────────────

  server.tool(
    'create_object',
    'Create a new root object (source tree, found wood, etc.). Workshop ID is auto-generated unless you specify one.',
    {
      object_type: z.string().default('source').describe(
        'Type: source | log | chunk | slab | blank | rough_bowl | finished_bowl | ' +
        'pen_blank | spindle_blank | offcut | other'
      ),
      workshop_id: z.string().optional().describe(
        'Override the auto-generated workshop ID (e.g. RH7). Omit to auto-assign.'
      ),
      title: z.string().optional().describe('Internal working title / description'),
      species: z.string().optional().describe('Wood species (e.g. Bigleaf Maple, Red Cedar Burl)'),
      status: z.string().optional().describe('Initial status (default: acquired)'),
      location_text: z.string().optional().describe('Where the wood came from — stays private'),
      private_notes: z.string().optional().describe('Private workshop notes'),
    },
    async ({ object_type, workshop_id, title, species, status, location_text, private_notes }) => {
      const body: Record<string, unknown> = { object_type }
      if (workshop_id) body.workshop_id = workshop_id
      if (title) body.title = title
      if (species) body.species = species
      if (status) body.status = status
      if (location_text) body.location_text = location_text
      if (private_notes) body.private_notes = private_notes

      const created = await api('POST', '/objects', body) as { workshop_id: string; id: string; public_slug: string }
      return {
        content: [{
          type: 'text' as const,
          text: `Created: ${created.workshop_id} (${created.id})\nPublic URL once published: /p/${created.public_slug}`,
        }],
      }
    }
  )

  // ── add_child ─────────────────────────────────────────────────────────────

  server.tool(
    'add_child',
    'Create a child object derived from an existing piece (e.g. a bowl blank from a log). ' +
    'Child workshop ID is auto-generated using flat descendant numbering (e.g. RH1 → RH1-1).',
    {
      parent_id: z.string().describe('Workshop ID or UUID of the parent object'),
      object_type: z.string().describe(
        'Type of the new child: log | chunk | slab | blank | rough_bowl | finished_bowl | etc.'
      ),
      title: z.string().optional(),
      species: z.string().optional().describe('Inherits from parent if omitted'),
      status: z.string().optional(),
      private_notes: z.string().optional(),
    },
    async ({ parent_id, object_type, title, species, status, private_notes }) => {
      const body: Record<string, unknown> = { object_type }
      if (title) body.title = title
      if (species) body.species = species
      if (status) body.status = status
      if (private_notes) body.private_notes = private_notes

      const created = await api('POST', `/objects/${encodeURIComponent(parent_id)}/children`, body) as {
        workshop_id: string; id: string
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Created child: ${created.workshop_id} (parent: ${parent_id})\nID: ${created.id}`,
        }],
      }
    }
  )

  // ── update_object ─────────────────────────────────────────────────────────

  server.tool(
    'update_object',
    'Update fields on an existing object. Only pass fields you want to change.',
    {
      id: z.string().describe('Workshop ID or UUID'),
      object_type: z.string().optional(),
      status: z.string().optional(),
      title: z.string().optional(),
      species: z.string().optional(),
      location_text: z.string().optional(),
      private_notes: z.string().optional(),
    },
    async ({ id, object_type, status, title, species, location_text, private_notes }) => {
      const body: Record<string, unknown> = {}
      if (object_type !== undefined) body.object_type = object_type
      if (status !== undefined) body.status = status
      if (title !== undefined) body.title = title
      if (species !== undefined) body.species = species
      if (location_text !== undefined) body.location_text = location_text
      if (private_notes !== undefined) body.private_notes = private_notes

      const updated = await api('PATCH', `/objects/${encodeURIComponent(id)}`, body) as {
        workshop_id: string; id: string
      }
      return {
        content: [{ type: 'text' as const, text: `Updated ${updated.workshop_id} (${updated.id})` }],
      }
    }
  )

  // ── save_story ────────────────────────────────────────────────────────────

  server.tool(
    'save_story',
    'Set the public story fields on an object (title, narrative, notes, care instructions). ' +
    'Does not publish — call publish_object separately.',
    {
      id: z.string().describe('Workshop ID or UUID'),
      public_title: z.string().optional().describe('Title shown on the public page'),
      public_story: z.string().optional().describe(
        'The narrative — where the wood came from, what it became'
      ),
      public_notes: z.string().optional().describe(
        'Species, dimensions, finish — anything buyers should know'
      ),
      public_care: z.string().optional().describe('Care instructions'),
    },
    async ({ id, public_title, public_story, public_notes, public_care }) => {
      const body: Record<string, unknown> = {}
      if (public_title !== undefined) body.public_title = public_title
      if (public_story !== undefined) body.public_story = public_story
      if (public_notes !== undefined) body.public_notes = public_notes
      if (public_care !== undefined) body.public_care = public_care

      const updated = await api('PATCH', `/objects/${encodeURIComponent(id)}`, body) as {
        workshop_id: string; public_slug: string
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Story saved for ${updated.workshop_id}. Public URL once published: /p/${updated.public_slug}`,
        }],
      }
    }
  )

  // ── publish_object ────────────────────────────────────────────────────────

  server.tool(
    'publish_object',
    'Publish or unpublish an object. Published pieces appear on the /maker page and at their /p/ URL.',
    {
      id: z.string().describe('Workshop ID or UUID'),
      published: z.boolean().default(true).describe('true to publish, false to unpublish'),
    },
    async ({ id, published }) => {
      const updated = await api('PATCH', `/objects/${encodeURIComponent(id)}`, { is_published: published }) as {
        workshop_id: string; public_slug: string
      }
      return {
        content: [{
          type: 'text' as const,
          text: published
            ? `Published ${updated.workshop_id}. Public URL: /p/${updated.public_slug}`
            : `Unpublished ${updated.workshop_id}.`,
        }],
      }
    }
  )

  return server
}
