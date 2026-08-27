-- 0014 usage: per-brand monthly post and video quota tracking (hard cap).
-- One row per brand per month; the app reads it to enforce plan quotas and to
-- render the "X / quota posts this month" indicator on the Content page.
-- NOT YET APPLIED — written for review; apply via MCP and record the project/date here.

create table if not exists public.brand_usage (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- First day of the month (YYYY-MM-01) anchored to the brand's wall-clock timezone,
  -- so a brand near a date-line boundary rolls over on its own local 1st, not UTC's.
  month date not null,
  posts_count int not null default 0, -- cumulative posts created this month (counts against plan quota)
  videos_count int not null default 0, -- cumulative videos created this month (internal guardrail, invisible to user)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, month)
);

-- Lookups are always (brand_id, month) — the same shape as the unique constraint,
-- but an explicit index keeps the per-request getUsage read cheap.
create index if not exists brand_usage_brand_month_idx on public.brand_usage (brand_id, month);

alter table public.brand_usage enable row level security;
drop policy if exists "brand_usage via brand" on public.brand_usage;
create policy "brand_usage via brand" on public.brand_usage for all
  using (brand_id in (select public.auth_brand_ids())) with check (brand_id in (select public.auth_brand_ids()));
