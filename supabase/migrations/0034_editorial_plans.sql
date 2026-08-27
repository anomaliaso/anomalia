-- 0034: editorial plans — the agency-grade, AI-proposed strategy document that replaces the
-- onboarding "style" questions (mood/tone/frequency/goal). The AI proposes a plan (strategy
-- statement, voice, cadence, platform mix, optional organic go-to-market guidance, 4 rolling
-- weeks of themes); the user approves/revises it; the approved plan then DRIVES recurring
-- generation (each autopilot batch executes one week of it). Unlike brand_strategy (a single
-- research snapshot), plans have a lifecycle: proposed → active → superseded/rejected, with
-- revision lineage (parent_id) so conversational feedback produces a reviewable new proposal.
create table public.editorial_plans (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed', 'active', 'superseded', 'rejected')),
  strategy text,            -- one-paragraph strategy statement (user-editable section)
  voice jsonb,              -- { mood, tone, goal, personality } — replaces the old style-step answers
  cadence text,             -- '3/week' | '5/week' | 'daily' (AI-proposed, clamped to the plan tier)
  platform_mix jsonb,       -- [{ platform, share, role }]
  gtm jsonb,                -- organic go-to-market guidance for 0→1 brands:
                            -- { stage, summary, platform_recs:[{platform, priority, why, organic_potential}], plays[] }
                            -- null for brands with an established social presence
  weeks jsonb not null default '[]'::jsonb,
                            -- 4 × { index, week_start (null until activation), theme, focus,
                            --       content_mix:[{type,count}], rationale, brief, status }
  parent_id uuid references public.editorial_plans(id) on delete set null,
  revision_feedback text,   -- the conversational feedback that produced this revision
  changes_summary jsonb,    -- LLM-written bullets: what changed vs parent (drives the review UI)
  source text not null default 'onboarding'
    check (source in ('onboarding', 'revision', 'rollover', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz
);
-- At most ONE active plan per brand; proposals/history are unbounded.
create unique index editorial_plans_active_uniq on public.editorial_plans (brand_id) where status = 'active';
create index editorial_plans_brand_idx on public.editorial_plans (brand_id);
alter table public.editorial_plans enable row level security;
create policy "editorial_plans via brand" on public.editorial_plans for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Link each generated batch to the editorial week it executes, so the strategy page can show
-- which weeks have been planned/produced. Nullable: legacy brands and ad-hoc batches stay untagged.
alter table public.content_plans add column if not exists editorial_plan_id uuid
  references public.editorial_plans(id) on delete set null;
alter table public.content_plans add column if not exists editorial_week int;
