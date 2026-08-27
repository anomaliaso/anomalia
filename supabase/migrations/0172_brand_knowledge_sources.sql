-- 0172 — Nango knowledge sources: Drive / Notion / GitHub / Gmail → brand_documents.
-- Tokens stay in Nango; we persist connection ids and ingest into the existing corpus.

create table if not exists public.brand_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  provider text not null
    check (provider in ('google-drive', 'notion', 'github', 'google-mail')),
  nango_connection_id text not null,
  nango_integration_id text not null,
  status text not null default 'pending_sync'
    check (status in ('pending_sync', 'syncing', 'active', 'error', 'disconnected')),
  display_name text,
  last_sync_at timestamptz,
  last_error text,
  docs_ingested integer not null default 0,
  sync_started_at timestamptz,
  connected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, provider)
);

create index if not exists brand_knowledge_sources_sync_idx
  on public.brand_knowledge_sources (status, last_sync_at)
  where status in ('pending_sync', 'syncing', 'active', 'error');

alter table public.brand_knowledge_sources enable row level security;
create policy "knowledge sources via brand" on public.brand_knowledge_sources for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

alter table public.brand_documents
  add column if not exists source_id uuid references public.brand_knowledge_sources(id) on delete set null,
  add column if not exists external_id text;

create unique index if not exists brand_documents_source_external_idx
  on public.brand_documents (brand_id, source_id, external_id)
  where source_id is not null and external_id is not null;

create index if not exists brand_documents_source_idx
  on public.brand_documents (source_id)
  where source_id is not null;
