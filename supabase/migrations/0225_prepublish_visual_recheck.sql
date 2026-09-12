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
    or new.image_prompt is distinct from old.image_prompt
    or new.video_thumbnail_url is distinct from old.video_thumbnail_url
    or new.youtube_thumbnail_url is distinct from old.youtube_thumbnail_url
    or new.platform_captions is distinct from old.platform_captions
  then
    new.prepublish_ok := null;
    new.prepublish_checked_at := null;
  end if;
  return new;
end;
$$;

update public.posts
set prepublish_ok = null,
    prepublish_checked_at = null
where status = 'scheduled'
  and coalesce(content_type, '') not in ('text', 'link');
