-- Public MP4 for Media-Generator-style grid tiles. TSX `source` stays the editable truth.
alter table public.motion_videos
  add column if not exists preview_url text;

comment on column public.motion_videos.preview_url is
  'Public MP4 URL in the media bucket for grid tiles; source TSX remains the edit truth.';
