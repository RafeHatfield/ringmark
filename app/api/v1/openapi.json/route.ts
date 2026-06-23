import { generateSpec } from '@/lib/api-spec'

/**
 * GET /api/v1/openapi.json
 *
 * Returns the OpenAPI 3.1 spec for the Ringmark REST API.
 * No auth required — the spec itself contains no secrets.
 */
export async function GET() {
  const spec = generateSpec()
  return Response.json(spec, {
    headers: {
      // Allow the spec to be fetched by Swagger UI running on any origin
      'Access-Control-Allow-Origin': '*',
    },
  })
}
