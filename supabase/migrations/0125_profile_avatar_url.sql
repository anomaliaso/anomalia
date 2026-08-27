-- Profile photo for the signed-in user (OAuth avatar remains a fallback in app code).
alter table public.profiles
  add column if not exists avatar_url text;
