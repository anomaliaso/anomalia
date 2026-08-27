-- 0185: count the posts that arrive with a profile fetch.
--
-- A profile fetch returns two dozen posts from ONE account. Until now the harvest kept only the
-- median it computed from them and dropped the posts — paying for the call and using one number of
-- it. They are now stored and labelled on arrival (the denominator came back in the same response),
-- which is what actually grows the pool in the first days: discovery gives breadth across accounts
-- that cannot be labelled yet, these give rows that can.
--
-- Service-role only. Deploys do NOT run migrations — apply before shipping code that selects this.

alter table public.market_harvest_runs
  add column if not exists history_posts int not null default 0;

alter table public.market_harvest_runs
  add column if not exists fetches_deferred int not null default 0;
