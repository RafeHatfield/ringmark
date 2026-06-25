/**
 * OpenAPI 3.1 spec generator for Ringmark REST API v1.
 *
 * Import this in app/api/v1/openapi.json/route.ts to serve the spec.
 * All route definitions here mirror the actual route handlers — if you add an
 * endpoint, add it here too. The Zod schemas in api-schemas.ts are the
 * single source of truth for both validation and documentation.
 */

import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import {
  WoodObjectSchema,
  WoodObjectSummarySchema,
  ListResponseSchema,
  CreateObjectSchema,
  PatchObjectSchema,
  CreateChildSchema,
  LineageStepSchema,
  LineageResponseSchema,
  PhotoSchema,
  ErrorSchema,
  objectTypeEnum,
  objectStatusEnum,
} from './api-schemas'

function buildRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry()

  // Register named schemas (appear in #/components/schemas)
  registry.register('WoodObject', WoodObjectSchema)
  registry.register('WoodObjectSummary', WoodObjectSummarySchema)
  registry.register('WoodObjectList', ListResponseSchema)
  registry.register('CreateObject', CreateObjectSchema)
  registry.register('PatchObject', PatchObjectSchema)
  registry.register('CreateChild', CreateChildSchema)
  registry.register('LineageStep', LineageStepSchema)
  registry.register('LineageResponse', LineageResponseSchema)
  registry.register('Photo', PhotoSchema)
  registry.register('Error', ErrorSchema)

  // ── Security scheme ─────────────────────────────────────────────────────────
  registry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: 'API key set via RINGMARK_API_KEY environment variable',
  })

  const security = [{ BearerAuth: [] }]
  const errorResponses = {
    401: {
      description: 'Unauthorized — missing or invalid API key',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  }

  const idParam = {
    name: 'id',
    in: 'path' as const,
    required: true,
    description: 'Workshop ID (e.g. RH1, RH1-2) or UUID',
    schema: z.string().openapi({ example: 'RH1' }),
  }

  // ── GET /api/v1/objects ─────────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/api/v1/objects',
    tags: ['Objects'],
    summary: 'List workshop objects',
    description: 'Returns a paginated list of objects, newest-updated first. Supports filtering by type, status, and publish state, and full-text search across title, species, workshop ID, and public title.',
    security,
    request: {
      query: z.object({
        q: z.string().optional().openapi({ description: 'Search term (matches workshop ID, title, species, public title)', example: 'maple' }),
        type: objectTypeEnum.optional().openapi({ description: 'Filter by object type' }),
        status: objectStatusEnum.optional().openapi({ description: 'Filter by status' }),
        published: z.enum(['true', 'false']).optional().openapi({ description: 'Filter by publish state' }),
        limit: z.string().optional().openapi({ description: 'Max results, 1–50 (default 20)', example: '20' }),
        offset: z.string().optional().openapi({ description: 'Pagination offset (default 0)', example: '0' }),
      }),
    },
    responses: {
      200: {
        description: 'Paginated list of objects',
        content: { 'application/json': { schema: ListResponseSchema } },
      },
      ...errorResponses,
    },
  })

  // ── POST /api/v1/objects ────────────────────────────────────────────────────
  registry.registerPath({
    method: 'post',
    path: '/api/v1/objects',
    tags: ['Objects'],
    summary: 'Create a root object',
    description: 'Creates a new top-level workshop object. Workshop ID and public slug are auto-generated if not provided.',
    security,
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: CreateObjectSchema } },
      },
    },
    responses: {
      201: {
        description: 'Created object',
        content: { 'application/json': { schema: WoodObjectSchema } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: 'Workshop ID already taken',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      ...errorResponses,
    },
  })

  // ── GET /api/v1/objects/:id ─────────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/api/v1/objects/{id}',
    tags: ['Objects'],
    summary: 'Get a single object',
    description: 'Fetch a full object by workshop ID (e.g. RH1) or UUID.',
    security,
    request: { params: z.object({ id: idParam.schema }) },
    responses: {
      200: {
        description: 'Full object',
        content: { 'application/json': { schema: WoodObjectSchema } },
      },
      ...errorResponses,
    },
  })

  // ── PATCH /api/v1/objects/:id ───────────────────────────────────────────────
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/objects/{id}',
    tags: ['Objects'],
    summary: 'Update an object',
    description: 'Partial update — only pass the fields you want to change. `public_slug` and `account_id` are not accepted. To publish or unpublish, set `is_published`.',
    security,
    request: {
      params: z.object({ id: idParam.schema }),
      body: {
        required: true,
        content: { 'application/json': { schema: PatchObjectSchema } },
      },
    },
    responses: {
      200: {
        description: 'Updated object',
        content: { 'application/json': { schema: WoodObjectSchema } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      ...errorResponses,
    },
  })

  // ── DELETE /api/v1/objects/:id ──────────────────────────────────────────────
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/objects/{id}',
    tags: ['Objects'],
    summary: 'Delete an object',
    description: 'Permanently deletes the object. Children are cascade-deleted by the database.',
    security,
    request: { params: z.object({ id: idParam.schema }) },
    responses: {
      204: { description: 'Deleted — no content' },
      ...errorResponses,
    },
  })

  // ── POST /api/v1/objects/:id/children ──────────────────────────────────────
  registry.registerPath({
    method: 'post',
    path: '/api/v1/objects/{id}/children',
    tags: ['Objects'],
    summary: 'Add a child object',
    description: 'Creates a new object derived from the given parent (e.g. a bowl blank from a log). Workshop ID is auto-generated using flat descendant numbering (RH1 → RH1-1, RH1-2, …). Species is inherited from the parent if not provided.',
    security,
    request: {
      params: z.object({ id: idParam.schema }),
      body: {
        required: true,
        content: { 'application/json': { schema: CreateChildSchema } },
      },
    },
    responses: {
      201: {
        description: 'Created child object',
        content: { 'application/json': { schema: WoodObjectSchema } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      ...errorResponses,
    },
  })

  // ── GET /api/v1/objects/:id/lineage ────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/api/v1/objects/{id}/lineage',
    tags: ['Objects'],
    summary: 'Get lineage chain',
    description: 'Returns the full ancestry chain from the root object down to the requested object, ordered root-first. Each step includes its step label (title if set, else object type), public_story text, photo count, and a 1-hour signed thumbnail URL.',
    security,
    request: { params: z.object({ id: idParam.schema }) },
    responses: {
      200: {
        description: 'Lineage chain ordered root → requested object',
        content: { 'application/json': { schema: LineageResponseSchema } },
      },
      ...errorResponses,
    },
  })

  // ── POST /api/v1/objects/:id/photos ────────────────────────────────────────
  registry.registerPath({
    method: 'post',
    path: '/api/v1/objects/{id}/photos',
    tags: ['Photos'],
    summary: 'Upload a photo',
    description: 'Upload a photo (JPEG, PNG, WebP, or HEIC) to a workshop object via multipart/form-data. The photo is stored in Supabase Storage and a signed URL valid for 1 hour is returned.',
    security,
    request: {
      params: z.object({ id: idParam.schema }),
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.string().openapi({ format: 'binary', description: 'Image file (JPEG, PNG, WebP, or HEIC)' }),
              caption: z.string().optional().openapi({ description: 'Optional photo caption' }),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Uploaded photo record with a 1-hour signed URL',
        content: { 'application/json': { schema: PhotoSchema } },
      },
      400: {
        description: 'Missing file field or non-multipart body',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      ...errorResponses,
    },
  })

  return registry
}

export function generateSpec() {
  const registry = buildRegistry()
  const generator = new OpenApiGeneratorV31(registry.definitions)

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Ringmark API',
      version: '1',
      description: [
        'REST API for Ringmark — a woodturning workshop tracker.',
        '',
        'All endpoints require a Bearer token:',
        '```',
        'Authorization: Bearer <RINGMARK_API_KEY>',
        '```',
        '',
        'Object identifiers (`:id`) accept either a UUID or a workshop ID (e.g. `RH1`, `RH1-2`).',
      ].join('\n'),
    },
    servers: [
      { url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://ringmark.org' },
    ],
  })
}
