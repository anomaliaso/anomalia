-- 0095 Event campaigns: posts sharing a campaign_id ARE the campaign — no new table.
-- A "campaign" = the set of posts with the same campaign_id, generated as a fixed 5-step arc
-- (announcement / countdown / spotlight / day_of / recap) around one event date. Reuses posts'
-- existing RLS + approval flow (pending_user → approve like any other draft).
alter table public.posts add column if not exists campaign_id uuid;
alter table public.posts add column if not exists campaign_name text;
alter table public.posts add column if not exists campaign_step text;

create index if not exists idx_posts_campaign_id on public.posts(campaign_id) where campaign_id is not null;
