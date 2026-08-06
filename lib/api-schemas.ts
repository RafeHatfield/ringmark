/**
 * Central Zod schemas for the Ringmark REST API.
 *
 * Single source of truth for both request validation (used in route handlers)
 * and OpenAPI spec generation (used in lib/api-spec.ts).
 *
 * extendZodWithOpenApi() is called here once. Because Node caches modules, this
 * mutation propagates to all subsequent `import { z } from 'zod'` calls.
 */

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)

// ── Enums ─────────────────────────────────────────────────────────────────────

export const objectTypeEnum = z
  .enum([
    'source', 'log', 'chunk', 'slab', 'blank', 'rough_bowl',
    'finished_bowl', 'pen_blank', 'spindle_blank', 'offcut', 'other',
  ])
  .openapi({ description: 'The kind of wood object this represents' })

export const objectStatusEnum = z
  .enum([
    'unknown', 'acquired', 'stored', 'sealed', 'cut', 'drying',
    'rough_turned', 'finished', 'for_sale', 'sold', 'gifted', 'scrapped',
  ])
  .openapi({ description: 'Current state of the object in the workshop lifecycle' })

export const speciesConfidenceEnum = z.enum(['confirmed', 'likely', 'guessed', 'unknown'])
export const lineageConfidenceEnum = z.enum(['exact', 'probable', 'batch_level', 'unknown'])

// ── Full object response ──────────────────────────────────────────────────────

export const WoodObjectSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    workshop_id: z.string().openapi({ example: 'RH1' }),
    workshop_id_lower: z.string().openapi({ example: 'rh1' }),
    object_type: objectTypeEnum,
    status: objectStatusEnum.nullable(),
    title: z.string().nullable().openapi({ example: 'Lynn Valley Big Leaf Maple' }),
    species: z.string().nullable().openapi({ example: 'Bigleaf Maple' }),
    species_confidence: speciesConfidenceEnum.nullable(),
    dimensions_text: z.string().nullable().openapi({ example: '12" × 4"' }),
    finish: z.string().nullable().openapi({ example: 'Walnut oil' }),
    public_slug: z.string().openapi({ example: 'maple-bowl-a1b2c3' }),
    public_title: z.string().nullable().openapi({ example: 'Bigleaf Maple Bowl' }),
    public_story: z.string().nullable(),
    public_notes: z.string().nullable(),
    public_care: z.string().nullable(),
    location_text: z.string().nullable(),
    private_notes: z.string().nullable(),
    is_published: z.boolean(),
    price_cents: z.number().int().nonnegative().nullable().optional().openapi({
      example: 12000,
      description:
        'Optional asking price in cents. Informational only — Ringmark has no ' +
        'checkout. Never appears on public pages.',
    }),
    parent_id: z.string().uuid().nullable(),
    root_id: z.string().uuid().nullable(),
    lineage_confidence: lineageConfidenceEnum.nullable(),
    account_id: z.string().uuid(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('WoodObject')

// ── Summary shape returned in list responses ──────────────────────────────────

export const WoodObjectSummarySchema = z
  .object({
    id: z.string().uuid(),
    workshop_id: z.string().openapi({ example: 'RH1' }),
    object_type: objectTypeEnum,
    status: objectStatusEnum.nullable(),
    title: z.string().nullable(),
    species: z.string().nullable(),
    is_published: z.boolean(),
    updated_at: z.string().datetime(),
  })
  .openapi('WoodObjectSummary')

// ── List response ─────────────────────────────────────────────────────────────

export const ListResponseSchema = z
  .object({
    data: z.array(WoodObjectSummarySchema),
    total: z.number().int().openapi({ example: 42 }),
    limit: z.number().int().openapi({ example: 20 }),
    offset: z.number().int().openapi({ example: 0 }),
  })
  .openapi('WoodObjectList')

// ── Request bodies ────────────────────────────────────────────────────────────

export const CreateObjectSchema = z
  .object({
    object_type: objectTypeEnum.optional().default('source'),
    workshop_id: z
      .string()
      .optional()
      .openapi({ example: 'RH7', description: 'Auto-generated if omitted' }),
    title: z.string().optional().openapi({ example: 'Lynn Valley Maple' }),
    species: z.string().optional().openapi({ example: 'Bigleaf Maple' }),
    status: objectStatusEnum.optional().default('acquired'),
    location_text: z
      .string()
      .optional()
      .openapi({ description: 'Private — never shown on public page' }),
    private_notes: z.string().optional(),
    price_cents: z.number().int().nonnegative().nullable().optional().openapi({
      example: 12000,
      description: 'Optional asking price in cents',
    }),
  })
  .openapi('CreateObject')

export const PatchObjectSchema = z
  .object({
    object_type: objectTypeEnum.optional(),
    status: objectStatusEnum.optional(),
    title: z.string().optional(),
    species: z.string().optional(),
    location_text: z.string().optional(),
    private_notes: z.string().optional(),
    public_title: z.string().optional(),
    public_story: z.string().optional(),
    public_notes: z.string().optional(),
    public_care: z.string().optional(),
    dimensions_text: z.string().optional(),
    finish: z.string().optional(),
    price_cents: z.number().int().nonnegative().nullable().optional().openapi({
      example: 12000,
      description: 'Optional asking price in cents. Pass null to clear.',
    }),
    is_published: z
      .boolean()
      .optional()
      .openapi({ description: 'Set true to publish; false to unpublish' }),
    workshop_id: z
      .string()
      .min(1)
      .optional()
      .openapi({
        example: 'RH3',
        description: 'Rename the workshop ID. Must be unique within the account. Renaming a root does not auto-rename its children — update each child separately.',
      }),
    parent_id: z
      .string()
      .nullable()
      .optional()
      .openapi({ description: 'Workshop ID or UUID of the new parent. Pass null to make this a root object.' }),
    // public_slug, account_id, and workshop_id_lower are intentionally excluded (lower is derived)
  })
  .openapi('PatchObject')

export const CreateChildSchema = z
  .object({
    object_type: objectTypeEnum.openapi({
      description: 'Required — children must have an explicit type',
    }),
    title: z.string().optional(),
    species: z
      .string()
      .optional()
      .openapi({ description: 'Inherited from parent if omitted' }),
    status: objectStatusEnum.optional(),
    private_notes: z.string().optional(),
  })
  .openapi('CreateChild')

// ── Lineage step ─────────────────────────────────────────────────────────────

export const LineageStepSchema = z
  .object({
    id: z.string().uuid(),
    workshop_id: z.string().openapi({ example: 'RH9-1' }),
    object_type: objectTypeEnum,
    step_label: z.string().openapi({ example: 'Cut into slabs', description: 'title if set, else object_type label' }),
    public_story: z.string().nullable().openapi({ description: 'Step narrative shown in the journey timeline' }),
    status: objectStatusEnum.nullable(),
    photo_count: z.number().int().openapi({ example: 3 }),
    thumbnail_url: z.string().nullable().openapi({ description: 'Signed URL for the first public photo, valid 1 hour' }),
  })
  .openapi('LineageStep')

export const LineageResponseSchema = z
  .object({
    steps: z.array(LineageStepSchema).openapi({ description: 'Ancestor chain ordered root → requested object' }),
  })
  .openapi('LineageResponse')

// ── Photo response ────────────────────────────────────────────────────────────

export const PhotoSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    object_id: z.string().uuid(),
    storage_path: z.string().openapi({ example: 'acc-uuid/obj-uuid/photo-uuid.jpg' }),
    caption: z.string().nullable(),
    is_public: z.boolean(),
    sort_order: z.number().int(),
    signed_url: z.string().nullable().openapi({
      description: 'Signed storage URL valid for 1 hour. Null if the URL could not be generated.',
    }),
    created_at: z.string().datetime().nullable(),
    deleted_at: z.string().datetime().nullable().optional().openapi({
      description:
        'Set when the photo has been soft-deleted. Null on live photos. Only ever non-null ' +
        'in list responses requested with ?include_deleted=true.',
    }),
  })
  .openapi('Photo')

// ── Error response ────────────────────────────────────────────────────────────

export const ErrorSchema = z
  .object({
    error: z.string().openapi({ example: 'Object not found' }),
  })
  .openapi('Error')

// ── Market Mode ───────────────────────────────────────────────────────────────
//
// Private feature: in-person selling events. Nothing here is ever exposed on a
// public page, and no schema in this section may be reused in a public response.

export const marketEventStatusEnum = z
  .enum(['planning', 'active', 'completed', 'cancelled'])
  .openapi({ description: 'Lifecycle state of a market event' })

export const MarketEventSchema = z
  .object({
    id: z.string().uuid(),
    account_id: z.string().uuid(),
    name: z.string().openapi({ example: 'Lynn Valley Farmers Market' }),
    event_date: z.string().nullable().openapi({
      example: '2026-08-16',
      description: 'ISO date. Nullable — a market can be planned before its date is fixed.',
    }),
    location_text: z.string().nullable(),
    notes: z.string().nullable(),
    status: marketEventStatusEnum,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi('MarketEvent')

export const CreateMarketEventSchema = z
  .object({
    name: z.string().min(1).openapi({ example: 'Lynn Valley Farmers Market' }),
    event_date: z.string().optional().openapi({ example: '2026-08-16' }),
    location_text: z.string().optional(),
    notes: z.string().optional(),
  })
  .openapi('CreateMarketEvent')

export const PatchMarketEventSchema = z
  .object({
    name: z.string().min(1).optional(),
    event_date: z.string().nullable().optional(),
    location_text: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    status: marketEventStatusEnum.optional(),
  })
  .openapi('PatchMarketEvent')

/**
 * A piece's appearance at one event, with display fields denormalized so a
 * caller never needs a second round trip to render a market list.
 */
export const MarketEventItemSchema = z
  .object({
    id: z.string().uuid(),
    market_event_id: z.string().uuid(),
    object_id: z.string().uuid(),
    asking_price_cents: z.number().int().nonnegative().nullable(),
    sold: z.boolean(),
    sold_price_cents: z.number().int().nonnegative().nullable(),
    sold_at: z.string().datetime().nullable(),
    sort_order: z.number().int(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    // Denormalized from wood_objects for display
    workshop_id: z.string().openapi({ example: 'RH9-4' }),
    title: z.string().nullable(),
    public_title: z.string().nullable(),
    species: z.string().nullable(),
    thumbnail_url: z.string().nullable().openapi({
      description: "Signed URL for the object's first photo, valid 1 hour",
    }),
  })
  .openapi('MarketEventItem')

export const AddMarketItemSchema = z
  .object({
    object_id: z.string().openapi({
      example: 'RH9-4',
      description: 'Workshop ID or UUID',
    }),
    asking_price_cents: z.number().int().nonnegative().nullable().optional().openapi({
      description: "Defaults to the object's price_cents when omitted",
    }),
  })
  .openapi('AddMarketItem')

export const BulkAddMarketItemsSchema = z
  .object({
    object_ids: z.array(z.string()).min(1).max(100).openapi({
      example: ['RH9-4', 'RH12', 'RH3-1'],
      description: 'Workshop IDs or UUIDs',
    }),
  })
  .openapi('BulkAddMarketItems')

export const UpdateMarketItemSchema = z
  .object({
    asking_price_cents: z.number().int().nonnegative().nullable().optional(),
    sort_order: z.number().int().optional(),
  })
  .openapi('UpdateMarketItem')

export const MarkSoldSchema = z
  .object({
    sold_price_cents: z.number().int().nonnegative().optional().openapi({
      description:
        "Defaults to the item's asking_price_cents when omitted — sold at asking " +
        'is the common case; pass a value for a haggled price.',
    }),
  })
  .openapi('MarkSold')

/** Computed server-side per request; never stored. */
export const MarketEventTotalsSchema = z
  .object({
    item_count: z.number().int(),
    sold_count: z.number().int(),
    total_asking_cents: z.number().int(),
    total_sold_cents: z.number().int(),
  })
  .openapi('MarketEventTotals')

export const MarketEventDetailSchema = MarketEventSchema.extend({
  items: z.array(MarketEventItemSchema),
  totals: MarketEventTotalsSchema,
}).openapi('MarketEventDetail')

export const BulkAddResultSchema = z
  .object({
    added: z.array(MarketEventItemSchema),
    skipped: z.array(
      z.object({
        id: z.string(),
        reason: z.string().openapi({ example: 'Already on this event' }),
      })
    ),
  })
  .openapi('BulkAddResult')
