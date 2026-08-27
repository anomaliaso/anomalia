-- 0174 — Drive folders + Notion pages must be picked per brand before ingest/live read.

comment on column public.brand_knowledge_sources.settings is
  'Provider-specific options. GitHub: { "repos": ["owner/name"] }. Drive: { "folders": [{ "id", "name" }] }. Notion: { "pages": [{ "id", "title", "kind" }] }.';

update public.brand_knowledge_sources
set status = 'active', last_error = null, updated_at = now()
where provider in ('google-drive', 'notion')
  and status in ('pending_sync', 'syncing', 'error')
  and (
    (provider = 'google-drive' and coalesce(settings->'folders', '[]'::jsonb) = '[]'::jsonb)
    or (provider = 'notion' and coalesce(settings->'pages', '[]'::jsonb) = '[]'::jsonb)
  );

delete from public.brand_documents
where source_id in (
  select id from public.brand_knowledge_sources
  where provider = 'google-drive'
    and coalesce(settings->'folders', '[]'::jsonb) = '[]'::jsonb
);

delete from public.brand_documents
where source_id in (
  select id from public.brand_knowledge_sources
  where provider = 'notion'
    and coalesce(settings->'pages', '[]'::jsonb) = '[]'::jsonb
);
