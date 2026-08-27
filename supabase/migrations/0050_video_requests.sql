-- 0050 Founder-made video commissions
--
-- Videos the AI can't produce from scratch can be COMMISSIONED to the 021 team: the user files a
-- request (brief + optional reference images, capped per month by plan tier), the founders
-- fulfil it and deliver the finished clip INSIDE the platform (a pending_user post on the brand +
-- the request flipped to 'delivered'). Users only ever read + create their own brand's requests;
-- all fulfilment happens through the admin dashboard, which runs under the service-role client
-- (RLS bypass) behind an is_admin() gate.

create table public.video_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  requested_by uuid not null,
  platform text,
  brief text not null,
  -- Public URLs of the user's uploaded reference images (media bucket).
  reference_urls jsonb,
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'delivered', 'rejected')),
  -- Founder-facing note (internal) and the user-facing rejection/delivery note.
  admin_note text,
  delivered_media_url text,
  delivered_post_id uuid references public.posts(id) on delete set null,
  -- Brand-local YYYY-MM at request time — the monthly quota accounting key (mirrors usage).
  month_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index video_requests_brand_idx on public.video_requests (brand_id);
create index video_requests_status_idx on public.video_requests (status);

alter table public.video_requests enable row level security;

-- Brand members: read + file their own brand's requests. No update/delete — the lifecycle
-- (in_progress/delivered/rejected) belongs to the founders via the service-role client.
create policy "video_requests via brand select" on public.video_requests for select
  using (brand_id in (select public.auth_brand_ids()));
create policy "video_requests via brand insert" on public.video_requests for insert
  with check (brand_id in (select public.auth_brand_ids()));
