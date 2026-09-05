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
  PhotoStateSchema,
  CreateUploadUrlSchema,
  UploadUrlSchema,
  ErrorSchema,
  objectTypeEnum,
  objectStatusEnum,
  MarketEventSchema,
  MarketEventDetailSchema,
  CreateMarketEventSchema,
  PatchMarketEventSchema,
  MarketEventItemSchema,
  MarketEventTotalsSchema,
  AddMarketItemSchema,
  BulkAddMarketItemsSchema,
  BulkAddResultSchema,
  UpdateMarketItemSchema,
  MarkSoldSchema,
  marketEventStatusEnum,
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
  registry.register('PhotoState', PhotoStateSchema)
  registry.register('CreateUploadUrl', CreateUploadUrlSchema)
  registry.register('UploadUrl', UploadUrlSchema)
  registry.register('Error', ErrorSchema)
  registry.register('MarketEvent', MarketEventSchema)
  registry.register('MarketEventDetail', MarketEventDetailSchema)
  registry.register('CreateMarketEvent', CreateMarketEventSchema)
  registry.register('PatchMarketEvent', PatchMarketEventSchema)
  registry.register('MarketEventItem', MarketEventItemSchema)
  registry.register('MarketEventTotals', MarketEventTotalsSchema)
  registry.register('AddMarketItem', AddMarketItemSchema)
  registry.register('BulkAddMarketItems', BulkAddMarketItemsSchema)
  registry.register('BulkAddResult', BulkAddResultSchema)
  registry.register('UpdateMarketItem', UpdateMarketItemSchema)
  registry.register('MarkSold', MarkSoldSchema)

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
        roots: z.enum(['true', 'false']).optional().openapi({
          description: 'If "true", return only root objects (parent_id is null)',
        }),
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
    description: 'Partial update — only pass the fields you want to change. `public_slug` and `account_id` are not accepted. `workshop_id` can be renamed; returns 409 if the new ID is already in use. To publish or unpublish, set `is_published`.',
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
      409: {
        description: 'Workshop ID already in use',
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
    description: 'Permanently deletes the object and removes all associated photo files from storage. ' +
      'Blocked if the object is published (pass `?force=true` to override) or has children (delete/re-parent them first).',
    security,
    request: {
      params: z.object({ id: idParam.schema }),
      query: z.object({
        force: z.enum(['true']).optional().openapi({
          description: 'Pass force=true to delete a published object.',
        }),
      }),
    },
    responses: {
      204: { description: 'Deleted — no content' },
      409: {
        description: 'Object is published (pass ?force=true) or has children that must be removed first',
        content: { 'application/json': { schema: ErrorSchema } },
      },
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

  // ── GET /api/v1/objects/:id/photos ─────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/api/v1/objects/{id}/photos',
    tags: ['Photos'],
    summary: 'List photos for an object',
    description:
      'Returns the live photos attached to the object with signed URLs (valid 1 hour), ordered by sort_order. ' +
      'Soft-deleted photos are excluded unless include_deleted=true.',
    security,
    request: {
      params: z.object({ id: idParam.schema }),
      query: z.object({
        include_deleted: z.coerce.boolean().optional().openapi({
          description: 'Include soft-deleted photos in the response. Their deleted_at will be non-null.',
          example: true,
        }),
      }),
    },
    responses: {
      200: {
        description: 'Photos list',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(PhotoSchema), total: z.number().int() }),
          },
        },
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

  // ── PATCH /api/v1/objects/:id/photos/:photoId ──────────────────────────────
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/objects/{id}/photos/{photoId}',
    tags: ['Photos'],
    summary: 'Update photo caption',
    description: 'Updates the caption on an existing photo. Does not affect the image file, sort order, or any other field. Pass an empty string or null to clear the caption.',
    security,
    request: {
      params: z.object({
        id: idParam.schema,
        photoId: z.string().uuid().openapi({ description: 'Photo UUID' }),
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              caption: z.string().nullable().openapi({ description: 'New caption text. Empty string or null to clear.' }),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated photo record with a 1-hour signed URL',
        content: { 'application/json': { schema: PhotoSchema } },
      },
      400: {
        description: 'Missing or invalid body',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      ...errorResponses,
    },
  })

  // ── DELETE /api/v1/objects/:id/photos/:photoId ─────────────────────────────
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/objects/{id}/photos/{photoId}',
    tags: ['Photos'],
    summary: 'Delete a photo',
    description:
      'Soft-deletes the photo. It drops out of every read path — including the public story page ' +
      'and the OG share card — but the image file is retained so the delete can be reversed with ' +
      'POST /api/v1/objects/{id}/photos/{photoId}/restore. Photo files are only removed outright ' +
      'when the whole object is deleted.',
    security,
    request: {
      params: z.object({
        id: idParam.schema,
        photoId: z.string().uuid().openapi({ description: 'Photo UUID' }),
      }),
    },
    responses: {
      204: { description: 'Soft-deleted — no content' },
      ...errorResponses,
    },
  })

  // ── POST /api/v1/objects/:id/photos/:photoId/restore ───────────────────────
  registry.registerPath({
    method: 'post',
    path: '/api/v1/objects/{id}/photos/{photoId}/restore',
    tags: ['Photos'],
    summary: 'Restore a soft-deleted photo',
    description:
      'Reverses a soft delete, returning the photo to its original sort position. ' +
      'Returns 404 if the photo does not exist or is not currently deleted.',
    security,
    request: {
      params: z.object({
        id: idParam.schema,
        photoId: z.string().uuid().openapi({ description: 'Photo UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Restored photo record with a 1-hour signed URL',
        content: { 'application/json': { schema: PhotoSchema } },
      },
      ...errorResponses,
    },
  })

  // ── Market Events ───────────────────────────────────────────────────────────
  //
  // Private feature — in-person selling events. Nothing under this tag is ever
  // reachable without a credential, and none of it appears on a public page.

  const eventIdParam = z.string().uuid().openapi({ description: 'Market event UUID' })
  const itemIdParam = z.string().uuid().openapi({ description: 'Market event item UUID' })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/market-events',
    tags: ['Market Events'],
    summary: 'List market events',
    description: 'Returns the account\'s market events, most recent first. Filter with ?status.',
    security,
    request: {
      query: z.object({
        status: marketEventStatusEnum.optional().openapi({ description: 'Filter by status' }),
      }),
    },
    responses: {
      200: {
        description: 'Market events list',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(MarketEventSchema), total: z.number().int() }),
          },
        },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/market-events',
    tags: ['Market Events'],
    summary: 'Create a market event',
    description: 'Creates an event in `planning` status. event_date is optional — a market can be planned before its date is fixed.',
    security,
    request: {
      body: { content: { 'application/json': { schema: CreateMarketEventSchema } } },
    },
    responses: {
      201: {
        description: 'Created market event',
        content: { 'application/json': { schema: MarketEventSchema } },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/market-events/{id}',
    tags: ['Market Events'],
    summary: 'Get a market event with its items and totals',
    description:
      'Returns the event, every item on it (with denormalized workshop_id, title, species ' +
      'and a 1-hour signed thumbnail URL), and server-computed totals.',
    security,
    request: { params: z.object({ id: eventIdParam }) },
    responses: {
      200: {
        description: 'Market event with items and totals',
        content: { 'application/json': { schema: MarketEventDetailSchema } },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/market-events/{id}',
    tags: ['Market Events'],
    summary: 'Update a market event',
    security,
    request: {
      params: z.object({ id: eventIdParam }),
      body: { content: { 'application/json': { schema: PatchMarketEventSchema } } },
    },
    responses: {
      200: {
        description: 'Updated market event',
        content: { 'application/json': { schema: MarketEventSchema } },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/market-events/{id}',
    tags: ['Market Events'],
    summary: 'Delete a market event',
    description:
      'Deletes the event and its items. Items cascade at the database level. The pieces ' +
      'themselves are untouched — only the record of them being taken to this market.',
    security,
    request: { params: z.object({ id: eventIdParam }) },
    responses: {
      204: { description: 'Deleted — no content' },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/market-events/{id}/items',
    tags: ['Market Events'],
    summary: 'Add a piece to a market event',
    description:
      'object_id accepts a workshop ID or a UUID. Any object may be added regardless of ' +
      'status or publish state — a market piece does not need a public page. ' +
      'asking_price_cents defaults to the object\'s price_cents. Returns 409 if the piece ' +
      'is already on this event.',
    security,
    request: {
      params: z.object({ id: eventIdParam }),
      body: { content: { 'application/json': { schema: AddMarketItemSchema } } },
    },
    responses: {
      201: {
        description: 'Created market event item',
        content: { 'application/json': { schema: MarketEventItemSchema } },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/market-events/{id}/items/bulk',
    tags: ['Market Events'],
    summary: 'Add several pieces to a market event',
    description:
      'Batch version of the add endpoint — the "go through and select everything you want ' +
      'to take" path. Pieces that do not resolve, or are already on the event, are skipped ' +
      'rather than failing the batch. Status is 200, not 201: this is not a single created ' +
      'resource.',
    security,
    request: {
      params: z.object({ id: eventIdParam }),
      body: { content: { 'application/json': { schema: BulkAddMarketItemsSchema } } },
    },
    responses: {
      200: {
        description: 'Added items plus a per-id reason for anything skipped',
        content: { 'application/json': { schema: BulkAddResultSchema } },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/market-events/{id}/items/{itemId}',
    tags: ['Market Events'],
    summary: 'Update a market event item',
    description: 'Change the asking price or sort order for this piece at this event only.',
    security,
    request: {
      params: z.object({ id: eventIdParam, itemId: itemIdParam }),
      body: { content: { 'application/json': { schema: UpdateMarketItemSchema } } },
    },
    responses: {
      200: {
        description: 'Updated market event item',
        content: { 'application/json': { schema: MarketEventItemSchema } },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/market-events/{id}/items/{itemId}',
    tags: ['Market Events'],
    summary: 'Remove a piece from a market event',
    description: 'Removes the item only. The piece itself is untouched.',
    security,
    request: { params: z.object({ id: eventIdParam, itemId: itemIdParam }) },
    responses: {
      204: { description: 'Removed — no content' },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/market-events/{id}/items/{itemId}/mark-sold',
    tags: ['Market Events'],
    summary: 'Mark a piece sold at this market',
    description:
      'Sets sold, sold_price_cents (defaulting to the asking price) and sold_at — AND ' +
      'updates the underlying object\'s status to `sold`. That status cascade is the one ' +
      'place this feature reaches outside its own tables.',
    security,
    request: {
      params: z.object({ id: eventIdParam, itemId: itemIdParam }),
      body: { content: { 'application/json': { schema: MarkSoldSchema } } },
    },
    responses: {
      200: {
        description: 'Updated market event item',
        content: { 'application/json': { schema: MarketEventItemSchema } },
      },
      ...errorResponses,
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/market-events/{id}/items/{itemId}/unmark-sold',
    tags: ['Market Events'],
    summary: 'Undo a sale',
    description:
      'Clears the sold state and reverts the underlying object\'s status to `for_sale` — ' +
      'unconditionally, not to whatever it was before. A piece taken to a market was ' +
      'almost certainly for sale beforehand, and this avoids a redundant history column.',
    security,
    request: { params: z.object({ id: eventIdParam, itemId: itemIdParam }) },
    responses: {
      200: {
        description: 'Updated market event item',
        content: { 'application/json': { schema: MarketEventItemSchema } },
      },
      ...errorResponses,
    },
  })

  // ── POST /api/v1/objects/:id/photos/upload-url ─────────────────────────────
  registry.registerPath({
    method: 'post',
    path: '/api/v1/objects/{id}/photos/upload-url',
    tags: ['Photos'],
    summary: 'Reserve a direct photo upload',
    description:
      'Reserves a photo record and returns a single-use token for uploading the image bytes ' +
      'straight to PUT /api/upload. Use this instead of the multipart endpoint when the image ' +
      'is large or the client cannot send multipart — the bytes never pass through the caller, ' +
      'only the token does.\n\n' +
      'The reserved record has status `pending` and is excluded from every read path until the ' +
      'bytes arrive. The token is single-use and expires in 15 minutes; an unredeemed ' +
      'reservation is swept automatically.',
    security,
    request: {
      params: z.object({ id: idParam.schema }),
      body: {
        required: true,
        content: { 'application/json': { schema: CreateUploadUrlSchema } },
      },
    },
    responses: {
      201: {
        description: 'Reservation created — upload the bytes to upload_url within the expiry window',
        content: { 'application/json': { schema: UploadUrlSchema } },
      },
      400: {
        description: 'Missing filename or invalid body',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      ...errorResponses,
    },
  })

  // ── GET /api/v1/photos/:photoId ────────────────────────────────────────────
  registry.registerPath({
    method: 'get',
    path: '/api/v1/photos/{photoId}',
    tags: ['Photos'],
    summary: 'Get a single photo, including upload state',
    description:
      'Returns a photo by id, scoped to the caller\'s account. Unlike the per-object photo list ' +
      'this also returns `pending` reservations, so it can answer whether a direct upload landed. ' +
      'A successful PUT /api/upload already returns the finished record, so this is only needed ' +
      'when that response was lost. Read-only — it never consumes or extends a reservation.',
    security,
    request: {
      params: z.object({
        photoId: z.string().uuid().openapi({ description: 'Photo UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Photo record. signed_url is null unless the photo is live.',
        content: { 'application/json': { schema: PhotoStateSchema } },
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
