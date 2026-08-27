-- 0091 posts.media_urls: the ordered slide URLs of a CAROUSEL post (format 'carousel'), as a
-- jsonb array of strings. Single-image posts keep it null. media_url stays populated with the
-- FIRST slide for every post, so every existing reader (cards, emails, analytics, publish
-- fallback) keeps working unchanged; multi-image-aware paths (publish → Zernio mediaItems)
-- prefer media_urls when present.
alter table public.posts add column if not exists media_urls jsonb;

-- The per-slide image prompts of a carousel post (jsonb array of strings, index-aligned with the
-- slides; entry 0 == image_prompt, the cover). Needed because the CLI flow persists posts BEFORE
-- rendering (weekly-plan produce → render): without this column the slide prompts written by
-- Pass 2 would be lost and the render step could only produce one image. Null for non-carousels.
alter table public.posts add column if not exists image_prompts jsonb;
