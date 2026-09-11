-- A clip asked for without a brand: who does the reconciler report it to?
--
-- An image answers synchronously and hands back a storage path, so nothing has to remember it. A
-- clip does not: kie takes minutes, the request is gone, and a cron finishes the job from the row
-- alone. Every column that row used to answer with was a brand — brand_id NOT NULL, the library it
-- deposits into, the monthly allowance it charges, the RLS predicate that lets the user watch it.
--
-- The answer is the one ai_calls already took, and taking a different one would give this table a
-- second vocabulary for the same question:
--
--   with a brand   →  video_renders.brand_id → brands.org_id → the pool
--   without one    →  video_renders.org_id ─────────────────→ the same pool
--
-- Exactly one of the two, never both and never neither: a row with both invites the reconciler's
-- two branches to disagree about which one it is.
--
-- What a brand-free clip does NOT get, and why:
--
--   no brand_media row  — that table's policy is `brand_id in (select auth_brand_ids())`, and
--                         `NULL in (…)` is NULL, not true. A row without a brand would be
--                         invisible to everyone rather than visible to everyone. Same reason the
--                         brand-free image hands back a path instead of an id.
--   no monthly charge   — the videos allowance belongs to a brand's plan. Here the limit is the
--                         org's credit balance, the same gate the brand-free image passes.
--   no post, no thread  — post_id and thread_id were already nullable; this path never sets them.
--
-- The mp4 itself needed nothing: persistMp4 has always written `${userId}/generated/…`, under the
-- user and never under the brand. media_url on this row is where the clip is, and it is enough.

alter table public.video_renders alter column brand_id drop not null;

alter table public.video_renders
  add column if not exists org_id uuid references public.organizations (id) on delete cascade;

alter table public.video_renders drop constraint if exists video_renders_one_payer;
alter table public.video_renders
  add constraint video_renders_one_payer check (num_nonnulls(brand_id, org_id) = 1);

-- The brand-free read: a caller's own recent jobs, newest first. Mirrors video_renders_pending_idx
-- for the other half of the table.
create index if not exists video_renders_org_idx
  on public.video_renders (org_id, submitted_at desc)
  where org_id is not null;

-- A user must be able to watch a clip they paid for. Without the second arm a brand-free row is
-- readable by nobody — the render happens, the money leaves, and the row is a black box.
drop policy if exists video_renders_select on public.video_renders;
create policy video_renders_select on public.video_renders
  for select
  using (
    brand_id in (select public.auth_brand_ids())
    or org_id in (select public.auth_org_ids())
  );
