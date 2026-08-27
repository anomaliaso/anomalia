-- GEO artifacts: the fixes for the gaps the audit finds — a FAQ page, an llms.txt, an Organization
-- JSON-LD block. Deliberately SEPARATE from public.posts: these are not editorial content, they are
-- technical/citability assets tied to a specific audit finding, with their own lifecycle (the user
-- pastes them into their site). Regenerated on demand; each is produced with variants + a reviewer.
create table if not exists public.brand_geo_artifacts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null,              -- 'faq' | 'org_schema' | 'llms_txt'
  title text not null,
  format text not null,            -- 'markdown' | 'jsonld' | 'txt' — how to render/paste the body
  body text not null,              -- ready-to-paste content
  target_path text,                -- where it goes: '/faq', '/llms.txt', 'homepage <head>'
  source_finding text,             -- which audit finding it closes (issue id or 'citation-gap')
  status text not null default 'draft' check (status in ('draft', 'accepted', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists brand_geo_artifacts_brand_created_idx on public.brand_geo_artifacts (brand_id, created_at desc);

alter table public.brand_geo_artifacts enable row level security;
create policy "geo artifacts via brand" on public.brand_geo_artifacts for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
