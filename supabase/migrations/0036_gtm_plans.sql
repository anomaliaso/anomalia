-- 0036: the GTM (go-to-market) plan — the time-axis strategy layer ABOVE the editorial plan.
-- It answers "where is the brand going, and when": a horizon (90d → 2y) split into phases, each
-- with an objective, platform weights that EVOLVE phase to phase, pillars/CTAs to anchor, and
-- honest, data-calibrated targets. 021 proposes it, the user approves or redirects a phase
-- conversationally; at the end of a phase, real KPIs are compared with the targets and 021
-- proposes a course correction (again: propose → approve). Same lifecycle/lineage pattern as
-- editorial_plans. Phase dates are stamped at activation; done/now/next is DERIVED from dates.
create table public.gtm_plans (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed', 'active', 'superseded', 'rejected')),
  horizon text not null default '6m' check (horizon in ('90d', '6m', '1y', '2y')),
  objective text,           -- the business goal the whole plan optimises for
  phases jsonb not null default '[]'::jsonb,
                            -- [{ index, name, objective, rationale, duration_weeks,
                            --    start_date, end_date (stamped at activation),
                            --    platform_weights:[{platform, percent}],
                            --    pillars:[string], goals:[{kpi, target, why, actual}] }]
  parent_id uuid references public.gtm_plans(id) on delete set null,
  revision_feedback text,   -- the conversational redirect that produced this revision
  reply text,               -- 021's motivated reply to the redirect ("Ok. Ritiro Threads e…")
  changes_summary jsonb,    -- user-facing bullets of what changed vs parent
  source text not null default 'manual'
    check (source in ('manual', 'revision', 'phase_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz
);
create unique index gtm_plans_active_uniq on public.gtm_plans (brand_id) where status = 'active';
create index gtm_plans_brand_idx on public.gtm_plans (brand_id);
alter table public.gtm_plans enable row level security;
create policy "gtm_plans via brand" on public.gtm_plans for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
