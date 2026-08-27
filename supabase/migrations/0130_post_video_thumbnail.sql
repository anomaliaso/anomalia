-- Keep the cover a video post was animated from.
--
-- Until now the clip URL overwrote media_url and the cover was simply dropped — even though it had
-- just cost a full image render and carried all the grounding (product photo, person identity,
-- brand palette, QC verdict). Three things need it: the poster frame in the feed, "regenerate this
-- but change X" starting from the same frame, and the image_urls input for an image-to-video
-- re-render.
--
-- NOTE: deploys do NOT run migrations. Apply this BEFORE shipping code that selects the column —
-- a missing column in a shared select fails the whole query, zeroing every read of `posts`.
alter table posts add column if not exists video_thumbnail_url text;

comment on column posts.video_thumbnail_url is
  'Cover frame the clip in media_url was generated from. Null for non-video posts and for clips produced by text-to-video (no cover existed).';
