-- 0166: persist the post script (spoken + on-screen) with each QC vote + judgment,
-- so later reviews can retrieve writing that already scored. Also tags stills
-- (image / carousel / graphic) not only clips.

alter table public.video_reviews
  add column if not exists kind text not null default 'video'
    check (kind in ('video', 'image', 'carousel', 'graphic'));

alter table public.video_reviews
  add column if not exists script_spoken text;

alter table public.video_reviews
  add column if not exists script_on_screen text;

alter table public.video_reviews
  add column if not exists caption text;

alter table public.video_reviews
  add column if not exists judgment text;

create index if not exists video_reviews_brand_ready_idx
  on public.video_reviews (brand_id, status, updated_at desc)
  where status = 'ready';
