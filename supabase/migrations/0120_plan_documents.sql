-- 0120 — plans proposed by the chat are markdown documents, not a new entity.
-- brand_documents already carries markdown (0111), collection (0119) and brand RLS (0021).
-- Plans are inserted with status='pending', so the knowledge worker chunks and embeds them like
-- any other document — searchable with no pipeline of their own.

alter table public.brand_documents drop constraint if exists brand_documents_kind_check;
alter table public.brand_documents
  add constraint brand_documents_kind_check
  check (kind in ('note', 'document', 'image', 'plan'));

-- The chat widget resolves a plan by id; the plans list wants them newest-first per brand.
create index if not exists brand_documents_plan_idx
  on public.brand_documents (brand_id, created_at desc) where kind = 'plan';
