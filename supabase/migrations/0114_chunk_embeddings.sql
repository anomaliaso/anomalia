-- 0114 — chunk embeddings + k-NN match RPC (docs/23 §3.4 + §5.2 Fase 5)
-- Hybrid retrieval: FTS (search_brand_chunks) + vector (match_brand_chunks), fused with RRF in app.

create extension if not exists vector;

alter table public.brand_doc_chunks
  add column if not exists embedding vector(768);

create index if not exists brand_doc_chunks_embedding_idx
  on public.brand_doc_chunks
  using hnsw (embedding vector_cosine_ops);

-- k-NN over chunk embeddings (cosine distance). security invoker → RLS still applies.
create or replace function public.match_brand_chunks(
  p_brand uuid,
  p_embedding vector(768),
  p_limit int default 30
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
  order by c.embedding <=> p_embedding
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

grant execute on function public.match_brand_chunks(uuid, vector, int) to authenticated;
grant execute on function public.match_brand_chunks(uuid, vector, int) to service_role;
