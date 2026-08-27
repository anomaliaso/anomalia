-- 0118 — review fixes on the knowledge stack (docs/23):
--   1. bump_memory_usage: one round trip + atomic increment (was 2 queries per entry, per prompt)
--   2. set_chunk_embeddings: one round trip for a whole document (was N unbounded UPDATEs)
--   3. match_brand_chunks: minimum cosine similarity, so RRF stops fusing pure noise

-- 1 ─────────────────────────────────────────────────────────────────────────
create or replace function public.bump_memory_usage(p_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.brand_memory
     set use_count = coalesce(use_count, 0) + 1,
         last_used_at = now()
   where id = any(p_ids);
$$;

grant execute on function public.bump_memory_usage(uuid[]) to authenticated;
grant execute on function public.bump_memory_usage(uuid[]) to service_role;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- p_rows: [{"id": "<uuid>", "e": "[0.1,0.2,…]"}] — the vector arrives as its text literal.
create or replace function public.set_chunk_embeddings(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  with data as (
    select (r->>'id')::uuid as id, (r->>'e')::vector(768) as e
      from jsonb_array_elements(p_rows) r
  )
  update public.brand_doc_chunks c
     set embedding = d.e
    from data d
   where c.id = d.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.set_chunk_embeddings(jsonb) to authenticated;
grant execute on function public.set_chunk_embeddings(jsonb) to service_role;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- Drop first: adding a defaulted parameter would create an overload, and the app's 3-arg call
-- would keep resolving to the old, threshold-less function.
drop function if exists public.match_brand_chunks(uuid, vector, int);

create or replace function public.match_brand_chunks(
  p_brand uuid,
  p_embedding vector(768),
  p_limit int default 30,
  p_min_score real default 0.5
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
  order by c.embedding <=> p_embedding
  limit greatest(1, least(coalesce(p_limit, 30), 50));
$$;

grant execute on function public.match_brand_chunks(uuid, vector, int, real) to authenticated;
grant execute on function public.match_brand_chunks(uuid, vector, int, real) to service_role;
