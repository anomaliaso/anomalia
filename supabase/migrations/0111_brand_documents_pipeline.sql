-- 0111 — brand_documents pipeline: status, markdown, metadata (docs/23 §3.1)
-- Existing rows stay readable via content_text; markdown becomes the new source of truth.

alter table public.brand_documents
  add column if not exists status text not null default 'ready',
  add column if not exists markdown text,
  add column if not exists source_type text,
  add column if not exists source_url text,
  add column if not exists bytes integer,
  add column if not exists page_count integer,
  add column if not exists sha256 text,
  add column if not exists error text,
  add column if not exists processed_at timestamptz,
  add column if not exists chunk_count integer not null default 0,
  add column if not exists summary text,
  add column if not exists attempts integer not null default 0,
  add column if not exists processing_started_at timestamptz;

do $$ begin
  alter table public.brand_documents
    add constraint brand_documents_status_check
    check (status in ('pending','processing','ready','failed'));
exception when duplicate_object then null; end $$;

create index if not exists brand_documents_status_idx
  on public.brand_documents (status, created_at)
  where status in ('pending','processing');

create unique index if not exists brand_documents_sha_idx
  on public.brand_documents (brand_id, sha256)
  where sha256 is not null;

-- Backfill: copy content into markdown; mark non-image docs for chunking once.
update public.brand_documents
   set markdown = coalesce(markdown, content_text),
       source_type = coalesce(
         source_type,
         case when kind = 'note' then 'note' else 'upload' end
       ),
       status = case
         when kind = 'image' then 'ready'
         when coalesce(content_text, '') <> '' then 'pending'
         else status
       end
 where kind <> 'image' or markdown is null or source_type is null;
