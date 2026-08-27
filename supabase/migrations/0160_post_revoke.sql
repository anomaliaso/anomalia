-- 0160 post-hoc revoke + per-account rotation cursor.
--  • posts.revoked_at marks a published/scheduled post the user pulled back into pending_user
--    (revokePublishedPost). The partial index keeps audit/cleanup queries on revoked posts cheap.
--  • social_accounts.last_used_at is the rotation cursor: publishApprovedPost stamps every account
--    it published to, so a later single-account selector can pick the least-recently-used account
--    per platform (order by last_used_at asc nulls first).

alter table public.posts add column if not exists revoked_at timestamptz;
create index if not exists posts_revoked_idx on public.posts (revoked_at) where revoked_at is not null;

alter table public.social_accounts add column if not exists last_used_at timestamptz;
