-- 0119 — knowledge at scale (docs/23 §11): collections, language-aware FTS, scoped retrieval.
--   * brand_documents.collection  → the cheapest precision filter: the agent knows the domain
--   * brand_documents.lang / brand_doc_chunks.lang → real stemming instead of 'simple'
--   * search/match RPCs gain collection + document_ids scoping (two-stage retrieval)

alter table public.brand_documents
  add column if not exists collection text,
  add column if not exists lang text;

create index if not exists brand_documents_collection_idx
  on public.brand_documents (brand_id, collection) where collection is not null;

alter table public.brand_doc_chunks
  add column if not exists lang text;

-- The tsv config must follow the document language. A generated column can only see its own row,
-- hence lang denormalized onto the chunk (same reason brand_id already is).
-- Generation expressions are immutable-only: the CASE resolves to a constant regconfig per row.
alter table public.brand_doc_chunks drop column if exists tsv;
alter table public.brand_doc_chunks
  add column tsv tsvector generated always as (
    to_tsvector(
      case lang
        when 'it' then 'italian'::regconfig
        when 'en' then 'english'::regconfig
        when 'es' then 'spanish'::regconfig
        when 'fr' then 'french'::regconfig
        else 'simple'::regconfig
      end,
      coalesce(heading_path, '') || ' ' || content
    )
  ) stored;

create index if not exists brand_doc_chunks_tsv_idx
  on public.brand_doc_chunks using gin (tsv);

-- ── FTS: one constant tsquery per config, OR-ed (index-friendly). A per-row tsquery would
-- ── defeat the GIN index and force a sequential scan.
drop function if exists public.search_brand_chunks(uuid, text, int);

create or replace function public.search_brand_chunks(
  p_brand uuid,
  p_query text,
  p_limit int default 8,
  p_collection text default null,
  p_document_ids uuid[] default null
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
  with q as (
    select
      websearch_to_tsquery('simple', p_query)  as q_simple,
      websearch_to_tsquery('italian', p_query) as q_it,
      websearch_to_tsquery('english', p_query) as q_en,
      websearch_to_tsquery('spanish', p_query) as q_es,
      websearch_to_tsquery('french', p_query)  as q_fr
  )
  select
    c.id,
    c.document_id,
    c.heading_path,
    c.content,
    greatest(
      ts_rank(c.tsv, q.q_simple),
      ts_rank(c.tsv, q.q_it),
      ts_rank(c.tsv, q.q_en),
      ts_rank(c.tsv, q.q_es),
      ts_rank(c.tsv, q.q_fr)
    )::real as score,
    d.title
  from public.brand_doc_chunks c
  join public.brand_documents d on d.id = c.document_id
  cross join q
  where c.brand_id = p_brand
    and length(trim(p_query)) > 0
    and (
      c.tsv @@ q.q_simple or c.tsv @@ q.q_it or c.tsv @@ q.q_en
      or c.tsv @@ q.q_es or c.tsv @@ q.q_fr
    )
    and (p_collection is null or d.collection = p_collection)
    and (p_document_ids is null or c.document_id = any(p_document_ids))
  order by score desc
  limit greatest(1, least(coalesce(p_limit, 8), 30));
$$;

grant execute on function public.search_brand_chunks(uuid, text, int, text, uuid[]) to authenticated;
grant execute on function public.search_brand_chunks(uuid, text, int, text, uuid[]) to service_role;

-- ── k-NN with the same scoping, so hybrid retrieval narrows to the same slice.
drop function if exists public.match_brand_chunks(uuid, vector, int, real);

create or replace function public.match_brand_chunks(
  p_brand uuid,
  p_embedding vector(768),
  p_limit int default 30,
  p_min_score real default 0.5,
  p_collection text default null,
  p_document_ids uuid[] default null
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
    (1 - (c.embedding <=> p_embedding))::real as score,
    d.title
  from public.brand_doc_chunks c
  join public.brand_documents d on d.id = c.document_id
  where c.brand_id = p_brand
    and c.embedding is not null
    and p_embedding is not null
    and (1 - (c.embedding <=> p_embedding)) >= coalesce(p_min_score, 0.5)
    and (p_collection is null or d.collection = p_collection)
    and (p_document_ids is null or c.document_id = any(p_document_ids))
  order by c.embedding <=> p_embedding
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

grant execute on function public.match_brand_chunks(uuid, vector, int, real, text, uuid[]) to authenticated;
grant execute on function public.match_brand_chunks(uuid, vector, int, real, text, uuid[]) to service_role;

-- Memories extracted from documents must not outrank hand-written rules in the core-memory budget.
update public.brand_memory set importance = 2
 where source = 'analysis' and importance = 3 and pinned = false;
