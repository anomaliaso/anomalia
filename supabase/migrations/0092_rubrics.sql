-- 0092: rubrics — the brand's recurring, recognisable content SERIES ("rubriche"), promoted to a
-- first-class domain object. A rubric is distinct from a content pillar: the pillar is the
-- strategic THEME, the rubric is the repeatable, named FORMAT-bound series that delivers it
-- (e.g. "Dietro le quinte del lab — carousel, 1/week"). The AI proposes 5-8 candidates in one
-- batch; the client edits and approves a subset; approved rubrics then become an authoritative
-- constraint for the editorial plan's weekly content mix and for the batch planner's seeds.
-- Lifecycle mirrors editorial_plans (proposed → approved → superseded/rejected), but MANY rubrics
-- are approved at once — batch_id groups the candidates proposed together, and approving a new
-- set supersedes the previously approved set as a whole.
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  batch_id uuid not null,   -- the proposal generation this rubric belongs to
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'superseded', 'rejected')),
  name text not null,       -- the recognisable series name the audience learns to expect
  promise text,             -- the recurring idea/promise every episode delivers
  strategic_role text,      -- which GTM goal / funnel stage this series serves
  format text not null default 'single_image'
    check (format in ('single_image', 'carousel', 'text_post', 'link_post', 'video')),
  cadence text,             -- expected rhythm, e.g. '1/week', '2/month'
  differentiation text,     -- the competitor gap that justifies this series
  rationale text,           -- why this rubric for THIS brand (the client reads this)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
create index rubrics_brand_status_idx on public.rubrics (brand_id, status);
alter table public.rubrics enable row level security;
create policy "rubrics via brand" on public.rubrics for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Trace each produced post back to the rubric it executes (null for ad-hoc posts and for every
-- brand without approved rubrics — the whole rubric layer is opt-in).
alter table public.posts add column if not exists rubric_id uuid
  references public.rubrics(id) on delete set null;
