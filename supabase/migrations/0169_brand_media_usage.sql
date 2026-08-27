-- 0169: how often / how recently each Media library asset was reused in posts,
-- graphics, and motion stills — so agents can rotate instead of always picking
-- the same hero photo.

alter table public.brand_media
  add column if not exists times_used integer not null default 0,
  add column if not exists last_used_at timestamptz;

create index if not exists brand_media_brand_used_idx
  on public.brand_media (brand_id, times_used asc, last_used_at asc nulls first);

create or replace function public.bump_brand_media_usage(p_brand_id uuid, media_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.brand_media
  set
    times_used = times_used + 1,
    last_used_at = now()
  where brand_id = p_brand_id
    and id = any (media_ids);
$$;

revoke all on function public.bump_brand_media_usage(uuid, uuid[]) from public;
grant execute on function public.bump_brand_media_usage(uuid, uuid[]) to authenticated, service_role;
