-- ============================================================
-- Market Mode: private, in-person selling events (craft markets, shows)
--
-- Fully private. Unlike wood_objects and object_photos, these tables are never
-- reachable by anon — there is no public page, no OG card, no sitemap entry —
-- so they get the members-scoped policy and nothing else. If a later feature
-- ever needs to surface any of this publicly, that is a deliberate new policy,
-- not an oversight to be patched in.
--
-- price_cents lives on wood_objects rather than only on the join row because a
-- piece has an asking price independent of any event ("this bowl is $120"),
-- and each event copies it as a starting point.
-- ============================================================

alter table wood_objects
  add column price_cents integer check (price_cents is null or price_cents >= 0);

comment on column wood_objects.price_cents is
  'Optional asking price in cents (single currency — no multi-currency support). '
  'Informational only; Ringmark has no checkout. Default source when adding a '
  'piece to a market event. Never selected in public/anon queries.';

-- ── market_events ────────────────────────────────────────────────────────────

create table market_events (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  name          text not null,
  -- Nullable on purpose: you can start planning a market before the date is fixed.
  event_date    date,
  location_text text,
  notes         text,
  status        text not null default 'planning'
                  check (status in ('planning', 'active', 'completed', 'cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index market_events_account_id_idx on market_events (account_id, event_date);

alter table market_events enable row level security;

create policy "market_events: members full access"
  on market_events
  for all
  to authenticated
  using (
    account_id in (select account_id from account_members where user_id = auth.uid())
  )
  with check (
    account_id in (select account_id from account_members where user_id = auth.uid())
  );

-- ── market_event_items ───────────────────────────────────────────────────────
--
-- One appearance of one piece at one event.
--
-- Deliberately many-to-many: a piece can be taken to three markets before it
-- sells, and each trip can carry a different asking price. "Selected for this
-- market" is a property of the pairing, not of the object — which is why this
-- is a join table with its own price and sold state rather than a flag on
-- wood_objects.

create table market_event_items (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts(id) on delete cascade,
  market_event_id    uuid not null references market_events(id) on delete cascade,
  object_id          uuid not null references wood_objects(id) on delete cascade,
  asking_price_cents integer check (asking_price_cents is null or asking_price_cents >= 0),
  sold               boolean not null default false,
  sold_price_cents   integer check (sold_price_cents is null or sold_price_cents >= 0),
  sold_at            timestamptz,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A piece can't be on the same event twice; the API maps this violation to a
  -- 409 on single add, and to a skip on bulk add.
  unique (market_event_id, object_id)
);

create index market_event_items_event_idx  on market_event_items (market_event_id, sort_order);
create index market_event_items_object_idx on market_event_items (object_id);

alter table market_event_items enable row level security;

create policy "market_event_items: members full access"
  on market_event_items
  for all
  to authenticated
  using (
    account_id in (select account_id from account_members where user_id = auth.uid())
  )
  with check (
    account_id in (select account_id from account_members where user_id = auth.uid())
  );
