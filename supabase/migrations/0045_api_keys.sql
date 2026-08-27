-- API Keys: long-lived tokens for custom integrations.
-- Keys are hashed (SHA-256) — the raw key is shown only once at creation.

create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  key_hash      text not null unique,
  key_prefix    text not null,                       -- first 12 chars for display
  permissions   jsonb not null default '{"scopes":["read"]}',
  -- permissions shape:
  --   "brand_ids": ["uuid1","uuid2"] | "*"   (* = all current and future brands)
  --   "scopes":    ["read"] | ["read","write"]
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

alter table public.api_keys enable row level security;

-- Users can only see/manage their own keys
create policy "api_keys self manage" on public.api_keys
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index idx_api_keys_hash on public.api_keys(key_hash);
create index idx_api_keys_user on public.api_keys(user_id);
