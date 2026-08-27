-- Confidence channel + Director log.
-- needs_attention/attention_reason: any reviewer (QC, copy chief, Director agent) can mark a post
-- "publishable but look at this" instead of shipping it silently — human review spent where the
-- machine knows it is unsure. qc persists the image-QC verdict (was in-memory only) so the weekly
-- reflection can mine it. source_url carries a Radar post's news citation. approval_token backs
-- the one-click email approve/reject (single use, expiring).
alter table public.posts add column if not exists needs_attention boolean not null default false;
alter table public.posts add column if not exists attention_reason text;
alter table public.posts add column if not exists source_url text;
alter table public.posts add column if not exists qc jsonb;
alter table public.posts add column if not exists approval_token uuid;
alter table public.posts add column if not exists approval_token_expires_at timestamptz;
create index if not exists posts_approval_token_idx on public.posts (approval_token) where approval_token is not null;

-- What the Director agent considered/did on a batch (shown in the UI as the batch's review note).
alter table public.content_plans add column if not exists director_log jsonb;
