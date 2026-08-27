-- 0024: scrapecreators near-permanent cache + per-brand scrape handles + visual style.
-- scrapecreators_cache is GLOBAL per (platform, handle) — not brand-scoped — so onboarding can
-- scrape a profile before the brand row exists and never pay for the same handle twice. Only
-- service-role (createAdminClient) touches it: RLS on with no policies = locked to service role.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-04 via MCP.
create table public.scrapecreators_cache (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  handle text not null,
  posts jsonb not null,
  post_count int not null default 0,
  fetched_at timestamptz not null default now(),
  unique (platform, handle)
);
alter table public.scrapecreators_cache enable row level security;

-- The scrape targets a brand declared (in onboarding/settings): which handle to pull per platform.
-- Separate from social_accounts (Zernio-connected accounts for publishing).
create table public.brand_social_handles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text not null,
  username text,
  profile_url text,
  created_at timestamptz not null default now(),
  unique (brand_id, platform)
);
create index brand_social_handles_brand_idx on public.brand_social_handles (brand_id);
alter table public.brand_social_handles enable row level security;
create policy "brand_social_handles via brand" on public.brand_social_handles for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Visual-style brief synthesised from past post thumbnails; injected into image generation.
alter table public.brand_kit add column if not exists visual_style text;
