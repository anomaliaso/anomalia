-- Allow DeepSeek V4 Pro as a brand default chat model (custom picker).
alter table public.brands drop constraint if exists brands_chat_default_tier_check;
alter table public.brands
  add constraint brands_chat_default_tier_check
  check (chat_default_tier is null or chat_default_tier in ('auto', 'fast', 'pro', 'deepseek-pro'));
