create table wood_objects (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references accounts(id) on delete cascade,
  workshop_id          text not null,
  workshop_id_lower    text not null,
  public_slug          text not null unique,
  object_type          text not null,
  status               text,
  title                text,
  species              text,
  species_confidence   text,
  parent_id            uuid references wood_objects(id),
  root_id              uuid references wood_objects(id),
  lineage_confidence   text,
  dimensions_text      text,
  finish               text,
  location_text        text,
  private_notes        text,
  public_notes         text,
  public_title         text,
  public_story         text,
  public_care          text default 'Wipe clean with a damp cloth. Do not soak. Do not put in the dishwasher. Refresh with a food-safe oil or wax when the wood looks dry.',
  is_published         boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint wood_objects_unique_workshop_id unique (account_id, workshop_id_lower)
);

-- Fast ID generation: count descendants under a root
create index wood_objects_account_root_idx on wood_objects (account_id, root_id);

-- Fast workshop ID lookup (collision check)
create index wood_objects_workshop_id_lower_idx on wood_objects (account_id, workshop_id_lower);

-- Public slug lookup
create index wood_objects_public_slug_idx on wood_objects (public_slug);

-- Home page recents
create index wood_objects_updated_at_idx on wood_objects (account_id, updated_at desc);

alter table wood_objects enable row level security;
