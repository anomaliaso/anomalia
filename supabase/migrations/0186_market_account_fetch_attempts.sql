-- 0186: remember which accounts we already tried to fetch a profile for.
--
-- The fetch list is otherwise derivable — every account in market_posts with no row in
-- market_account_baselines still needs one — but derivation alone would retry a dead handle every
-- hour forever, and a 404 does not become a 200 by being asked again. This records the attempt so
-- the queue can back off, and so "we tried and it failed" stays distinguishable from "we have not
-- got to it yet".
--
-- Service-role only. Deploys do NOT run migrations — apply before shipping code that selects this.

create table if not exists public.market_account_fetch_attempts (
  platform text not null,
  account_key text not null,
  attempts int not null default 0,
  last_attempt_at timestamptz not null default now(),
  last_error text,
  primary key (platform, account_key)
);

create index if not exists market_account_fetch_attempts_retry_idx
  on public.market_account_fetch_attempts (last_attempt_at);

alter table public.market_account_fetch_attempts enable row level security;
