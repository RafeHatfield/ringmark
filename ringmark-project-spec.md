# Ringmark — Project Specification

**Version:** 1.1  
**Date:** 2026-06-13  
**Owner / Primary User:** Rafe Hatfield  
**Project Name:** Ringmark  
**Domain:** `ringmark.org` (registered)  
**Primary Goal:** A minimal, mobile-first web app to capture and share the story of wood from source to finished piece — with so little friction that a woodturner will actually use it in the shop.

---

## 1. The Problem

Buyers of handmade woodturning pieces want to know the story. Where did the wood come from? Was it salvaged? What did the log look like? How did it become what they're holding? At a craft show, the maker can tell that story verbally. After the sale, it disappears — unless it was captured somewhere.

The maker's side of the problem is just as real. Wood arrives in messy, irregular ways. Logs sit drying for months. Blanks move between shelves. A finished bowl may have come from a log that was milled two years ago. Remembering, reconstructing, or explaining that journey is nearly impossible without a system.

Most inventory tools solve the wrong problem. They focus on SKUs, cost of goods, ecommerce listings, and accounting. None of them are designed for someone who wants to write a Sharpie ID on a log and photograph it before heading back inside to wash sawdust off their hands.

The core question this product needs to answer:

> Can I preserve the story of a piece of wood with so little overhead that I will actually use it in the shop?

---

## 2. The Solution

Ringmark is a lightweight, mobile-first web app that tracks wood from source to finished piece. It gives each physical object a short human-readable ID that can be written on the wood itself, and an optional QR code that points to a permanent public story page.

The system is designed around two modes of use:

**In the moment** — snap a photo of a freshly cut log, create a record, write the ID on the wood. Takes under a minute.

**End of day / retroactively** — sit down with the pieces you worked on today, find their records by ID, update statuses, upload photos, add notes. The system stays useful even when the workflow isn't perfectly sequential.

The public story page — reached by scanning the QR code on a finished piece — shows the buyer photos from each stage of the journey, the species and source story, finishing details, and care instructions. No login required. No corporate clutter.

The same QR URL, when scanned by the maker while logged in, opens the admin editing view directly.

---

## 3. Name and Domain

**Name:** Ringmark · **Domain:** `ringmark.org` (registered)

A tree's rings are the record of its years — the original log of everything that happened to it. "Mark" carries both meanings this project needs: the physical ID you write on the wood, and the act of recording the story. Short, natural, and it reads well to a buyer who scans a code and lands on `ringmark.org`.

The `.org` extension reads as authentic and non-corporate, which suits the craft angle. If Ringmark later becomes a commercial product, `.org` is unconventional but not a problem — plenty of products run on it. Revisit only if you commercialize.

### Public page URL

Now that the domain is registered, all QR codes should be generated against it from day one so they remain valid forever:

```
https://ringmark.org/p/7Kf29aQ
```

Never ship a QR code pointing at a `*.vercel.app` preview URL — set `NEXT_PUBLIC_APP_URL=https://ringmark.org` before generating any QR you intend to print.

---

## 4. Goals and Non-Goals

### POC Goals

1. Create a source of wood with a short workshop ID.
2. Create child objects (logs, blanks, bowls) from that source.
3. Assign short workshop IDs that can be written on wood with a Sharpie.
4. Auto-generate IDs — manually override when needed.
5. Track parent-child lineage between objects.
6. Upload photos inline at any stage, multiple photos per object.
7. Mark photos as public or private. Default: public.
8. Add private notes and optional public story text per object.
9. Publish a public story page for a finished piece.
10. One QR code per object — same URL for buyer and maker.
11. Logged-in maker sees admin view at that URL; buyer sees public story.
12. Search quickly by workshop ID.
13. Produce useful public pages even when lineage is incomplete.

### POC Non-Goals

The following are explicitly out of scope for the first build:

- Batch child creation (create N children at once) — deferred to v2
- Deferred / bulk photo upload workflows
- Full inventory accounting or cost tracking
- Sales, invoicing, tax, ecommerce integrations
- Customer accounts or buyer registration
- Native mobile apps
- Label printer integration
- Offline-first sync
- AI story generation or species detection
- Multi-user / team workflows
- Subscription billing or marketplace features
- Craft show "prep mode" view
- Public maker portfolio / gallery

These may be valuable later. None are needed to prove whether the core concept works.

---

## 5. Design Principles

### Simple enough for the shop

Every core action must be completable on a phone with one hand while standing at a bench. Hands will be dusty. Attention will be split. If a task requires more than a few taps, it will be skipped.

Required fields: **workshop ID** and **object type**. That is all.

Everything else — species, notes, photos, dimensions, finish, story — is optional and can be added later.

### One physical object, one record

A piece of wood that changes form (blank → rough bowl → finished bowl) is the **same record** with an updated type and status. New photos and notes are added to it over time. This is a **transform**.

A piece of wood that is physically cut into multiple pieces creates **child records**. This is a **split**.

This distinction keeps the data model intuitive and prevents explosion of records.

### One QR, two experiences

```
/p/{public_slug}
```

- Anonymous visitor + published → public story page
- Anonymous visitor + unpublished → simple "not yet published" placeholder
- Logged-in owner → admin object view (full edit access)

The public slug must never grant edit access. Authorization is always verified server-side.

### IDs are for humans; slugs are for machines

The workshop ID (`RH1`, `RH1-4`) is what gets written on wood and searched for. It must be short, readable, and writable by hand.

The public slug (`7Kf29aQ`) is opaque, stable, and used only in URLs and QR codes. It never changes, even if the workshop ID is edited.

### Lineage without perfection

The system should be useful even when provenance is partially unknown. Confidence levels communicate uncertainty honestly to buyers without being off-putting.

---

## 6. Key Workflows

### A. New source arrives

You bring home a load of logs from a backyard maple tree.

1. Open the app.
2. Tap **Add Source**.
3. App suggests `RH1`. Accept or edit.
4. Add optional title: `Backyard maple — Lynn Valley`.
5. Upload a photo or two (car full of logs, pile in the garage, etc.).
6. Save.

Minimum viable record: workshop ID `RH1`, type `source`. Done in under 60 seconds.

### B. Cut logs from the source

Source `RH1` is cut into logs.

1. Open `RH1`.
2. Tap **Add Child**.
3. Type: `log`. 
4. App suggests `RH1-1`. Accept or edit.
5. Upload a photo.
6. Save. Write `RH1-1` on the log.
7. Repeat for `RH1-2`, etc.

### C. Cut blanks from a log

Log `RH1-1` is cut into blanks at the bandsaw.

1. Open `RH1-1`.
2. Tap **Add Child**.
3. Type: `blank`.
4. App suggests `RH1-3` (next available under root `RH1`).
5. Upload photo of blank. Save. Write `RH1-3` on the blank.
6. Repeat for the next blank: `RH1-4`.

### D. Turn a blank into a rough bowl

Blank `RH1-3` goes on the lathe.

1. Search `RH1-3` (or browse to it).
2. Change type to `rough bowl`.
3. Change status to `rough turned`.
4. Upload photo(s) of the rough form.
5. Save.

Same record, updated. No new ID needed.

### E. Finish a bowl

`RH1-3` is final-turned, sanded, and oiled weeks later.

1. Open `RH1-3`.
2. Change type to `finished bowl`.
3. Change status to `finished`.
4. Upload final photos (multiple — hero shot, interior, bottom, grain detail).
5. Add dimensions, finish, and optional public story.
6. Save.

### F. Publish the public story

Bowl is ready for a craft show.

1. Open `RH1-3`.
2. Tap **Edit Public Story**.
3. Write a short public story. App pre-fills species/finish/source title as reference.
4. Confirm which photos are public (all are public by default; mark any private).
5. Add care instructions (or use default).
6. Tap **Publish**.
7. Download QR card as PNG. Print and attach to the bowl.

### G. Buyer scans the QR

Buyer's phone opens `/p/{slug}`. They see:

- Hero photo
- Object title
- Short story
- Journey photos (labelled by stage)
- Species / source / finish / dimensions
- Care instructions
- Maker attribution

They do **not** see: private notes, internal cost, unpublished photos, admin controls.

### H. Maker scans the same QR

Maker's phone opens `/p/{slug}` while logged in. App detects auth and redirects to the admin object view. Full edit access.

### I. Retroactive lineage

This will happen often, especially early on.

Example: you finish a bowl, realize you have no record for it. You know it came from blank `RH1-3`, or you know it's in the `RH1` lineage but you're not sure which blank.

1. Search `RH1` — see all children.
2. Find the blank you used (or create one retroactively if needed).
3. Open that blank. Tap **Add Child** to create the bowl.
4. Upload all the photos at once, assign captions.
5. Publish.

The app should make this equally viable as the "as-you-go" workflow. The key: creating a child from an existing object is always available, not just immediately after a split.

---

## 7. ID Strategy

### Three identifiers per object

| Identifier | Format | Purpose | Stable? |
|---|---|---|---|
| Database ID | UUID | Internal key | Yes |
| Workshop ID | `RH1`, `RH1-4` | Human label, written on wood | Can be edited |
| Public slug | `7Kf29aQ` | URL/QR code | Yes, never changes |

### Workshop ID rules

- Root sources: `RH1`, `RH2`, `RH3`, ...
- Descendants: `RH1-1`, `RH1-2`, `RH1-3`, ...
- Suffix is a **flat counter within the root** — it does not encode the parent path
- The database stores actual lineage; the ID stays short
- Case-insensitive; always displayed uppercase
- Unique per account
- Auto-generated by default; manually overridable
- Must not encode full tree depth (never `RH1-2-1-4`)

### ID generation logic

```
Root sources:   RH + next available root number
                e.g. RH1, RH2, RH3

Descendants:    RH{root_number} + "-" + next available descendant number under that root
                e.g. if RH1-1, RH1-2, RH1-3 exist → next is RH1-4
                Even if RH1-4 is a child of RH1-2 (not RH1 directly)
```

### ID examples showing flat numbering

```
RH1           Source: backyard maple
  RH1-1       Log from RH1
  RH1-2       Log from RH1
    RH1-3     Blank from RH1-1     ← suffix 3, not 1-1
    RH1-4     Blank from RH1-1     ← suffix 4, not 1-2
      RH1-5   Finished bowl from RH1-3  ← suffix 5, not 1-1-1
```

The database knows the tree. The IDs stay short.

### Root ID: should `RH1` be the source or `RH1-0`?

Recommendation: `RH1` **is** the source. Children start at `RH1-1`. This feels most natural. There is no `RH1-0`.

### Collision handling

If the user manually enters an ID that already exists:

> "`RH1-4` already exists. [Open existing] or [Choose another ID]"

Never silently overwrite.

---

## 8. Data Model

Intentionally lean for the POC. Future-ready through `account_id` on all tables and RLS from day one.

### `accounts`

```sql
id                    uuid primary key
owner_user_id         uuid  -- Supabase auth user
name                  text
default_prefix        text  -- e.g. 'RH'
created_at            timestamptz
updated_at            timestamptz
```

For the POC, this table has one row. The UI never shows account-switching.

**Account bootstrap (important — this is how the single account gets created):** The `accounts` table starts empty. On first login, the app must ensure an account exists for the authenticated user. Implement this as a server-side check that runs after auth: look up an account where `owner_user_id = auth.uid()`; if none exists, create one with `name` = a sensible default (the maker can edit it later) and `default_prefix = 'RH'`. Every subsequent request derives the active `account_id` from this lookup. Do this with a server-side helper (e.g. `getOrCreateAccount()`) called in the admin layout, not from client code. The `name` field is what appears as "Made by ___" on public pages, so surface a way to edit it (a simple settings field is enough).

### `wood_objects`

The central table. Represents any physical piece of wood at any stage.

```sql
id                    uuid primary key
account_id            uuid not null
workshop_id           text not null           -- 'RH1', 'RH1-4'
workshop_id_lower     text not null           -- lowercase, for search uniqueness
public_slug           text not null unique    -- opaque, stable, URL-safe
object_type           text not null           -- see types below
status                text                    -- see statuses below
title                 text                    -- optional human title
species               text
species_confidence    text                    -- confirmed | likely | guessed | unknown
parent_id             uuid references wood_objects(id)
root_id               uuid references wood_objects(id)  -- source root, for ID gen + grouping; a source points to its OWN id
lineage_confidence    text                    -- exact | probable | batch_level | unknown
dimensions_text       text                    -- freeform, e.g. '12" × 3.5"'
finish                text
location_text         text                    -- private: where it is in the shop
private_notes         text                    -- never exposed publicly
public_notes          text                    -- optional additional public text
public_title          text                    -- buyer-facing title
public_story          text                    -- buyer-facing story paragraph
public_care           text                    -- care instructions
is_published          boolean default false
created_at            timestamptz
updated_at            timestamptz
```

**Unique constraint:** `(account_id, workshop_id_lower)` — prevents duplicate IDs within an account.

**Index:** `(account_id, root_id)` — for fast ID generation (find max suffix under a root).

**`root_id` rule:** A source object's `root_id` is set to its **own `id`** (set it immediately after insert, or in the same transaction). Every descendant inherits the same `root_id` as its parent. This makes "find everything under root X" a single uniform query (`WHERE root_id = X`) whether X is the source or you're counting descendants for ID generation. A source's `parent_id` is `null`; its `root_id` is itself.

### `object_photos`

Photos attached to an object. Multiple per object. No separate events table in the POC — captions carry the stage context.

```sql
id                    uuid primary key
account_id            uuid not null
object_id             uuid not null references wood_objects(id)
storage_path          text not null           -- Supabase Storage path
caption               text                    -- e.g. 'Freshly cut blank', 'After rough turning'
is_public             boolean default true    -- public by default
sort_order            int default 0
captured_at           timestamptz             -- optional, from EXIF or manual entry
created_at            timestamptz
updated_at            timestamptz
```

> **Key decision vs ChatGPT spec:** Photos default to **public**. The maker needs to explicitly mark a photo private. This prevents the common mistake of publishing a bowl with no photos because the default was private and the toggle was never flipped.

> **Why no `object_events` table in the POC:** Events add a second layer of data entry (create event, then attach photo to event) that is unnecessary friction. A photo with a caption ("Rough turned — March 2026") tells the same story with one step instead of two. Events can be added in v2 if the timeline display becomes important enough to warrant it.

### Object Types

```
source          A batch of wood from one origin (a tree, a pile, a friend's stack)
log             A section of a trunk or large branch
chunk           A roughly sized piece, not yet turned
slab            A flat milled piece
blank           Ready to mount on lathe
rough_bowl      Rough-turned and set to dry
finished_bowl   Complete
pen_blank       Small blank for pen turning
spindle_blank   Blank for spindle work
offcut          Offcut or scrap with potential
other           Anything that doesn't fit the above
```

### Object Statuses

```
unknown         Default when status isn't set
acquired        Just obtained
stored          Sitting in inventory
sealed          End-grain sealed for drying
cut             Cut but not yet turned
drying          Drying after rough turn or milling
rough_turned    On the rough-turn stage
finished        Complete piece
for_sale        Ready to sell
sold            Gone
gifted          Given away
scrapped        Not usable
```

### Lineage and Species Confidence

```
Lineage:   exact | probable | batch_level | unknown
Species:   confirmed | likely | guessed | unknown
```

Public story text adapts to confidence level:

```
exact:        "This bowl was turned from this specific maple log."
probable:     "This bowl most likely came from this maple log."
batch_level:  "This bowl came from a batch of maple from a North Vancouver backyard."
unknown:      "This bowl was turned from salvaged hardwood from the shop collection."
```

### Row Level Security

Apply RLS from day one:

- Owner reads/writes all own data
- Public can only read explicitly public fields on published objects (via a safe view or carefully scoped API query, never direct table access)
- Storage buckets: private bucket for all photos, with signed URLs for public photos on published objects

---

## 9. Screen Inventory

### Admin screens (logged-in only)

| Screen | Route | Purpose |
|---|---|---|
| Home / Search | `/` | Entry point; search, recents, quick actions |
| Object Detail | `/objects/[id]` | Full admin view of one wood object |
| Create Object | `/objects/new` | Create a source or standalone object |
| Edit Object | `/objects/[id]/edit` | Edit all fields |
| Add Child | `/objects/[id]/child/new` | Create one child from an existing object |
| Edit Public Story | `/objects/[id]/story` | Prepare and publish buyer-facing page |
| QR Card | `/objects/[id]/qr` | Generate and download QR |

### Public screen (no login required)

| Screen | Route | Purpose |
|---|---|---|
| Public Story | `/p/[slug]` | Buyer-facing story page |

The `/p/[slug]` route checks auth server-side. If the logged-in user owns the object, redirect to `/objects/[id]`. Otherwise render the public page (if published) or the unpublished placeholder.

---

## 10. Screen Details

### Home / Search (`/`)

**Purpose:** Get to any object fast.

- Prominent search box at top, auto-focused on load
- Search is case-insensitive, matches workshop ID (`rh1-4` finds `RH1-4`)
- Also matches title text as secondary match
- Recent objects list (last 10 accessed or modified)
- **[+ Add Source]** button — most common first action
- **[+ Add Object]** button — for adding without a known parent
- Empty state: "No pieces yet. Add your first source to get started."

### Object Detail (`/objects/[id]`)

**Purpose:** Full view of one wood object, primary admin screen.

**Top bar:**
- Workshop ID (large, prominent — this is the primary identifier)
- Type badge + Status badge
- Published/Unpublished indicator

**Quick action buttons (always visible):**
- Add Photo
- Add Child
- Edit
- [Share / QR] → opens QR card

**Sections:**
- **Lineage** — Parent link (if any); list of children (if any); lineage confidence note
- **Photos** — Gallery grid; each photo shows caption and public/private badge; tap to expand; upload button inline
- **Details** — Species, dimensions, finish, location (private), private notes
- **Public Story** — Summary of what's published (or "Not published yet"); [Edit Public Story] button
- **QR / Public URL** — Shows the `/p/{slug}` URL; [Download QR] button; [Preview Public Page] link

### Create Object / Add Child

**Purpose:** Fast record creation.

For **Add Source** (no parent):
- Workshop ID (pre-filled with next root ID, e.g. `RH3`)
- Type (default: `source`)
- Title (optional)
- Species (optional)
- Private notes (optional)
- Photos (optional inline upload — can add multiple)
- [Save]

For **Add Child** (called from a parent object):
- Parent (pre-filled and locked to the current object)
- Workshop ID (pre-filled with next available descendant, e.g. `RH1-5`)
- Type (must choose — no default, force a conscious decision)
- Status (optional; can default based on type)
- Title (optional)
- Photos (optional inline upload)
- Private notes (optional)
- [Save]

**Important:** The child form is deliberately minimal. More fields can be added after saving. The goal is to make "capture this piece right now" take under 20 seconds.

### Edit Public Story (`/objects/[id]/story`)

**Purpose:** Prepare the buyer-facing page.

Left/top — Reference panel (admin-only, never published):
- Full lineage summary
- All private notes
- All photos (with public/private toggle)

Right/bottom — Public story editor:
- Public title
- Public story (freeform text area; auto-suggested from template if blank: "This piece began as {source_title}...")
- Species confirmation (pulled from object, editable)
- Finish
- Dimensions
- Care instructions (default text pre-filled, editable)
- Optional maker note
- Public photo ordering (drag or arrow sort)

Actions:
- [Preview Public Page]
- [Publish] / [Unpublish]

### Public Story Page (`/p/[slug]`)

**Purpose:** Buyer experience. Must feel warm, natural, and minimal.

Layout:
- Hero photo (full width, slightly cropped)
- Object title
- Short story (1–3 paragraphs)
- Journey photos — a simple chronological gallery with captions; staged naturally, not as a "timeline widget"
- Details card — species, source, finish, dimensions
- Care instructions
- Maker attribution (name only — no admin links, no branding clutter)
- Workshop ID shown subtly at bottom (helps connect the physical card to the page)

Design direction for Claude Code: warm, natural, minimal. Off-white background. Serif display typeface for the title. No heavy UI chrome. Should feel like a well-designed product card, not a web app. Fast load is critical — buyers are on mobile at a craft show.

### QR Card (`/objects/[id]/qr`)

- QR code displayed large
- URL shown below
- Workshop ID shown
- Suggested caption text: *"Scan to follow this bowl's journey."* (editable)
- [Download PNG] button
- Simple printable layout (works in browser print)

---

## 11. Technical Stack

### Recommended Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Next.js 14+ (App Router)** | SSR for public pages, server actions for mutations, excellent Supabase integration |
| Hosting | **Vercel** | Zero-config Next.js deployment, free tier sufficient for POC |
| Database | **Supabase Postgres** | Relational model, hosted, free tier, excellent JS client |
| Auth | **Supabase Auth** | Email magic link or email+password; one user only for POC |
| Storage | **Supabase Storage** | Photo storage, access control via RLS, signed URLs |
| Authorization | **Supabase RLS + server-side checks** | Belt-and-suspenders: RLS in DB, ownership check in server action |
| UI components | **shadcn/ui + Tailwind CSS** | Fastest path to a real, functional UI without custom CSS; accessible by default |
| QR generation | **`qrcode` npm package** | Simple, well-maintained, no dependencies |
| Image handling | **`browser-image-compression`** | Client-side compress before upload; keeps storage lean |

### Why shadcn/ui for this project

shadcn/ui gives Claude Code real component primitives (dialogs, sheets, badges, image grids) without forcing a design system that fights the warm/minimal aesthetic. Components are copied into the project, so they can be restyled freely. This is significantly faster than building components from scratch while maintaining full design control.

### Stack alternatives considered

- **Remix instead of Next.js:** Remix has cleaner data mutation patterns, but Next.js + Supabase has better community documentation and Claude Code familiarity. Stick with Next.js.
- **PocketBase instead of Supabase:** PocketBase is simpler and fully self-hosted, but requires a VPS. Supabase's free tier + Vercel keeps this at zero infrastructure cost for the POC.
- **Prisma instead of Supabase client:** Adds complexity without benefit given Supabase is already the database. Use `@supabase/supabase-js` directly.

### Project File Structure

Claude Code should scaffold the following structure:

```
ringmark/
├── app/
│   ├── (admin)/                    # Auth-gated routes
│   │   ├── layout.tsx              # Auth check wrapper
│   │   ├── page.tsx                # Home / search
│   │   └── objects/
│   │       ├── new/
│   │       │   └── page.tsx        # Create object
│   │       └── [id]/
│   │           ├── page.tsx        # Object detail
│   │           ├── edit/
│   │           │   └── page.tsx    # Edit object
│   │           ├── child/
│   │           │   └── new/
│   │           │       └── page.tsx # Add child
│   │           ├── story/
│   │           │   └── page.tsx    # Edit public story
│   │           └── qr/
│   │               └── page.tsx    # QR card
│   ├── p/
│   │   └── [slug]/
│   │       └── page.tsx            # Public story page
│   ├── auth/
│   │   └── page.tsx                # Login page
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                         # shadcn/ui components (auto-generated)
│   ├── photo-upload.tsx            # Reusable inline photo upload component
│   ├── workshop-id-input.tsx       # ID input with auto-suggest and collision check
│   ├── lineage-tree.tsx            # Parent/child display
│   ├── photo-gallery.tsx           # Admin photo gallery with public toggle
│   ├── public-gallery.tsx          # Public-facing photo display
│   └── qr-card.tsx                 # QR code display and download
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # Browser Supabase client
│   │   ├── server.ts               # Server Supabase client
│   │   └── middleware.ts           # Auth session refresh
│   ├── id-gen.ts                   # Workshop ID generation logic
│   ├── slug-gen.ts                 # Public slug generation
│   ├── types.ts                    # Shared TypeScript types
│   └── constants.ts                # Object types, statuses, confidence values
├── actions/
│   ├── objects.ts                  # Server actions: create, update, delete objects
│   ├── photos.ts                   # Server actions: upload, update, delete photos
│   └── story.ts                    # Server actions: publish/unpublish
├── supabase/
│   └── migrations/
│       ├── 001_accounts.sql
│       ├── 002_wood_objects.sql
│       ├── 003_object_photos.sql
│       └── 004_rls_policies.sql
├── middleware.ts                   # Next.js auth middleware
└── ...config files
```

### Environment Variables Required

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # server-side only, never exposed to client
NEXT_PUBLIC_APP_URL=             # e.g. https://ringmark.org
```

---

## 12. Security Model

### The primary risk

The one-QR design is the right call, but it requires careful implementation. Knowing or guessing a public slug must never result in edit access or exposure of private data.

### Rules

1. All write operations go through server actions that verify `auth.user()` session server-side.
2. The `/p/[slug]` route reads the object server-side and makes the auth decision before rendering anything.
3. Public page queries select only the explicitly public fields — never `private_notes`, `location_text`, or unpublished photos.
4. RLS is a second layer, not the only layer. Do not rely on RLS alone for security-critical routes.
5. Storage URLs for public photos on published objects use signed URLs with reasonable expiry (e.g. 1 hour), regenerated on page load. Private photo paths are never included in public responses.
6. Never trust `account_id` values sent from the client. Always derive from the server-side session.

### Auth approach for POC

Magic link (email) via Supabase Auth is the simplest path. One user, one email address. No password to forget. Click the link in your email, stay logged in via session cookie.

If you want password-based login instead, Supabase Auth supports it with no extra setup — just a preference call.

**Practical note on session length:** Re-authenticating in a dusty shop — switching to your email app, clicking a link, coming back — is exactly the kind of friction that kills adoption. Configure a long session/refresh-token lifetime in Supabase Auth settings so that in practice you log in once on your phone and effectively never again. The session refresh should happen silently via middleware on each request.

---

## 13. Build Milestones

### Milestone 0 — Skeleton (Day 1)

**Goal:** Deployable app, auth working, can query Supabase.

- Next.js project initialized with App Router
- shadcn/ui configured
- Supabase project created
- Database migrations run (all tables + RLS)
- Auth configured (magic link)
- Basic layout/shell deployed to Vercel
- Environment variables configured

**Done when:** You can log in, the app deploys, and a test query to Supabase returns data.

### Milestone 1 — Object Spine (Days 2–3)

**Goal:** Create and manage wood objects with workshop IDs.

- Create source screen
- Object detail screen (read-only for now)
- Edit object screen
- Workshop ID auto-generation (root IDs)
- Workshop ID manual override
- Duplicate ID prevention and error message
- Search by workshop ID (home screen)
- Recent objects list

**Done when:** You can create `RH1`, search for it, edit it, and the app blocks `RH1` from being created twice.

### Milestone 2 — Lineage (Days 3–4)

**Goal:** Source → log → blank → bowl relationships.

- Parent-child relationship in DB (parent_id + root_id)
- Add Child screen (child form pre-filled with parent context)
- Descendant ID auto-generation (`RH1-3`, `RH1-4`, etc.)
- Lineage display on object detail (parent link, children list)
- Re-parenting via edit (change parent_id)

**Done when:** You can create `RH1`, add child `RH1-1`, add grandchild `RH1-3`, and see the full lineage on each object's detail page.

### Milestone 3 — Photos (Days 4–5)

**Goal:** Inline photo uploads, multiple per object.

- Supabase Storage bucket configured
- Photo upload component (multi-file, client-side compression before upload)
- Photos displayed in gallery on object detail
- Caption input per photo
- Public/private toggle per photo (default: public)
- Delete photo
- Sort order (drag or up/down arrows)

**Done when:** You can upload 3 photos to `RH1-3`, add captions, mark one private, and see only the public ones on the public page.

### Milestone 4 — Public Story + QR (Days 5–7)

**Goal:** The buyer experience, end to end.

- Public story editor screen
- Publish / unpublish action
- Public story page (`/p/[slug]`)
- Auth-routing on `/p/[slug]` (owner → admin, anonymous → public)
- QR code generation (using `qrcode` package)
- QR card screen with download
- Care instructions (default text pre-filled, editable)
- Unpublished placeholder page

**Done when:** You can publish a bowl, scan the QR anonymously and see the story, scan while logged in and get the edit view, and confirm no private notes appear.

### Milestone 5 — Polish + Real-World Usability (Days 7–10)

**Goal:** Make it feel real enough to use at the bench.

- Mobile layout polish (thumb-friendly tap targets, no horizontal scroll)
- Loading states and error handling throughout
- Fast navigation (breadcrumbs, back buttons, home shortcut)
- Empty states with clear calls to action
- Status change shortcut on object detail (no need to go to edit screen)
- PWA manifest (installable to home screen on iOS/Android)
- Basic test: ID generation, duplicate prevention, auth routing

**Done when:** You can complete the full end-to-end scenario in Section 14 below.

---

## 14. Definition of Done

The POC is complete when you can run this scenario without friction:

1. Open the app on your phone while standing at the bench.
2. Create `RH1` — a backyard maple source. Upload two photos. Done in under 60 seconds.
3. Create `RH1-1` as a child log. Upload a photo. Write `RH1-1` on the log.
4. Create `RH1-2` as another log. Upload a photo. Write `RH1-2` on the log.
5. From `RH1-1`, create `RH1-3` as a blank. Upload a photo.
6. From `RH1-1`, create `RH1-4` as a blank. Upload a photo.
7. Later that day: open `RH1-3`. Change type to `rough bowl`. Change status to `rough turned`. Upload a rough-turn photo.
8. Weeks later: open `RH1-3`. Change type to `finished bowl`. Status to `finished`. Upload 3 final photos.
9. Add dimensions and finish to `RH1-3`.
10. Go to Edit Public Story. Write a short story. Confirm care instructions. Publish.
11. Download QR. Print it.
12. Scan the QR from another device (not logged in). Confirm public page looks correct. Confirm no private notes visible.
13. Scan the same QR while logged in. Confirm you land on the admin view.
14. Search `rh1` — confirm all children appear.
15. Mark one photo private on `RH1-3`. Confirm it disappears from the public page.

If this works and the admin experience took under 10 minutes total across all steps, the POC has succeeded.

---

## 15. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Too much data entry → stops using it | Required fields are only ID + type. Everything else is optional and can be added retroactively. |
| ID scheme becomes confusing | Flat descendant numbering. App shows parent/child relationships visually. Manual override always available. |
| Lineage mistakes | Allow re-parenting. Support confidence levels. Don't encode lineage in the ID. |
| Private data appears publicly | Server-side auth checks + RLS. Public queries never select private fields. Test this explicitly. |
| QR links break | Opaque stable slug, not workshop ID in URL. Register and control the domain. |
| Photo storage costs | Client-side compression before upload. Supabase free tier is 1GB — sufficient for POC. |
| Building too much too fast | Each milestone has a concrete done condition. Stop at Milestone 4 if needed — that's already a real product. |

---

## 16. Testing Checklist

These should be verified before declaring the POC done:

**ID generation:**
- [ ] Root IDs increment correctly (`RH1`, `RH2`, `RH3`)
- [ ] Descendant IDs are flat within root (`RH1-1`, `RH1-2` regardless of parent)
- [ ] Manual override works
- [ ] Duplicate IDs are blocked (case-insensitive)

**Auth routing:**
- [ ] Anonymous user cannot access any `/objects/` routes
- [ ] Anonymous user on `/p/[slug]` sees public page (if published)
- [ ] Anonymous user on `/p/[slug]` sees placeholder (if unpublished)
- [ ] Logged-in owner on `/p/[slug]` is redirected to admin view
- [ ] Non-owner (if another account exists) cannot access admin view

**Data privacy:**
- [ ] `private_notes` never appears in any public response
- [ ] Photos marked private do not appear on public page
- [ ] `location_text` never appears in any public response

**Photos:**
- [ ] Multiple photos upload to one object
- [ ] Photos appear in order
- [ ] Caption saves correctly
- [ ] Public/private toggle works
- [ ] Photo deletion works
- [ ] Photos display correctly on public page

---

## 17. Future Opportunities (Not for POC)

Document these so they don't creep in, but are not forgotten:

- **Batch child creation** — "Create 5 blanks from this log" in one action
- **Craft show mode** — filtered view of published, for-sale pieces with QR status
- **AI story assistant** — draft story text from notes; never invent provenance
- **Buyer registration** — optional, post-purchase, unlocks care reminders
- **Public maker portfolio** — all published pieces on one page
- **Custom domain support** — each maker's public pages on their own domain
- **Natural material expansion** — knife makers, furniture makers, jewelers
- **Etsy / Shopify link** — attach a Ringmark page to a product listing
- **Label printer support** — print workshop ID + QR in one action
- **Events/timeline** — structured per-stage history vs flat photo gallery

---

## 18. Claude Code Build Prompt

Use this as the **initial prompt** to kick off the build in Claude Code.

**Recommended model:** Claude Opus 4.8 (`claude-opus-4-8`) for the initial scaffold and the tricky logic (ID generation, the `/p/[slug]` auth routing) where architectural reasoning matters most. Switch to Claude Sonnet 4.6 (`claude-sonnet-4-6`) for faster iteration on later milestones once the structure is set.

---

```
Build a mobile-first single-user web app called Ringmark.

Ringmark helps a woodturner track the journey of wood from source to finished piece, and share that journey with buyers via a QR-linked public story page.

## Stack

- Next.js 14+ with App Router and TypeScript
- Supabase (Postgres + Auth + Storage)
- shadcn/ui + Tailwind CSS
- qrcode npm package for QR generation
- browser-image-compression for client-side photo compression before upload

Deploy target: Vercel. All environment variables listed at the end.

## Core Concept

A piece of wood moves through stages: source → log → blank → rough bowl → finished bowl. Each stage is the SAME database record (updated), unless the wood is physically cut into multiple pieces, in which case child records are created.

Each wood object has three identifiers:

1. UUID (database primary key, internal only)
2. Workshop ID — short, human-readable, written on the wood with Sharpie: `RH1`, `RH1-4`, `RH1-12`
3. Public slug — opaque, stable, URL-safe token used in QR codes: `7Kf29aQ`

Workshop IDs use flat descendant numbering under each root source. RH1 is the source. RH1-1, RH1-2, RH1-3 are descendants (regardless of their actual parent — a grandchild of RH1-1 still gets the next available RH1-{n} suffix). The database stores the actual parent_id. The ID stays short.

Public slugs NEVER change. Workshop IDs CAN be edited. The QR URL uses the public slug, never the workshop ID.

## Database Schema

### accounts
- id uuid pk
- owner_user_id uuid (Supabase auth user)
- name text
- default_prefix text (e.g. 'RH')
- created_at, updated_at

### wood_objects
- id uuid pk
- account_id uuid not null
- workshop_id text not null
- workshop_id_lower text not null (lowercase, for case-insensitive uniqueness)
- public_slug text not null unique
- object_type text not null (source | log | chunk | slab | blank | rough_bowl | finished_bowl | pen_blank | spindle_blank | offcut | other)
- status text (unknown | acquired | stored | sealed | cut | drying | rough_turned | finished | for_sale | sold | gifted | scrapped)
- title text
- species text
- species_confidence text (confirmed | likely | guessed | unknown)
- parent_id uuid references wood_objects(id)
- root_id uuid references wood_objects(id)  -- a SOURCE points to its own id; descendants inherit parent's root_id
- lineage_confidence text (exact | probable | batch_level | unknown)
- dimensions_text text
- finish text
- location_text text (private)
- private_notes text (NEVER exposed publicly)
- public_notes text
- public_title text
- public_story text
- public_care text (default: "Wipe clean with a damp cloth. Do not soak. Do not put in the dishwasher. Refresh with a food-safe oil or wax when the wood looks dry.")
- is_published boolean default false
- created_at, updated_at

UNIQUE constraint on (account_id, workshop_id_lower).

### object_photos
- id uuid pk
- account_id uuid not null
- object_id uuid not null references wood_objects(id)
- storage_path text not null
- caption text
- is_public boolean default TRUE (public by default — do NOT default to private)
- sort_order int default 0
- captured_at timestamptz
- created_at, updated_at

## Row Level Security

Enable RLS on all tables.

Owner policy: authenticated user can select/insert/update/delete rows where account_id matches their account.

Public policy: anonymous users can SELECT from wood_objects WHERE is_published = true, but ONLY the explicitly public fields (id, public_slug, public_title, public_story, public_notes, public_care, species, species_confidence, lineage_confidence, dimensions_text, finish, object_type, root_id). Never expose private_notes, location_text, workshop_id in public queries.

Anonymous users can SELECT from object_photos WHERE is_public = true AND object_id is a published object.

## Auth

Use Supabase Auth with magic link (email) for POC. One user. After login, store session via Supabase's cookie-based session management in Next.js. Configure a long session/refresh-token lifetime so the maker logs in once and stays logged in; refresh the session silently in middleware on each request.

Middleware should protect all routes under /objects/** and /. Redirect unauthenticated users to /auth.

## Account Bootstrap

The accounts table starts empty. Implement a server-side helper getOrCreateAccount() that runs in the admin layout: it looks up an account where owner_user_id = auth.uid(), and if none exists, creates one with default_prefix = 'RH' and a default name. Every server action and page derives the active account_id from this helper, NEVER from client-supplied values. The account name is shown as "Made by ___" on public pages — provide a simple settings field to edit it.

## Root ID Handling

When creating a SOURCE object (no parent): insert the row, then set its root_id to its own id. When creating any child: set parent_id to the parent, and set root_id to the parent's root_id (inherited). This makes "all objects under root X" a single query: WHERE root_id = X. Descendant ID generation counts existing suffixes within root_id.

## Workshop ID Generation Logic (lib/id-gen.ts)

Root source ID:
- Query MAX sequential number in use for this account's root IDs
- Pattern: {prefix}{n} where prefix is the account's default_prefix (e.g. 'RH')
- Next root ID: find max n where workshop_id matches /^{prefix}\d+$/i, increment by 1
- Default if none exist: {prefix}1

Descendant ID:
- Given a root_id, find all workshop_ids in this root's tree
- Parse suffixes: workshop_ids matching /^{prefix}\d+-(\d+)$/i
- Find max suffix number, increment by 1
- Result: {root_workshop_id}-{n}

Manual override: always allowed. Before saving, check uniqueness against workshop_id_lower. If collision, return error.

Public slug generation (lib/slug-gen.ts):
- Generate a random URL-safe string, 8 characters, alphanumeric
- Check uniqueness in wood_objects. Retry if collision (very unlikely but handle it).

## Route and Screen Structure

### /auth
Login page. Email input → Supabase magic link → redirect to /.

### / (admin, auth-gated)
Home/search screen.
- Search input at top (case-insensitive, searches workshop_id_lower and title)
- Results list showing: workshop_id, type, status, title (if set)
- Recent objects (last 10 updated, for this account)
- [+ Add Source] button → /objects/new?type=source
- [+ Add Object] button → /objects/new

### /objects/new (admin)
Create object form.
- Workshop ID input (auto-filled via id-gen, editable)
- Type select (required — no default, user must choose; if ?type=source is in query, pre-select source)
- Parent object search/select (optional — type-ahead search by workshop ID)
- If parent is selected: auto-generate descendant ID
- Title (optional)
- Species + confidence (optional)
- Private notes (optional)
- Photo upload (optional, multi-file, compress before upload, caption per photo)
- [Save] → redirect to /objects/[id]

### /objects/[id] (admin)
Object detail page. This is the main admin screen.

Top: Workshop ID (large), type badge, status badge, published indicator

Quick actions row: [Add Photo] [Add Child] [Edit] [QR Card]

Sections:
1. Lineage: parent link (if any) + children list (if any) + confidence note
2. Photos: grid gallery. Each photo shows caption + public/private badge. Tap to expand. Upload button.
3. Details: species, dimensions, finish, location (private), private notes
4. Public story: shows published status + preview snippet. [Edit Public Story] button.
5. QR: shows public URL + [Download QR] button + [View Public Page] link

Inline status change: tap the status badge to open a quick-change dropdown. No need to go to edit screen.

### /objects/[id]/edit (admin)
Full edit form. Pre-filled with current values. Same fields as create, plus re-parenting (change parent_id).

### /objects/[id]/child/new (admin)
Add child form. Parent pre-filled and displayed (not editable from this form).
- Workshop ID (auto-generated descendant ID, editable)
- Type (required — no default)
- Status (optional)
- Title (optional)
- Photos (optional, multi-file upload with captions)
- Private notes (optional)
- [Save] → redirect to new child's detail page

### /objects/[id]/story (admin)
Public story editor.

Two-column layout on desktop, stacked on mobile:

Left/top (reference, admin-only):
- Full lineage tree (ancestors and children)
- All private notes from this object and its direct ancestors
- All photos with public/private toggle

Right/bottom (public story):
- Public title (editable)
- Public story text area (if empty, pre-fill template: "This piece began as part of [source title or 'a wood source']. Turned by hand and finished with [finish or 'a natural oil finish'].")
- Species (editable, pulled from object)
- Finish (editable)
- Dimensions (editable)
- Care instructions (editable, pre-filled with default)
- Maker note (optional short note)
- Public photo order (list of public photos with up/down arrows)

Actions: [Preview] (opens /p/[slug] in new tab) | [Publish] or [Unpublish]

### /objects/[id]/qr (admin)
QR card view.
- QR code rendered large (pointing to /p/[slug] with full domain)
- Workshop ID displayed
- Public URL shown as text
- Caption text (default: "Scan to follow this piece's journey.", editable)
- [Download PNG] button
- Browser print styles for a clean printable card

### /p/[slug] (public — no auth required)

Server-side logic:
1. Look up object by public_slug
2. Check if current user session exists AND user owns this object
3. If yes → redirect to /objects/[id]
4. If no: if is_published → render public story page
5. If no + not published → render placeholder: "This piece's story hasn't been published yet."

Public page design: warm, natural, minimal. Off-white or warm white background (#FAFAF8 or similar). Serif display typeface for the title (e.g. use a Google Font like Playfair Display or Lora). Clean sans-serif body. No heavy UI chrome. Fast load.

Content:
- Hero image (first public photo, full-width with slight crop)
- Object title (public_title or fallback to species + type)
- Story text (public_story)
- Journey photos: horizontal scroll gallery or stacked grid, each with caption
- Details card: species (with confidence phrasing), source description (adapted by lineage_confidence), finish, dimensions
- Care instructions
- Made by [maker name from account]
- Workshop ID shown small at bottom
- NO admin links, NO navigation bar, NO app chrome

Lineage confidence phrasing on public page:
- exact: "Turned from this specific [species] log."
- probable: "Most likely turned from [species] from [source title]."
- batch_level: "Turned from [species] salvaged from [source title]."
- unknown: "Turned from salvaged [species or 'hardwood'] from the shop collection."

## Component Notes

### photo-upload.tsx
Reusable component. Props: objectId, onUploadComplete.
- Accepts multiple files
- Compress each with browser-image-compression (max 1200px, quality 0.8) before upload
- Upload to Supabase Storage at path: {account_id}/{object_id}/{uuid}.jpg
- After upload, create object_photos record
- Show progress per file
- Show thumbnail preview after upload

### workshop-id-input.tsx
Input that:
- Shows auto-generated ID as default
- Allows override
- On blur/submit: checks uniqueness via server action
- Shows "ID taken" error if collision

## Environment Variables

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL (used for QR code URL generation)

## Implementation Order

Build in this order:
1. Skeleton: auth + database + deployed to Vercel
2. Object creation + workshop ID generation + search
3. Lineage: parent-child relationships + Add Child
4. Photos: upload, gallery, public/private toggle
5. Public story editor + publish + /p/[slug] route + QR

Do not build features from Future Opportunities. Keep it simple. Every screen should be usable on a phone with one hand.
```

---

## 19. Open Decisions

These don't block the build but should be decided on day one:

1. **Magic link vs email+password?** Recommendation: magic link. Simpler for a single user.

2. **Workshop prefix:** `RH` (Rafe Hatfield). Hard-code this as the account's `default_prefix` in the seed data.

3. **Domain:** ✅ `ringmark.org` registered. Set `NEXT_PUBLIC_APP_URL=https://ringmark.org` before generating any QR you intend to print, so codes remain valid forever.

4. **Photo storage path:** `{account_id}/{object_id}/{uuid}.jpg` — this structure makes it easy to add per-account storage quotas later.

5. **Public page framework for photos:** Simple CSS grid or horizontal scroll? Recommendation: stacked vertical layout on mobile (no horizontal scroll). Journey photos feel more natural when you read them top-to-bottom.

---

*Ringmark — every piece remembers where it came from.*
