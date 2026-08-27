-- Last-mile pre-publish gate: Gemini (plus cheap deterministic checks) must OK a scheduled
-- post shortly before Zernio sends it. prepublish_ok is null until the tick (or an imminent
-- approve) judges it; true = ship; false = pulled back to pending_user.
-- Edits to caption/media clear the stamp so the post is judged again.

alter table public.posts add column if not exists prepublish_ok boolean;
alter table public.posts add column if not exists prepublish_checked_at timestamptz;

create index if not exists posts_prepublish_due_idx
  on public.posts (scheduled_for)
  where status = 'scheduled' and prepublish_ok is distinct from true;

create or replace function public.posts_clear_prepublish_on_edit()
returns trigger
language plpgsql
as $$
begin
  if
    new.caption is distinct from old.caption
    or new.media_url is distinct from old.media_url
    or new.media_urls is distinct from old.media_urls
    or new.content_type is distinct from old.content_type
    or new.title is distinct from old.title
    or new.link_url is distinct from old.link_url
    or new.video_thumbnail_url is distinct from old.video_thumbnail_url
    or new.platform_captions is distinct from old.platform_captions
  then
    new.prepublish_ok := null;
    new.prepublish_checked_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_clear_prepublish_on_edit on public.posts;
create trigger posts_clear_prepublish_on_edit
  before update on public.posts
  for each row
  execute function public.posts_clear_prepublish_on_edit();
