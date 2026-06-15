create table accounts (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  name            text not null default 'My Workshop',
  default_prefix  text not null default 'RH',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index accounts_owner_user_id_idx on accounts (owner_user_id);

alter table accounts enable row level security;
