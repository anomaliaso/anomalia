-- 0127 posts.video_task_id / video_resolution: keep the provider-side handle on a generated clip.
--
-- kie's video jobs can be CONTINUED after the fact — `grok-imagine/upscale` and
-- `grok-imagine/extend` both take the ORIGINAL task_id ("Only Kie AI-generated task IDs are
-- supported"), never a video URL. We were discarding that id after polling, which threw away the
-- only handle those endpoints accept.
--
-- Keeping it unlocks the cost strategy this exists for: generate every clip at the cheap
-- resolution, and pay for the upscale ONLY on the clips a user actually approves. Video is the
-- priciest thing the engine buys, and most drafts are never published.
--
-- Both nullable: only rows carrying a real generated clip have values. video_resolution is the
-- resolution the stored mp4 is CURRENTLY at (not the one requested), so the publish path can tell
-- an already-upscaled clip from one still awaiting it and never double-spend.
alter table public.posts
  add column if not exists video_task_id text default null,
  add column if not exists video_resolution text default null;
