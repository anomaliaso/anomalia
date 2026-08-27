-- Per-day view counters for public blog articles, bumped by an anonymous client beacon
-- (POST /api/v1/blog/hit). No cookies / personal data — just a counter, so no consent needed.
create table if not exists public.article_views (
  article_id uuid not null references public.brand_articles(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (article_id, day)
);

-- Service-role only: no policies on purpose, the beacon endpoint uses the admin client.
alter table public.article_views enable row level security;

create or replace function public.bump_article_view(aid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into article_views (article_id, day, count) values (aid, current_date, 1)
  on conflict (article_id, day) do update set count = article_views.count + 1;
$$;

revoke execute on function public.bump_article_view(uuid) from public, anon, authenticated;
