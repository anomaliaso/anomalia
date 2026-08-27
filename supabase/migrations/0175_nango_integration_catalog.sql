-- 0175 — Nango catalog: each integration unique key is an App or MCP, with a visibility switch.
-- Brand connections are stored generically so new Nango integrations appear without a code change.

create table if not exists public.nango_integration_registry (
  unique_key text primary key,
  kind text not null check (kind in ('app', 'mcp')),
  visible boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.nango_integration_registry enable row level security;

insert into public.nango_integration_registry (unique_key, kind, visible)
values
  ('google-drive', 'app', true),
  ('notion', 'app', true),
  ('github-app', 'app', true),
  ('google-mail', 'app', true)
on conflict (unique_key) do nothing;

create table if not exists public.brand_nango_connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  nango_integration_id text not null,
  nango_connection_id text not null,
  kind text not null check (kind in ('app', 'mcp')),
  status text not null default 'active'
    check (status in ('active', 'error', 'disconnected')),
  display_name text,
  last_error text,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, nango_integration_id)
);

create index if not exists brand_nango_connections_brand_idx
  on public.brand_nango_connections (brand_id)
  where status <> 'disconnected';

alter table public.brand_nango_connections enable row level security;
create policy "nango connections via brand" on public.brand_nango_connections for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
