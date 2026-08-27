-- 0027: per-user UI language preference. Drives transactional emails sent from the
-- recurring planner (cron), which runs without a request/cookie so it can't read the
-- browser locale. The language toggle writes this when the user is authenticated; the
-- scheduler reads it via brandOwnerEmail. Defaults to 'en' so existing rows stay English.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-05 via MCP.
alter table public.profiles add column if not exists locale text not null default 'en';
