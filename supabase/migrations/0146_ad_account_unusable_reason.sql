-- Why an ad account cannot run ads, straight from the platform (Meta's unusableReason, e.g.
-- ACCOUNT_DISABLED / UNSETTLED). Without it a blocked account could only be marked 'inactive',
-- so the readiness checklist said "no ad account found — sync after authorising", which is the
-- one thing the user should NOT do: the account is there, it is blocked, and the fix is a payment
-- or an appeal on Meta's side.
alter table public.zernio_ad_accounts
  add column if not exists unusable_reason text;
