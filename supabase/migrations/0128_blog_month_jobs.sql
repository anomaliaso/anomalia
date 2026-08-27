-- 0128 blog month jobs — "Pianifica il mese" as a real background batch job.
--
-- WHY: the month plan used to insert 28 empty 'planned' placeholders and let the daily autopilot
-- drip write one article a day. Every article DID get the full treatment (text+SEO, humanize,
-- optimize, 3 images), but spread over a month — so the button appeared to "only do the texts".
--
-- Writing 28 articles and rendering 84 images cannot happen in one request (300s function cap; a
-- single article takes 1-2 minutes on its own), so this table is the durable state of a job that
-- /api/v1/blog/month/work advances a step at a time (cron */2 + self-chain, mirroring
-- knowledge/work and the onboarding_jobs state machine).
--
-- The images go through the Gemini BATCH API in ONE job (verified live 2026-08-04: Nano Banana 2
-- accepts imageConfig.aspectRatio and inline base64 reference images in batch, and returned in
-- ~3 minutes). Batch is billed at 50% of interactive, on top of Nano Banana 2 already being half
-- the price of Nano Banana Pro — so ~4x cheaper per image than the synchronous path.
-- `manifest` is what maps a batch response back to its destination: inline responses come back in
-- submission order, so position N of the manifest describes response N.

create table if not exists public.blog_month_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  -- pending  → placeholders exist, texts not written yet
  -- writing  → writing article bodies (DeepSeek), a chunk per invocation
  -- imaging  → image batch submitted, waiting on the provider
  -- ready    → everything applied, owner notified
  -- failed   → gave up after 3 consecutive step failures
  status text not null default 'pending',
  -- 'batch' = images via the Batch API (cheap, hours). 'fast' = images rendered inline (top plan).
  mode text not null default 'batch',
  progress jsonb not null default '{}'::jsonb,   -- { planned, written, images_expected, images_applied }
  batch_name text,                                -- Gemini batch resource name ("batches/…")
  manifest jsonb not null default '[]'::jsonb,    -- ordered [{ articleId, kind: 'cover'|'section', heading?, line? }]
  error text,
  attempts int not null default 0,                -- consecutive failures on the CURRENT step; 3 → failed
  step_started_at timestamptz,                    -- stall detection for the cron backstop
  notified_at timestamptz,                        -- set once, so the "ready" email is never sent twice
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The worker scans by status to find advanceable jobs; the UI banner looks up the brand's live job.
create index if not exists blog_month_jobs_status_idx on public.blog_month_jobs (status);
create index if not exists blog_month_jobs_brand_idx on public.blog_month_jobs (brand_id, created_at desc);

alter table public.blog_month_jobs enable row level security;

-- Read-only for whoever can see the brand (the site page polls it for the progress banner). Every
-- write comes from the service-role worker, which bypasses RLS — so no insert/update policy here.
create policy "blog_month_jobs select own brand" on public.blog_month_jobs
  for select using (brand_id in (select public.auth_brand_ids()));
