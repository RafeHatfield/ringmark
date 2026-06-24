import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { readFileSync } from 'fs'
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
    'Update internal fields on an existing object. Only pass fields you want to change.\n\n' +
    'This tool handles: object_type, status, title, species, location_text, private_notes.\n' +
    'It does NOT handle public-facing fields (public_title, public_story, public_notes, public_care) — ' +
    'use save_story for those. It does NOT toggle publish state — use publish_object for that.',
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

  // ── upload_photo ──────────────────────────────────────────────────────────

  server.tool(
    'upload_photo',
    'Upload a photo to a workshop object. The photo appears on the public story page.\n\n' +
    'Three modes — use whichever applies:\n' +
    '• image_url: a publicly accessible URL (iCloud share link, Google Photos link, Dropbox, CDN, etc.).\n' +
    '  The MCP server fetches the image server-side. This is the best option when Claude has a URL.\n' +
    '• file_path: an absolute path on the machine running the MCP server (the user\'s own disk,\n' +
    '  e.g. ~/Downloads/IMG_1719.jpeg). Best when the file is already local.\n' +
    '• image_data + filename: base64 bytes (last resort — impractical for real photos).',
    {
      object_id: z.string().describe('Workshop ID (e.g. RH1) or UUID of the object to attach the photo to'),
      image_url: z.string().optional().describe(
        'Publicly accessible URL of the image. The MCP server will download it. ' +
        'Works with iCloud shared links, Google Photos, Dropbox, Imgur, CDN URLs, etc.'
      ),
      file_path: z.string().optional().describe(
        'Absolute path to an image file on the MCP server host (the user\'s local disk). ' +
        'E.g. /Users/rafe/Downloads/IMG_1719.jpeg'
      ),
      image_data: z.string().optional().describe(
        'Base64-encoded image bytes (no data: URI prefix). Last resort — impractical for images over ~100 KB. ' +
        'Requires filename. Use image_url or file_path instead whenever possible.'
      ),
      filename: z.string().optional().describe(
        'Original filename including extension (e.g. IMG_1719.jpeg). Required when using image_data.'
      ),
      caption: z.string().optional().describe('Optional caption for the photo'),
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

  return server
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
