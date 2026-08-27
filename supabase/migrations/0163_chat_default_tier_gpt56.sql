-- Allow GPT 5.6 Terra and Sol as brand default chat models (custom picker).
alter table public.brands drop constraint if exists brands_chat_default_tier_check;
alter table public.brands
  add constraint brands_chat_default_tier_check
  check (
    chat_default_tier is null
    or chat_default_tier in ('auto', 'fast', 'pro', 'deepseek-pro', 'gpt-terra', 'gpt-sol')
  );
