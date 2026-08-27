-- Checkpoint for the media-review agent so a Vercel 300s kill can resume
-- from the last completed tool step instead of restarting the loop.
alter table public.video_reviews
  add column if not exists progress jsonb;
