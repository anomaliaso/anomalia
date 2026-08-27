-- 0113 — core memory fields + knowledge edges (docs/23 §3.3)

alter table public.brand_memory
  add column if not exists pinned boolean not null default false,
  add column if not exists importance smallint not null default 3,
  add column if not exists last_used_at timestamptz,
  add column if not exists use_count integer not null default 0;

do $$ begin
  alter table public.brand_memory
    add constraint brand_memory_importance_check
    check (importance between 1 and 5);
exception when duplicate_object then null; end $$;

create index if not exists brand_memory_core_idx
  on public.brand_memory (brand_id, pinned desc, importance desc, confidence desc);

create table if not exists public.brand_knowledge_edges (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  src_kind text not null,
  src_id uuid not null,
  dst_kind text not null,
  dst_id uuid not null,
  rel text not null,
  weight real not null default 1.0,
  confidence real not null default 0.7,
  evidence_chunk_id uuid references public.brand_doc_chunks(id) on delete set null,
  created_by text not null default 'ai',
  created_at timestamptz not null default now()
);

create unique index if not exists brand_knowledge_edges_uniq
  on public.brand_knowledge_edges (brand_id, src_kind, src_id, dst_kind, dst_id, rel);
create index if not exists brand_knowledge_edges_src_idx
  on public.brand_knowledge_edges (brand_id, src_kind, src_id);
create index if not exists brand_knowledge_edges_dst_idx
  on public.brand_knowledge_edges (brand_id, dst_kind, dst_id);

alter table public.brand_knowledge_edges enable row level security;

drop policy if exists "knowledge edges via brand" on public.brand_knowledge_edges;
create policy "knowledge edges via brand" on public.brand_knowledge_edges for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

grant select, insert, update, delete on public.brand_knowledge_edges to service_role;
grant select, insert, update, delete on public.brand_knowledge_edges to authenticated;
