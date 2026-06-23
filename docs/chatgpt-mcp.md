# ChatGPT MCP setup

Ringmark exposes a stateless remote MCP endpoint at:

```text
https://ringmark.org/api/mcp
```

Local development uses the same path:

```text
http://localhost:3000/api/mcp
```

The endpoint reuses the existing Ringmark API key security model. Every request must include:

```text
Authorization: Bearer <RINGMARK_API_KEY>
```

## ChatGPT setup

1. Deploy Ringmark with `RINGMARK_API_KEY` set in the environment.
2. In ChatGPT developer mode, create a custom MCP app.
3. Use the MCP endpoint URL, for example `https://ringmark.org/api/mcp`.
4. Choose bearer/API key authentication if available, and provide the same `RINGMARK_API_KEY` value.
5. Scan tools.
6. Enable only the actions you want ChatGPT to use.

The first exposed tools are deliberately small:

| Tool | Access |
|---|---|
| `list_objects` | read |
| `search_objects` | read |
| `get_object` | read |
| `create_object` | write |
| `add_child` | write |
| `update_object` | write |
| `save_story` | write |
| `publish_object` | write |

There is intentionally no delete tool in the remote MCP surface.

## Smoke tests

Initialize the MCP session:

```bash
curl https://ringmark.org/api/mcp \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

List tools:

```bash
curl https://ringmark.org/api/mcp \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

List recent Ringmark objects:

```bash
curl https://ringmark.org/api/mcp \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_objects","arguments":{"limit":5}}}'
```

## Notes

- The endpoint is stateless and accepts JSON-RPC over POST.
- `GET /api/mcp` returns 405 by design.
- The route uses the same REST API layer as the local stdio MCP server, so object ownership and API scoping stay centralized.
- Write-capable ChatGPT MCP apps currently depend on ChatGPT plan/workspace support. If your account can only use read/fetch MCP tools, keep the read tools enabled and use the REST API or local stdio MCP for write workflows until full MCP write access is available.
