-- SEO growth advisor: a qualitative evaluation + a prioritized list of growth initiatives (blog,
-- landing pages for specific queries, free tools, comparisons, glossary, programmatic). One row per
-- generation → history. The initiatives jsonb carries stable ids so Phase 2 can generate the actual
-- asset (blog outline / landing page / tool spec) for a chosen initiative, stored back in
-- brand_geo_artifacts with source_finding = 'seo:<initiativeId>'.
create table if not exists public.brand_seo_plans (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  grade text,                    -- qualitative overall grade (e.g. "B+")
  evaluation jsonb,              -- { grade, summary, strengths[], weaknesses[] }
  initiatives jsonb,             -- SeoInitiative[] (each with a stable id)
  created_at timestamptz not null default now()
);
create index if not exists brand_seo_plans_brand_created_idx on public.brand_seo_plans (brand_id, created_at desc);

alter table public.brand_seo_plans enable row level security;
create policy "seo plans via brand" on public.brand_seo_plans for select
  using (brand_id in (select public.auth_brand_ids()));
