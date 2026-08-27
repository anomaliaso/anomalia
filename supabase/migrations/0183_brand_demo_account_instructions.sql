-- 0174: free-text notes so the chat model knows how to use the product UI —
-- which screens matter, what to capture, what to push in posts.
alter table public.brand_demo_accounts
  add column if not exists instructions text;
