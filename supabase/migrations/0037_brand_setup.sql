-- 0037: post-payment automatic setup. As soon as a brand activates (pays), a BLOCKING setup
-- dialog walks the owner through 021 generating the full strategy stack: a default 6-month GTM
-- plan → the operational strategy (voice framework + platform rules, derived so 'Auto' is never
-- empty) → the week-1 editorial rows (the 3 onboarding posts + the remaining planned ones).
-- setup_step tracks resume (leaving the browser re-opens the dialog at the same step);
-- setup_completed_at non-null = dialog never shows again. Brands activated BEFORE this feature
-- are grandfathered by the deploy-time backfill below (they already live with the banner flow).
alter table public.brands add column if not exists setup_step int not null default 0;
alter table public.brands add column if not exists setup_completed_at timestamptz;

-- Backfill: anything already active predates the setup flow — mark complete so the dialog only
-- ever targets NEW activations.
update public.brands set setup_completed_at = now() where status = 'active' and setup_completed_at is null;
