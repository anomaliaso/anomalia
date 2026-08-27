-- 0112 — brand_doc_chunks + FTS search RPC (docs/23 §3.2 + §5.2)

create table if not exists public.brand_doc_chunks (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  document_id uuid not null references public.brand_documents(id) on delete cascade,
  idx integer not null,
  heading_path text,
  content text not null,
  tokens integer,
  created_at timestamptz not null default now(),
  tsv tsvector generated always as (
    to_tsvector('simple', coalesce(heading_path, '') || ' ' || content)
  ) stored
);

create index if not exists brand_doc_chunks_doc_idx
  on public.brand_doc_chunks (document_id, idx);
create index if not exists brand_doc_chunks_brand_idx
  on public.brand_doc_chunks (brand_id);
create index if not exists brand_doc_chunks_tsv_idx
  on public.brand_doc_chunks using gin (tsv);
create unique index if not exists brand_doc_chunks_uniq
  on public.brand_doc_chunks (document_id, idx);

alter table public.brand_doc_chunks enable row level security;

drop policy if exists "doc chunks via brand" on public.brand_doc_chunks;
create policy "doc chunks via brand" on public.brand_doc_chunks for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Service role / workers need full access without JWT brand membership.
grant select, insert, update, delete on public.brand_doc_chunks to service_role;
grant select, insert, update, delete on public.brand_doc_chunks to authenticated;

create or replace function public.search_brand_chunks(
  p_brand uuid,
  p_query text,
  p_limit int default 8
)
returns table (
  id uuid,
  document_id uuid,
  heading_path text,
  content text,
  score real,
  title text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.document_id,
    c.heading_path,
    c.content,
    ts_rank(c.tsv, websearch_to_tsquery('simple', p_query))::real as score,
    d.title
  from public.brand_doc_chunks c
  join public.brand_documents d on d.id = c.document_id
  where c.brand_id = p_brand
    and length(trim(p_query)) > 0
    and c.tsv @@ websearch_to_tsquery('simple', p_query)
  order by score desc
  limit greatest(1, least(coalesce(p_limit, 8), 30));
$$;

grant execute on function public.search_brand_chunks(uuid, text, int) to authenticated;
grant execute on function public.search_brand_chunks(uuid, text, int) to service_role;
