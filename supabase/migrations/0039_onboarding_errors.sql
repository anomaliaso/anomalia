-- 0039 onboarding error log
--
-- Generation failures during onboarding (analyze / competitors / research / plan posts / image
-- render / draft autosave / uploads) used to live only in the failing user's UI — invisible for
-- post-mortem debugging. Every server-side catch now persists one row here (best-effort, never
-- blocking the response); the client mirrors the same failures to PostHog as `onboarding_error`.

create table if not exists public.onboarding_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  step text not null,                          -- analyze | competitors | research | plan_posts | preview_images | draft_save | logo_upload | people_upload | people_import
  message text not null,                       -- the error message as thrown
  context jsonb,                               -- step-specific extras (url, sub-stage reached, counts…)
  created_at timestamptz not null default now()
);

create index if not exists onboarding_errors_created_at_idx on public.onboarding_errors (created_at desc);
create index if not exists onboarding_errors_step_idx on public.onboarding_errors (step);

alter table public.onboarding_errors enable row level security;

-- Inserts come from the server using the user-scoped client (RLS applies); users never read these
-- back — only the service role / dashboard does.
create policy "onboarding_errors insert own" on public.onboarding_errors
  for insert with check (user_id = auth.uid());
