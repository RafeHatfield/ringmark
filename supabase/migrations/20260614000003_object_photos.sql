create table object_photos (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  object_id     uuid not null references wood_objects(id) on delete cascade,
  storage_path  text not null,
  caption       text,
  is_public     boolean not null default true,
  sort_order    int not null default 0,
  captured_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index object_photos_object_id_idx on object_photos (object_id, sort_order);

alter table object_photos enable row level security;
