-- 0162 atomic publishing-mode setter (fixes lost-update on content_prefs read-modify-write).
-- SECURITY INVOKER: runs as the caller, so RLS on brands applies (only org owners/members of
-- their own brands); the single-statement jsonb_set merges atomically instead of read+write.
create or replace function public.set_publishing_mode(p_brand_id uuid, p_mode text)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.brands
  set content_prefs = jsonb_set(coalesce(content_prefs, '{}'::jsonb), '{publishing,mode}', to_jsonb(p_mode), true)
  where id = p_brand_id;
$$;
