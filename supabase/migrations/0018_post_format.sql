-- 0018 posts.format: persist the planner's chosen native format (post/carousel/reel/short
-- video/story/text). Needed so a post's video INTENT survives onboarding: the free preview
-- shows a video icon over a cover image, and only at post-checkout confirm do we render the
-- real Seedance clip for video-format posts (within the plan's video guardrail).
alter table public.posts add column if not exists format text;
