-- 0173 — Per-source settings (GitHub: which repos belong to this brand).
-- Until a brand picks repos, drop auto-ingested GitHub docs so the AI does not see the whole account.

alter table public.brand_knowledge_sources
  add column if not exists settings jsonb not null default '{}'::jsonb;

comment on column public.brand_knowledge_sources.settings is
  'Provider-specific options. GitHub: { "repos": ["owner/name", ...] }.';

update public.brand_knowledge_sources
set status = 'active', last_error = null, updated_at = now()
where provider = 'github'
  and status in ('pending_sync', 'syncing', 'error')
  and coalesce(settings->'repos', '[]'::jsonb) = '[]'::jsonb;

delete from public.brand_documents
where source_id in (
  select id from public.brand_knowledge_sources
  where provider = 'github'
    and coalesce(settings->'repos', '[]'::jsonb) = '[]'::jsonb
);
