import { McpServer } from "@modelcontextprotocol/server";
import { readFileSync } from 'fs'
import { z } from 'zod'

export const SERVER_INFO = { name: 'ringmark', version: '0.4.0' } as const

/**
 * Tool registration, kept separate from server construction so both entry
 * points can use it:
 *   - mcp/index.ts (stdio) builds its own server via createServer()
 *   - app/api/mcp/route.ts hands mcp-handler a callback, and mcp-handler owns
 *     the server instance
 *
 * Also keeps tests able to import it without triggering stdio or process.exit.
 */
interface ServerOptions {
  /** When true, file_path uploads are disabled (hosted/serverless environment). */
  hosted?: boolean
  /**
   * When true, delete_object exposes `force`, which allows deleting a published
   * object and taking its live public page down.
   *
   * Off by default. The remote server is reachable from the public internet, so
   * there the only deletable object is an unpublished leaf — the existing API
   * guards block published objects and objects with children, and without
   * `force` there is no override. The local stdio server opts in.
   */
  allowForceDelete?: boolean
}

/** Registers every Ringmark tool onto an existing server instance. */
export function registerTools(
  server: McpServer,
  apiKey: string,
  apiBase: string,
  timeoutMs = 30_000,
  options: ServerOptions = {},
): void {
  const { hosted = false, allowForceDelete = false } = options

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

  // ── Multipart upload client ───────────────────────────────────────────────

  async function apiUpload(endpoint: string, form: FormData): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(msg.includes('abort') ? `Upload timed out: ${endpoint}` : msg)
    } finally {
      clearTimeout(timeout)
    }

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

  // Every tool operates on the Ringmark API — a closed, known system — so
  // openWorldHint is false throughout. The one exception is upload_photo,
  // which can fetch an arbitrary image URL.
  const CLOSED_WORLD = { openWorldHint: false } as const

  // ── list_objects ──────────────────────────────────────────────────────────

  server.registerTool(
    'list_objects',
    {
      description: 'List workshop objects, most recently updated first.',
      annotations: { title: 'List objects', readOnlyHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
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
            }),
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

  server.registerTool(
    'get_object',
    {
      description: 'Get full details of a single object by its workshop ID (e.g. "RH1") or UUID.',
      annotations: { title: 'Get object', readOnlyHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({ id: z.string().describe('Workshop ID (e.g. RH1, RH1-2) or UUID') }),
    },
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

  server.registerTool(
    'search_objects',
    {
      description: 'Search objects by title keyword, species, workshop ID, or public title.',
      annotations: { title: 'Search objects', readOnlyHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({ query: z.string().describe('Search term') }),
    },
    async ({ query }) => {
      const data = await api('GET', `/objects?q=${encodeURIComponent(query.trim())}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ── create_object ─────────────────────────────────────────────────────────

  server.registerTool(
    'create_object',
    {
      description:
        'Create a new root object (source tree, found wood, etc.). Workshop ID is auto-generated unless you specify one.',
      annotations: { title: 'Create object', ...CLOSED_WORLD },
      inputSchema: z.object({
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
              price_cents: z.number().int().nonnegative().nullable().optional().describe(
                'Optional asking price in cents (e.g. 12000 for $120.00). Informational only — ' +
                'Ringmark has no checkout, and this never appears on a public page.'
              ),
            }),
    },
    async ({ object_type, workshop_id, title, species, status, location_text, private_notes, price_cents }) => {
      const body: Record<string, unknown> = { object_type }
      if (workshop_id) body.workshop_id = workshop_id
      if (title) body.title = title
      if (species) body.species = species
      if (status) body.status = status
      if (location_text) body.location_text = location_text
      if (private_notes) body.private_notes = private_notes
      if (price_cents !== undefined) body.price_cents = price_cents

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

  server.registerTool(
    'add_child',
    {
      description:
        'Create a child object derived from an existing piece (e.g. a bowl blank from a log). ' +
        'Child workshop ID is auto-generated using flat descendant numbering (e.g. RH1 → RH1-1).',
      annotations: { title: 'Add child object', ...CLOSED_WORLD },
      inputSchema: z.object({
              parent_id: z.string().describe('Workshop ID or UUID of the parent object'),
              object_type: z.string().describe(
                'Type of the new child: log | chunk | slab | blank | rough_bowl | finished_bowl | etc.'
              ),
              title: z.string().optional(),
              species: z.string().optional().describe('Inherits from parent if omitted'),
              status: z.string().optional(),
              private_notes: z.string().optional(),
            }),
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

  server.registerTool(
    'update_object',
    {
      description:
        'Update internal fields on an existing object. Only pass fields you want to change.\n\n' +
        'This tool handles: object_type, status, title, species, location_text, private_notes, parent_id, price_cents.\n' +
        'It does NOT handle public-facing fields (public_title, public_story, public_notes, public_care) — ' +
        'use save_story for those. It does NOT toggle publish state — use publish_object for that.',
      annotations: { title: 'Update object', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              id: z.string().describe('Workshop ID or UUID'),
              workshop_id: z.string().optional().describe(
                'Rename the workshop ID (e.g. "RH3"). Must be unique. Renaming a root does not auto-rename children — update each child separately.'
              ),
              object_type: z.string().optional(),
              status: z.string().optional(),
              title: z.string().optional(),
              species: z.string().optional(),
              location_text: z.string().optional(),
              private_notes: z.string().optional(),
              parent_id: z.string().nullable().optional().describe(
                'Workshop ID or UUID of the new parent. Pass null to make this object a root with no parent.'
              ),
              price_cents: z.number().int().nonnegative().nullable().optional().describe(
                'Optional asking price in cents (e.g. 12000 for $120.00). Pass null to clear it. ' +
                'Informational only — never appears on a public page.'
              ),
            }),
    },
    async ({ id, workshop_id, object_type, status, title, species, location_text, private_notes, parent_id, price_cents }) => {
      const body: Record<string, unknown> = {}
      if (workshop_id !== undefined) body.workshop_id = workshop_id
      if (object_type !== undefined) body.object_type = object_type
      if (status !== undefined) body.status = status
      if (title !== undefined) body.title = title
      if (species !== undefined) body.species = species
      if (location_text !== undefined) body.location_text = location_text
      if (private_notes !== undefined) body.private_notes = private_notes
      if (parent_id !== undefined) body.parent_id = parent_id
      if (price_cents !== undefined) body.price_cents = price_cents

      const updated = await api('PATCH', `/objects/${encodeURIComponent(id)}`, body) as {
        workshop_id: string; id: string
      }
      return {
        content: [{ type: 'text' as const, text: `Updated ${updated.workshop_id} (${updated.id})` }],
      }
    }
  )

  // ── delete_object ─────────────────────────────────────────────────────────
  //
  // Hard delete, and the only irreversible tool here. Registered in one of two
  // shapes depending on allowForceDelete — see ServerOptions.

  async function deleteObject(id: string, force: boolean) {
    const qs = force ? '?force=true' : ''
    await api('DELETE', `/objects/${encodeURIComponent(id)}${qs}`)
    return { content: [{ type: 'text' as const, text: `Deleted ${id}.` }] }
  }

  if (allowForceDelete) {
    server.registerTool(
      'delete_object',
      {
        description:
          'Permanently delete an object and all its photos. Cannot be undone.\n\n' +
          'Guards:\n' +
          '• Published objects: blocked unless force=true. Unpublish first or pass force=true.\n' +
          '• Objects with children: always blocked — delete or re-parent children first.\n\n' +
          'Photos are removed from storage as part of deletion, including any that were ' +
          'previously soft-deleted.',
        annotations: { title: 'Delete object', destructiveHint: true, ...CLOSED_WORLD },
        inputSchema: z.object({
                  id: z.string().describe('Workshop ID (e.g. RH4-2) or UUID of the object to delete'),
                  force: z.boolean().default(false).describe(
                    'Set true to delete a published object, taking its live public page down. Has no effect on the children guard.'
                  ),
                }),
      },
      async ({ id, force }) => deleteObject(id, force ?? false)
    )
  } else {
    server.registerTool(
      'delete_object',
      {
        description:
          'Permanently delete an object and all its photos. Cannot be undone.\n\n' +
          'Guards:\n' +
          '• Published objects: blocked. Unpublish first with publish_object.\n' +
          '• Objects with children: blocked — delete or re-parent children first.\n\n' +
          'Photos are removed from storage as part of deletion, including any that were ' +
          'previously soft-deleted.\n\n' +
          'There is no force option on this server, so a published object cannot be deleted here at all.',
        annotations: { title: 'Delete object', destructiveHint: true, ...CLOSED_WORLD },
        inputSchema: z.object({
                  id: z.string().describe('Workshop ID (e.g. RH4-2) or UUID of the object to delete'),
                }),
      },
      async ({ id }) => deleteObject(id, false)
    )
  }

  // ── save_story ────────────────────────────────────────────────────────────

  server.registerTool(
    'save_story',
    {
      description:
        'Set the public story fields on an object (title, narrative, notes, care instructions). ' +
        'Does not publish — call publish_object separately.',
      annotations: { title: 'Save public story', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              id: z.string().describe('Workshop ID or UUID'),
              public_title: z.string().optional().describe('Title shown on the public page'),
              public_story: z.string().optional().describe(
                'The narrative — where the wood came from, what it became'
              ),
              public_notes: z.string().optional().describe(
                'Species, dimensions, finish — anything buyers should know'
              ),
              public_care: z.string().optional().describe('Care instructions'),
            }),
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

  server.registerTool(
    'publish_object',
    {
      description:
        'Publish or unpublish an object. Published pieces appear on the /maker page and at their /p/ URL.',
      annotations: { title: 'Publish object', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              id: z.string().describe('Workshop ID or UUID'),
              published: z.boolean().default(true).describe('true to publish, false to unpublish'),
            }),
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

  // ── list_photos ───────────────────────────────────────────────────────────

  server.registerTool(
    'list_photos',
    {
      description:
        'List the photos attached to an object, with their IDs. ' +
        'Use this before delete_photo, restore_photo, or update_photo to find the photo IDs you need.\n\n' +
        'Deleted photos are hidden by default — pass include_deleted to see them and get the IDs ' +
        'needed to restore.',
      annotations: { title: 'List photos', readOnlyHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              object_id: z.string().describe('Workshop ID (e.g. RH4) or UUID'),
              include_deleted: z.boolean().default(false).describe(
                'Include soft-deleted photos, marked [deleted] in the output. Use to find IDs for restore_photo.'
              ),
            }),
    },
    async ({ object_id, include_deleted }) => {
      const qs = include_deleted ? '?include_deleted=true' : ''
      const data = await api('GET', `/objects/${encodeURIComponent(object_id)}/photos${qs}`) as {
        data: Array<{
          id: string; caption: string | null; is_public: boolean; sort_order: number
          signed_url: string | null; deleted_at?: string | null
        }>
        total: number
      }
      if (data.total === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: include_deleted
              ? `No photos on ${object_id}.`
              : `No photos on ${object_id}. Try include_deleted to check for deleted ones.`,
          }],
        }
      }
      const lines = data.data.map((p, i) => {
        const caption = p.caption ? ` "${p.caption}"` : ''
        const pub = p.is_public ? '' : ' [private]'
        const del = p.deleted_at ? ' [deleted]' : ''
        return `${i + 1}. ${p.id}${caption}${pub}${del}`
      })
      return { content: [{ type: 'text' as const, text: `${data.total} photo(s) on ${object_id}:\n${lines.join('\n')}` }] }
    }
  )

  // ── delete_photo ──────────────────────────────────────────────────────────

  server.registerTool(
    'delete_photo',
    {
      description:
        'Delete a photo from an object. Use list_photos first to get the photo ID.\n\n' +
        'This is reversible: the photo is removed from the object, the public story page, and ' +
        'the share card immediately, but the image file is kept so restore_photo can bring it ' +
        'back at its original position. To find a deleted photo\'s ID later, call list_photos ' +
        'with include_deleted.',
      annotations: { title: 'Delete photo', destructiveHint: true, idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              object_id: z.string().describe('Workshop ID (e.g. RH4) or UUID of the object the photo belongs to'),
              photo_id: z.string().describe('UUID of the photo to delete (from list_photos)'),
            }),
    },
    async ({ object_id, photo_id }) => {
      await api('DELETE', `/objects/${encodeURIComponent(object_id)}/photos/${encodeURIComponent(photo_id)}`)
      return {
        content: [{
          type: 'text' as const,
          text: `Photo ${photo_id} deleted from ${object_id}. Restore it with restore_photo if that was a mistake.`,
        }],
      }
    }
  )

  // ── restore_photo ─────────────────────────────────────────────────────────

  server.registerTool(
    'restore_photo',
    {
      description:
        'Restore a previously deleted photo, putting it back at its original position on the object. ' +
        'Call list_photos with include_deleted first to find the photo ID.',
      annotations: { title: 'Restore photo', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              object_id: z.string().describe('Workshop ID (e.g. RH4) or UUID of the object the photo belongs to'),
              photo_id: z.string().describe('UUID of the deleted photo (from list_photos with include_deleted)'),
            }),
    },
    async ({ object_id, photo_id }) => {
      const restored = await api(
        'POST',
        `/objects/${encodeURIComponent(object_id)}/photos/${encodeURIComponent(photo_id)}/restore`
      ) as { id: string; sort_order: number }
      return {
        content: [{
          type: 'text' as const,
          text: `Photo ${restored.id} restored to ${object_id} at position ${restored.sort_order}.`,
        }],
      }
    }
  )

  // ── update_photo ──────────────────────────────────────────────────────────

  server.registerTool(
    'update_photo',
    {
      description:
        'Update the caption of an existing photo without touching the image file or sort order. ' +
        'Use list_photos first to find the photo_id.',
      annotations: { title: 'Update photo caption', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              object_id: z.string().describe('Workshop ID (e.g. RH1) or UUID of the object the photo belongs to'),
              photo_id: z.string().describe('UUID of the photo (from list_photos)'),
              caption: z.string().describe('New caption text. Pass an empty string to clear the caption.'),
            }),
    },
    async ({ object_id, photo_id, caption }) => {
      await api(
        'PATCH',
        `/objects/${encodeURIComponent(object_id)}/photos/${encodeURIComponent(photo_id)}`,
        { caption }
      )
      const displayCaption = caption.trim() ? `"${caption.trim()}"` : '(cleared)'
      return {
        content: [{
          type: 'text' as const,
          text: `Caption updated for photo ${photo_id} on ${object_id}: ${displayCaption}`,
        }],
      }
    }
  )

  // ── get_lineage ───────────────────────────────────────────────────────────

  server.registerTool(
    'get_lineage',
    {
      description:
        'Get the full journey chain for an object — from root source down to the requested piece. ' +
        'Returns each step with its label, step notes, photo count, and thumbnail URL, ordered root-first. ' +
        'Use this to understand an object\'s complete history before writing a public story.',
      annotations: { title: 'Get lineage', readOnlyHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({ id: z.string().describe('Workshop ID (e.g. RH9-4) or UUID of any object in the chain') }),
    },
    async ({ id }) => {
      const data = await api('GET', `/objects/${encodeURIComponent(id)}/lineage`) as {
        steps: Array<{ workshop_id: string; step_label: string; public_story: string | null; photo_count: number }>
      }
      const lines = data.steps.map((step, i) => {
        const prefix = i === 0 ? '◉' : i === data.steps.length - 1 ? '●' : '○'
        const note = step.public_story ? ` — "${step.public_story.slice(0, 80)}${step.public_story.length > 80 ? '…' : ''}"` : ''
        const photos = step.photo_count > 0 ? ` [${step.photo_count} photo${step.photo_count > 1 ? 's' : ''}]` : ''
        return `${prefix} ${step.workshop_id}  ${step.step_label}${photos}${note}`
      })
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    }
  )

  // ── Market Events ─────────────────────────────────────────────────────────
  //
  // Fully private feature — in-person selling events (craft markets, shows).
  // Prep and after-the-fact operations only: create an event, bulk-add pieces,
  // reprice, review totals. mark_item_sold/unmark_item_sold exist for a
  // debrief ("I sold three things, here's what"), not for the live sale —
  // that stays in the mobile admin UI, which is built for a one-tap, no-modal
  // interaction standing at a table. No hosted/local asymmetry: every table
  // here is private, so there's nothing extra for a remote MCP call to risk.

  // ── create_market_event ───────────────────────────────────────────────────

  server.registerTool(
    'create_market_event',
    {
      description:
        'Create a new market event to plan for — a craft market, show, or other in-person ' +
        'selling event. Starts in planning status; use update_market_event to move it to ' +
        'active, completed, or cancelled.',
      annotations: { title: 'Create market event', ...CLOSED_WORLD },
      inputSchema: z.object({
              name: z.string().min(1).describe('Event name (e.g. "Lynn Valley Farmers Market")'),
              event_date: z.string().optional().describe(
                'ISO date (e.g. 2026-08-16). Optional — a market can be planned before its date is fixed.'
              ),
              location_text: z.string().optional().describe('Where the event is'),
              notes: z.string().optional().describe('Any planning notes'),
            }),
    },
    async ({ name, event_date, location_text, notes }) => {
      const body: Record<string, unknown> = { name }
      if (event_date !== undefined) body.event_date = event_date
      if (location_text !== undefined) body.location_text = location_text
      if (notes !== undefined) body.notes = notes

      const created = await api('POST', '/market-events', body) as { id: string; name: string; status: string }
      return {
        content: [{
          type: 'text' as const,
          text: `Created market event: ${created.name} (${created.id}), status: ${created.status}`,
        }],
      }
    }
  )

  // ── list_market_events ────────────────────────────────────────────────────

  server.registerTool(
    'list_market_events',
    {
      description: 'List the account\'s market events, most recent first. Filter by status.',
      annotations: { title: 'List market events', readOnlyHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              status: z.string().optional().describe(
                'Filter by status: planning | active | completed | cancelled'
              ),
            }),
    },
    async ({ status }) => {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      const data = await api('GET', `/market-events?${params}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
    }
  )

  // ── get_market_event ──────────────────────────────────────────────────────

  server.registerTool(
    'get_market_event',
    {
      description:
        'Get a market event by ID: every item on it (workshop ID, title, species, asking ' +
        'price, sold state, item_id) and server-computed totals (item count, sold count, ' +
        'total asking value, total sold value). Use this to find an item\'s item_id before ' +
        'calling remove_market_item, update_market_item_price, mark_item_sold, or unmark_item_sold.',
      annotations: { title: 'Get market event', readOnlyHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({ id: z.string().describe('Market event UUID') }),
    },
    async ({ id }) => {
      try {
        const data = await api('GET', `/market-events/${encodeURIComponent(id)}`) as {
          name: string; status: string; event_date: string | null; location_text: string | null
          items: Array<{
            id: string; workshop_id: string; title: string | null
            asking_price_cents: number | null; sold: boolean; sold_price_cents: number | null
          }>
          totals: { item_count: number; sold_count: number; total_asking_cents: number; total_sold_cents: number }
        }
        const header = `"${data.name}" (${data.status})` +
          `${data.event_date ? ` — ${data.event_date}` : ''}` +
          `${data.location_text ? ` @ ${data.location_text}` : ''}`
        const totalsLine =
          `${data.totals.item_count} item(s), ${data.totals.sold_count} sold. ` +
          `Asking total: ${formatCents(data.totals.total_asking_cents)}. ` +
          `Sold total: ${formatCents(data.totals.total_sold_cents)}.`
        const itemLines = data.items.map((item, i) => {
          const price = item.asking_price_cents != null ? formatCents(item.asking_price_cents) : 'no price set'
          const sold = item.sold
            ? ` [SOLD${item.sold_price_cents != null ? ` ${formatCents(item.sold_price_cents)}` : ''}]`
            : ''
          const title = item.title ? ` "${item.title}"` : ''
          return `${i + 1}. ${item.workshop_id}${title} — ${price}${sold}  (item_id: ${item.id})`
        })
        const body = itemLines.length ? itemLines.join('\n') : '(no items yet)'
        return { content: [{ type: 'text' as const, text: `${header}\n${totalsLine}\n\n${body}` }] }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('not found')) {
          return { content: [{ type: 'text' as const, text: `No market event found: ${id}` }] }
        }
        throw err
      }
    }
  )

  // ── update_market_event ───────────────────────────────────────────────────

  server.registerTool(
    'update_market_event',
    {
      description:
        'Update a market event\'s name, date, location, notes, or status. Only pass fields you want to change.',
      annotations: { title: 'Update market event', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              id: z.string().describe('Market event UUID'),
              name: z.string().optional(),
              event_date: z.string().nullable().optional().describe('ISO date, or null to clear'),
              location_text: z.string().nullable().optional(),
              notes: z.string().nullable().optional(),
              status: z.string().optional().describe('planning | active | completed | cancelled'),
            }),
    },
    async ({ id, name, event_date, location_text, notes, status }) => {
      const body: Record<string, unknown> = {}
      if (name !== undefined) body.name = name
      if (event_date !== undefined) body.event_date = event_date
      if (location_text !== undefined) body.location_text = location_text
      if (notes !== undefined) body.notes = notes
      if (status !== undefined) body.status = status

      const updated = await api('PATCH', `/market-events/${encodeURIComponent(id)}`, body) as {
        id: string; name: string; status: string
      }
      return {
        content: [{
          type: 'text' as const,
          text: `Updated market event: ${updated.name} (${updated.id}), status: ${updated.status}`,
        }],
      }
    }
  )

  // ── delete_market_event ───────────────────────────────────────────────────

  server.registerTool(
    'delete_market_event',
    {
      description:
        'Permanently delete a market event and every item on it. Cannot be undone. The ' +
        'pieces themselves are untouched — only the record of them being taken to this ' +
        'market is removed.',
      annotations: { title: 'Delete market event', destructiveHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({ id: z.string().describe('Market event UUID') }),
    },
    async ({ id }) => {
      await api('DELETE', `/market-events/${encodeURIComponent(id)}`)
      return { content: [{ type: 'text' as const, text: `Deleted market event ${id} and its items.` }] }
    }
  )

  // ── add_market_items ──────────────────────────────────────────────────────

  server.registerTool(
    'add_market_items',
    {
      description:
        'Add several pieces to a market event in one call — the "go through and select ' +
        'everything you\'re taking" step. Accepts up to 100 workshop IDs or UUIDs, any ' +
        'status, published or not (a market piece does not need a public Ringmark page). ' +
        'Pieces that don\'t belong to this account, or are already on this event, are ' +
        'skipped rather than failing the whole batch — check the response for what was skipped and why.',
      annotations: { title: 'Add pieces to a market event', ...CLOSED_WORLD },
      inputSchema: z.object({
              market_event_id: z.string().describe('Market event UUID'),
              object_ids: z.array(z.string()).min(1).max(100).describe(
                'Workshop IDs or UUIDs of the pieces to add'
              ),
            }),
    },
    async ({ market_event_id, object_ids }) => {
      const result = await api(
        'POST',
        `/market-events/${encodeURIComponent(market_event_id)}/items/bulk`,
        { object_ids }
      ) as {
        added: Array<{ id: string; workshop_id: string }>
        skipped: Array<{ id: string; reason: string }>
      }
      const lines = [`Added ${result.added.length} of ${object_ids.length} to market event ${market_event_id}.`]
      if (result.added.length) {
        lines.push(...result.added.map(i => `  + ${i.workshop_id} (item_id: ${i.id})`))
      }
      if (result.skipped.length) {
        lines.push(`Skipped ${result.skipped.length}:`)
        lines.push(...result.skipped.map(s => `  - ${s.id}: ${s.reason}`))
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    }
  )

  // ── remove_market_item ────────────────────────────────────────────────────

  server.registerTool(
    'remove_market_item',
    {
      description:
        'Remove a piece from a market event. The piece itself is untouched — only its ' +
        'appearance at this event is deleted. Use get_market_event first to find the item_id.',
      annotations: { title: 'Remove item from market event', destructiveHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              market_event_id: z.string().describe('Market event UUID'),
              item_id: z.string().describe('Market event item UUID (from get_market_event)'),
            }),
    },
    async ({ market_event_id, item_id }) => {
      await api(
        'DELETE',
        `/market-events/${encodeURIComponent(market_event_id)}/items/${encodeURIComponent(item_id)}`
      )
      return {
        content: [{
          type: 'text' as const,
          text: `Removed item ${item_id} from market event ${market_event_id}.`,
        }],
      }
    }
  )

  // ── update_market_item_price ──────────────────────────────────────────────

  server.registerTool(
    'update_market_item_price',
    {
      description:
        'Set the asking price for a piece at this specific market event — independent of ' +
        'the piece\'s own price_cents and independent of its price at any other event (the ' +
        'same piece can go to more than one market at a different price). Use ' +
        'get_market_event first to find the item_id.',
      annotations: { title: 'Update market item price', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              market_event_id: z.string().describe('Market event UUID'),
              item_id: z.string().describe('Market event item UUID (from get_market_event)'),
              asking_price_cents: z.number().int().nonnegative().nullable().describe(
                'New asking price in cents (e.g. 12000 for $120.00). Pass null to clear it.'
              ),
            }),
    },
    async ({ market_event_id, item_id, asking_price_cents }) => {
      const updated = await api(
        'PATCH',
        `/market-events/${encodeURIComponent(market_event_id)}/items/${encodeURIComponent(item_id)}`,
        { asking_price_cents }
      ) as { id: string; workshop_id: string; asking_price_cents: number | null }
      const price = updated.asking_price_cents != null ? formatCents(updated.asking_price_cents) : 'cleared'
      return {
        content: [{
          type: 'text' as const,
          text: `Price updated for ${updated.workshop_id} on market event ${market_event_id}: ${price}`,
        }],
      }
    }
  )

  // ── mark_item_sold ────────────────────────────────────────────────────────
  //
  // Prep/debrief tool, not the live-sale tool — see the section note above.

  server.registerTool(
    'mark_item_sold',
    {
      description:
        'Mark a piece sold at this market event. This is for prep/debrief use — recording a ' +
        'sale after the fact (e.g. reviewing what sold once you\'re back from a market) — ' +
        'NOT for the live sale itself. Standing at the table with a customer in front of you ' +
        'is a one-tap-checkbox moment handled by the mobile admin UI (big tap target, no ' +
        'confirmation dialog); use that in the moment and this tool afterward. Also sets the ' +
        'underlying object\'s status to sold. Defaults sold_price_cents to the item\'s asking ' +
        'price when omitted.',
      annotations: { title: 'Mark item sold (prep/debrief)', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              market_event_id: z.string().describe('Market event UUID'),
              item_id: z.string().describe('Market event item UUID (from get_market_event)'),
              sold_price_cents: z.number().int().nonnegative().optional().describe(
                'Price it actually sold for, in cents. Defaults to the item\'s asking price if omitted.'
              ),
            }),
    },
    async ({ market_event_id, item_id, sold_price_cents }) => {
      const body: Record<string, unknown> = {}
      if (sold_price_cents !== undefined) body.sold_price_cents = sold_price_cents

      const updated = await api(
        'POST',
        `/market-events/${encodeURIComponent(market_event_id)}/items/${encodeURIComponent(item_id)}/mark-sold`,
        body
      ) as { id: string; workshop_id: string; sold_price_cents: number | null }
      const price = updated.sold_price_cents != null ? formatCents(updated.sold_price_cents) : 'no price recorded'
      return {
        content: [{
          type: 'text' as const,
          text: `Marked ${updated.workshop_id} sold at ${price} on market event ${market_event_id}. Object status set to sold.`,
        }],
      }
    }
  )

  // ── unmark_item_sold ──────────────────────────────────────────────────────

  server.registerTool(
    'unmark_item_sold',
    {
      description:
        'Undo a sale on a market event item — clears its sold state. Reverts the underlying ' +
        'object\'s status to for_sale unconditionally (not to whatever it was before).',
      annotations: { title: 'Unmark item sold', idempotentHint: true, ...CLOSED_WORLD },
      inputSchema: z.object({
              market_event_id: z.string().describe('Market event UUID'),
              item_id: z.string().describe('Market event item UUID (from get_market_event)'),
            }),
    },
    async ({ market_event_id, item_id }) => {
      const updated = await api(
        'POST',
        `/market-events/${encodeURIComponent(market_event_id)}/items/${encodeURIComponent(item_id)}/unmark-sold`
      ) as { id: string; workshop_id: string }
      return {
        content: [{
          type: 'text' as const,
          text: `Unmarked ${updated.workshop_id} as sold on market event ${market_event_id}. Object status reverted to for_sale.`,
        }],
      }
    }
  )

  // ── upload_photo ──────────────────────────────────────────────────────────

  server.registerTool(
    'upload_photo',
    {
      description:
        'Upload a photo to a workshop object. The photo appears on the public story page.\n\n' +
        'Three modes — use whichever applies:\n' +
        '• image_url: a publicly accessible URL (iCloud share link, Google Photos link, Dropbox, CDN, etc.).\n' +
        '  The MCP server fetches the image server-side. This is the best option when Claude has a URL.\n' +
        '• file_path: an absolute path on the machine running the MCP server (the user\'s own disk,\n' +
        '  e.g. ~/Downloads/IMG_1719.jpeg). Best when the file is already local.\n' +
        '• image_data + filename: base64 bytes (last resort — impractical for real photos).',
      // openWorldHint stays true here: image_url fetches an arbitrary URL.
      annotations: { title: 'Upload photo', openWorldHint: true },
      inputSchema: z.object({
              object_id: z.string().describe('Workshop ID (e.g. RH1) or UUID of the object to attach the photo to'),
              image_url: z.string().optional().describe(
                'Publicly accessible URL of the image. The MCP server will download it. ' +
                'Works with iCloud shared links, Google Photos, Dropbox, Imgur, CDN URLs, etc.'
              ),
              file_path: z.string().optional().describe(
                hosted
                  ? 'NOT AVAILABLE on the hosted server — local file paths cannot be read remotely. Use image_url or image_data instead.'
                  : 'Absolute path to an image file on the MCP server host (the user\'s local disk). E.g. /Users/rafe/Downloads/IMG_1719.jpeg'
              ),
              image_data: z.string().optional().describe(
                'Base64-encoded image bytes (no data: URI prefix). Last resort — impractical for images over ~100 KB. ' +
                'Requires filename. Use image_url or file_path instead whenever possible.'
              ),
              filename: z.string().optional().describe(
                'Original filename including extension (e.g. IMG_1719.jpeg). Required when using image_data.'
              ),
              caption: z.string().optional().describe('Optional caption for the photo'),
            }),
    },
    async ({ object_id, image_url, file_path, image_data, filename, caption }) => {
      let fileBuffer: Buffer
      let uploadFilename: string
      let mimeType: string

      if (image_url) {
        // Server-side URL fetch — the argument is just a short URL string.
        // Works for any publicly accessible image (iCloud share, Google Photos, Dropbox, CDN, etc.)
        let fetchRes: Response
        try {
          fetchRes = await fetch(image_url)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`Failed to fetch image URL: ${msg}`)
        }
        if (!fetchRes.ok) {
          throw new Error(`Image URL returned HTTP ${fetchRes.status}: ${image_url}`)
        }
        const contentType = fetchRes.headers.get('content-type') ?? 'image/jpeg'
        mimeType = contentType.split(';')[0].trim()
        fileBuffer = Buffer.from(await fetchRes.arrayBuffer())
        // Derive filename from URL path, falling back to a timestamped default
        const urlPath = new URL(image_url).pathname
        uploadFilename = filename ?? (urlPath.split('/').pop()?.split('?')[0] || `photo-${Date.now()}.jpg`)
      } else if (file_path) {
        if (hosted) {
          throw new Error(
            'file_path is not available on the hosted MCP server — the server cannot read your local disk.\n' +
            'Use image_url (a public link) or image_data (base64) to upload photos.'
          )
        }
        // Path on the MCP server host (the user's local machine under Claude Desktop).
        try {
          fileBuffer = readFileSync(file_path)
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'EACCES' || code === 'EPERM') {
            throw new Error(
              `Permission denied reading file: ${file_path}\n` +
              'On macOS, this is usually TCC (Transparency, Consent, Control) blocking access to ~/Downloads or ~/Desktop. ' +
              'Grant Full Disk Access to the terminal/Claude Desktop app in System Settings → Privacy & Security → Full Disk Access, ' +
              'or move the file to a location the app can read (e.g. /tmp).\n' +
              'Alternatively, use image_url if the image is accessible at a URL.'
            )
          }
          throw new Error(
            `File not found: ${file_path}\n` +
            'Ensure this path exists on the machine running the MCP server and the extension is included (e.g. .jpg, .jpeg, .png). ' +
            'If the image is at a URL (iCloud link, Google Photos, etc.) use image_url instead.'
          )
        }
        uploadFilename = file_path.split('/').pop() ?? 'photo.jpg'
        mimeType = extToMime(file_path.split('.').pop()?.toLowerCase() ?? '')
      } else if (image_data) {
        if (!filename) throw new Error('filename is required when using image_data')
        const MAX_BASE64 = 20 * 1024 * 1024 // ~15 MB original
        if (image_data.length > MAX_BASE64) {
          throw new Error(
            `image_data exceeds the 20 MB base64 limit (got ~${Math.round(image_data.length / 1024 / 1024)} MB). ` +
            'Use image_url or file_path instead.'
          )
        }
        fileBuffer = Buffer.from(image_data, 'base64')
        uploadFilename = filename
        mimeType = extToMime(filename.split('.').pop()?.toLowerCase() ?? '')
      } else {
        throw new Error(
          'Provide one of: image_url (public URL), file_path (local path on MCP host), ' +
          'or image_data + filename (base64).'
        )
      }

      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), uploadFilename)
      if (caption) form.append('caption', caption)

      const result = await apiUpload(
        `/objects/${encodeURIComponent(object_id)}/photos`,
        form
      ) as { id: string; sort_order: number; signed_url?: string | null }

      const lines = [
        `Photo uploaded to ${object_id}`,
        `Photo ID: ${result.id}`,
        `Sort order: ${result.sort_order}`,
      ]
      if (result.signed_url) lines.push(`View: ${result.signed_url}`)

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    }
  )
}

/**
 * Builds a standalone McpServer with every tool registered. Used by the stdio
 * entry point and the tests. The HTTP route lets mcp-handler own the server
 * instance and calls registerTools() directly instead.
 */
export function createServer(
  apiKey: string,
  apiBase: string,
  timeoutMs = 30_000,
  options: ServerOptions = {},
): McpServer {
  const server = new McpServer(SERVER_INFO)
  registerTools(server, apiKey, apiBase, timeoutMs, options)
  return server
}

/** Formats integer cents as a dollar string, e.g. 12000 → "$120.00". */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function extToMime(ext: string): string {
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  }
  return map[ext] ?? 'image/jpeg'
}
