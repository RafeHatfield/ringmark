#!/usr/bin/env node
/**
 * Ringmark MCP Server — stdio entry point.
 *
 * Loads credentials from .env.local, builds the server via createServer(),
 * and connects it to the stdio transport for Claude Desktop.
 *
 * Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "ringmark": {
 *         "command": "/path/to/ringmark/node_modules/.bin/tsx",
 *         "args": ["/path/to/ringmark/mcp/index.ts"],
 *         "cwd": "/path/to/ringmark"
 *       }
 *     }
 *   }
 *
 * Set RINGMARK_API_URL to override the default http://localhost:3000.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import fs from 'fs'
import path from 'path'
import { createServer } from './server.js'

// dotenv/dotenvx v17 prints to stdout, corrupting the stdio JSON-RPC channel.
// Parse .env.local manually and silently instead.
function loadEnvFile(envPath: string) {
  try {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
        val = val.slice(1, -1)
      } else {
        const comment = val.indexOf(' #')
        if (comment !== -1) val = val.slice(0, comment).trim()
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* .env.local absent — rely on env vars from MCP host */ }
}

// __dirname is mcp/; .env.local lives one level up.
loadEnvFile(path.join(__dirname, '..', '.env.local'))

const API_KEY = process.env.RINGMARK_API_KEY
const API_BASE = (process.env.RINGMARK_API_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/v1'

if (!API_KEY) {
  process.stderr.write('[ringmark-mcp] Missing RINGMARK_API_KEY in .env.local\n')
  process.exit(1)
}

const server = createServer(API_KEY, API_BASE)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('Ringmark MCP server ready\n')
}

main().catch((err) => {
  process.stderr.write(`Ringmark MCP fatal: ${err}\n`)
  process.exit(1)
})
