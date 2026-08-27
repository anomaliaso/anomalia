-- 0125 tool_usage: the spend guard for the PUBLIC (unauthenticated) free tools under /api/tools.
-- Those routes burn real money — Gemini web-search calls and DataForSEO tasks — with no session
-- behind them, so they need a ceiling that survives serverless cold starts. An in-memory counter
-- resets per instance and protects nothing; this table is the shared counter.
--
-- One row per (day, tool, bucket). bucket = a hashed client IP, or '__all__' for the tool's
-- global daily total. Counting both means a single abuser is throttled by the IP cap AND the
-- total daily spend per tool stays bounded no matter how many IPs show up.

create table if not exists public.tool_usage (
  day date not null default current_date,
  tool text not null,
  bucket text not null,
  count integer not null default 0,
  primary key (day, tool, bucket)
);

-- Only the service role touches this (the tools run with the admin client, no user session).
alter table public.tool_usage enable row level security;

-- Atomic check-and-bump: increments the caller's bucket and the tool's global bucket in one
-- round trip and returns both new counts, so the route can reject before spending. Doing this
-- as two client-side upserts would race under concurrency — exactly when a cap matters most.
create or replace function public.bump_tool_usage(p_tool text, p_bucket text)
returns table (ip_count integer, global_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip integer;
  v_all integer;
begin
  insert into public.tool_usage (day, tool, bucket, count)
  values (current_date, p_tool, p_bucket, 1)
  on conflict (day, tool, bucket) do update set count = tool_usage.count + 1
  returning count into v_ip;

  insert into public.tool_usage (day, tool, bucket, count)
  values (current_date, p_tool, '__all__', 1)
  on conflict (day, tool, bucket) do update set count = tool_usage.count + 1
  returning count into v_all;

  ip_count := v_ip;
  global_count := v_all;
  return next;
end $$;

revoke execute on function public.bump_tool_usage(text, text) from public, anon, authenticated;

-- Yesterday's rows are dead weight; the guard only ever reads current_date.
create index if not exists tool_usage_day_idx on public.tool_usage (day);
