-- Custom YouTube cover (16:9), distinct from video_thumbnail_url (the 9:16 frame the clip
-- was animated from — remakes / feed poster / prepublish still need that).
--
-- Zernio sends this as mediaItems[].thumbnail on the video item. YouTube's API only applies
-- custom thumbs to regular videos, not Shorts.
--
-- NOTE: deploys do NOT run migrations. Apply this BEFORE shipping code that selects the column —
-- a missing column in a shared select fails the whole query, zeroing every read of `posts`.
alter table posts add column if not exists youtube_thumbnail_url text;

comment on column posts.youtube_thumbnail_url is
  'Custom 16:9 YouTube thumbnail (JPEG/PNG, max 2 MB, recommended 1280×720). Null until the user generates or picks one. Distinct from video_thumbnail_url.';
