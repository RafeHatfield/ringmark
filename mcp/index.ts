#!/usr/bin/env node
/**
 * Ringmark MCP Server
 *
 * Exposes workshop objects as MCP tools so an LLM can create, update,
 * and publish pieces on your behalf during your woodworking process.
 *
 * Run directly:
 *   npx tsx mcp/index.ts
 *
 * Claude Desktop config (~/.config/claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "ringmark": {
 *         "command": "npx",
 *         "args": ["tsx", "/absolute/path/to/ringmark/mcp/index.ts"],
 *         "cwd": "/absolute/path/to/ringmark"
 *       }
 *     }
 *   }
 *
 * Credentials are read from the project's .env.local (via cwd above).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'

import type { Database } from '../lib/types'
import type { ObjectType, ObjectStatus } from '../lib/types'
import { suggestRootId, suggestDescendantId } from '../lib/id-gen'
import { generateSlug } from '../lib/slug-gen'
import { DEFAULT_CARE_INSTRUCTIONS } from '../lib/constants'

// dotenv/dotenvx v17 prints "◇ injected env…" to stdout, which corrupts the
// MCP stdio JSON-RPC channel. Parse .env.local manually and silently instead.
function loadEnvFile(envPath: string) {
  try {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      // Quoted value: strip surrounding quotes, no comment stripping inside quotes
      if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
        val = val.slice(1, -1)
      } else {
        // Unquoted value: strip inline # comments (e.g. KEY=value  # note)
        const comment = val.indexOf(' #')
        if (comment !== -1) val = val.slice(0, comment).trim()
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* .env.local absent — rely on env vars passed by the MCP host */ }
}

// __dirname is the mcp/ directory; .env.local lives one level up at the project root.
// Using __dirname (not process.cwd()) makes the path work regardless of what directory
// the MCP host (Claude Desktop) happens to set as the working directory.
const ENV_PATH = path.join(__dirname, '..', '.env.local')
loadEnvFile(ENV_PATH)

// ── Supabase admin client ─────────────────────────────────────────────────────

function makeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.stderr.write(`[ringmark-mcp] __dirname=${__dirname}\n`)
  process.stderr.write(`[ringmark-mcp] env path=${ENV_PATH} exists=${fs.existsSync(ENV_PATH)}\n`)
  process.stderr.write(`[ringmark-mcp] url=${url ?? '(unset)'}\n`)
  process.stderr.write(`[ringmark-mcp] key length=${key?.length ?? 0} starts-eyJ=${key?.startsWith('eyJ') ?? false}\n`)
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — ' +
      `looked for .env.local at ${ENV_PATH}`
    )
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const db = makeClient()

// Supabase errors are plain objects, not Error instances — String({}) → "[object Object]".
// Wrap them so the MCP SDK can serialize a readable message.
function pgErr(e: { message?: string } | null, fallback = 'Database error'): Error {
  return new Error(e?.message ?? fallback)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAccount() {
  const { data, error } = await db
    .from('accounts')
    .select('id, default_prefix, name')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new Error('No account found in database')
  return data
}

const OBJECT_SELECT =
  'id, workshop_id, object_type, status, title, species, public_slug, public_title, public_story, public_notes, public_care, location_text, private_notes, is_published, parent_id, root_id, account_id, created_at, updated_at' as const

/** Resolve a workshop ID (e.g. "RH1", "RH1-2") or UUID to a full row. */
async function resolveObject(identifier: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(identifier)
  if (isUuid) {
    const { data, error } = await db
      .from('wood_objects')
      .select(OBJECT_SELECT)
      .eq('id', identifier)
      .maybeSingle()
    if (error) throw pgErr(error)
    return data
  }
  const { data, error } = await db
    .from('wood_objects')
    .select(OBJECT_SELECT)
    .ilike('workshop_id', identifier)
    .maybeSingle()
  if (error) throw pgErr(error)
  return data
}

type ResolvedObject = NonNullable<Awaited<ReturnType<typeof resolveObject>>>

// ── MCP server ────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'ringmark', version: '0.1.0' })

// ── list_objects ──────────────────────────────────────────────────────────────

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
    let query = db
      .from('wood_objects')
      .select('id, workshop_id, object_type, status, title, species, is_published, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit ?? 20)

    if (object_type) query = query.eq('object_type', object_type as ObjectType)
    if (status) query = query.eq('status', status as ObjectStatus)
    if (published === true) query = query.eq('is_published', true)

    const { data, error } = await query
    if (error) throw pgErr(error)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ── get_object ────────────────────────────────────────────────────────────────

server.tool(
  'get_object',
  'Get full details of a single object by its workshop ID (e.g. "RH1") or UUID.',
  { id: z.string().describe('Workshop ID (e.g. RH1, RH1-2) or UUID') },
  async ({ id }) => {
    const obj = await resolveObject(id)
    if (!obj) return { content: [{ type: 'text' as const, text: `No object found: ${id}` }] }
    return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] }
  }
)

// ── search_objects ────────────────────────────────────────────────────────────

server.tool(
  'search_objects',
  'Search objects by title keyword, species, workshop ID, or public title.',
  { query: z.string().describe('Search term') },
  async ({ query }) => {
    const q = query.trim()
    const { data, error } = await db
      .from('wood_objects')
      .select('id, workshop_id, object_type, status, title, species, is_published, updated_at')
      .or(`workshop_id.ilike.${q}%,title.ilike.%${q}%,species.ilike.%${q}%,public_title.ilike.%${q}%`)
      .order('updated_at', { ascending: false })
      .limit(15)
    if (error) throw pgErr(error)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ── create_object ─────────────────────────────────────────────────────────────

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
    status: z.string().default('acquired').describe('Initial status (default: acquired)'),
    location_text: z.string().optional().describe('Where the wood came from — stays private'),
    private_notes: z.string().optional().describe('Private workshop notes'),
  },
  async ({ object_type, workshop_id, title, species, status, location_text, private_notes }) => {
    const account = await getAccount()

    const wid = workshop_id
      ? workshop_id.toUpperCase().trim()
      : await suggestRootId(db, account.id, account.default_prefix)

    const { data: collision } = await db
      .from('wood_objects')
      .select('id')
      .eq('account_id', account.id)
      .eq('workshop_id_lower', wid.toLowerCase())
      .maybeSingle()
    if (collision) throw new Error(`Workshop ID "${wid}" is already taken`)

    const slug = await generateSlug(db)

    const { data: created, error } = await db
      .from('wood_objects')
      .insert({
        account_id: account.id,
        workshop_id: wid,
        workshop_id_lower: wid.toLowerCase(),
        public_slug: slug,
        object_type: (object_type ?? 'source') as ObjectType,
        parent_id: null,
        root_id: null,
        title: title?.trim() || null,
        species: species?.trim() || null,
        status: (status ?? 'acquired') as ObjectStatus,
        location_text: location_text?.trim() || null,
        private_notes: private_notes?.trim() || null,
      })
      .select('id, workshop_id, public_slug')
      .single()

    if (error || !created) throw error ? pgErr(error) : new Error('Failed to create object')

    await db.from('wood_objects').update({ root_id: created.id }).eq('id', created.id)

    return {
      content: [{
        type: 'text' as const,
        text: `Created: ${created.workshop_id} (${created.id})\nPublic URL once published: /p/${created.public_slug}`,
      }],
    }
  }
)

// ── add_child ─────────────────────────────────────────────────────────────────

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
    const parent = await resolveObject(parent_id) as ResolvedObject | null
    if (!parent) throw new Error(`Parent not found: ${parent_id}`)

    const rootId = parent.root_id ?? parent.id

    const { data: root } = await db
      .from('wood_objects')
      .select('workshop_id')
      .eq('id', rootId)
      .single()
    const rootWorkshopId = root?.workshop_id ?? parent.workshop_id

    const wid = await suggestDescendantId(db, parent.account_id, rootId, rootWorkshopId)
    const slug = await generateSlug(db)

    const { data: created, error } = await db
      .from('wood_objects')
      .insert({
        account_id: parent.account_id,
        workshop_id: wid,
        workshop_id_lower: wid.toLowerCase(),
        public_slug: slug,
        object_type: object_type as ObjectType,
        parent_id: parent.id,
        root_id: rootId,
        title: title?.trim() || null,
        species: species?.trim() || parent.species,
        status: (status ?? null) as ObjectStatus | null,
        private_notes: private_notes?.trim() || null,
      })
      .select('id, workshop_id, public_slug')
      .single()

    if (error || !created) throw error ? pgErr(error) : new Error('Failed to create child')

    return {
      content: [{
        type: 'text' as const,
        text: `Created child: ${created.workshop_id} (parent: ${parent.workshop_id})\nID: ${created.id}`,
      }],
    }
  }
)

// ── update_object ─────────────────────────────────────────────────────────────

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
    const obj = await resolveObject(id)
    if (!obj) throw new Error(`Object not found: ${id}`)

    const payload = {
      ...(object_type !== undefined && { object_type: object_type as ObjectType }),
      ...(status !== undefined && { status: status as ObjectStatus }),
      ...(title !== undefined && { title: title?.trim() || null }),
      ...(species !== undefined && { species: species?.trim() || null }),
      ...(location_text !== undefined && { location_text: location_text?.trim() || null }),
      ...(private_notes !== undefined && { private_notes: private_notes?.trim() || null }),
      updated_at: new Date().toISOString(),
    }

    const { error } = await db.from('wood_objects').update(payload).eq('id', obj.id)
    if (error) throw pgErr(error)

    return {
      content: [{ type: 'text' as const, text: `Updated ${obj.workshop_id} (${obj.id})` }],
    }
  }
)

// ── save_story ────────────────────────────────────────────────────────────────

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
    public_care: z.string().optional().describe(
      'Care instructions. Standard text is used if omitted.'
    ),
  },
  async ({ id, public_title, public_story, public_notes, public_care }) => {
    const obj = await resolveObject(id)
    if (!obj) throw new Error(`Object not found: ${id}`)

    const payload = {
      ...(public_title !== undefined && { public_title: public_title?.trim() || null }),
      ...(public_story !== undefined && { public_story: public_story?.trim() || null }),
      ...(public_notes !== undefined && { public_notes: public_notes?.trim() || null }),
      public_care: public_care?.trim() || obj.public_care || DEFAULT_CARE_INSTRUCTIONS,
      updated_at: new Date().toISOString(),
    }

    const { error } = await db.from('wood_objects').update(payload).eq('id', obj.id)
    if (error) throw pgErr(error)

    return {
      content: [{
        type: 'text' as const,
        text: `Story saved for ${obj.workshop_id}. Public URL once published: /p/${obj.public_slug}`,
      }],
    }
  }
)

// ── publish_object ────────────────────────────────────────────────────────────

server.tool(
  'publish_object',
  'Publish or unpublish an object. Published pieces appear on the /maker page and at their /p/ URL.',
  {
    id: z.string().describe('Workshop ID or UUID'),
    published: z.boolean().default(true).describe('true to publish, false to unpublish'),
  },
  async ({ id, published }) => {
    const obj = await resolveObject(id)
    if (!obj) throw new Error(`Object not found: ${id}`)

    const { error } = await db
      .from('wood_objects')
      .update({ is_published: published, updated_at: new Date().toISOString() })
      .eq('id', obj.id)
    if (error) throw pgErr(error)

    return {
      content: [{
        type: 'text' as const,
        text: published
          ? `Published ${obj.workshop_id}. Public URL: /p/${obj.public_slug}`
          : `Unpublished ${obj.workshop_id}.`,
      }],
    }
  }
)

// ── start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('Ringmark MCP server ready\n')
}

main().catch((err) => {
  process.stderr.write(`Ringmark MCP fatal: ${err}\n`)
  process.exit(1)
})
