-- Which model a NEW chat starts on for this brand: 'auto' (the app picks), 'fast' or 'pro'.
-- The choice used to live in localStorage, so it was per-device and invisible to the rest of the
-- team; NULL keeps the app default ('auto').
alter table public.brands
  add column if not exists chat_default_tier text
  check (chat_default_tier is null or chat_default_tier in ('auto', 'fast', 'pro'));
