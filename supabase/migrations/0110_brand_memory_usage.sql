-- 0110: brand_memory usage tracking
-- times_reinforced = rewritten/confirmed; times_used = injected into an AI prompt.

alter table public.brand_memory
  add column if not exists times_used integer not null default 0,
  add column if not exists last_used_at timestamptz;

create index if not exists idx_brand_memory_used
  on public.brand_memory (brand_id, times_used desc);

-- Atomic bump when memory is injected into prompts (batch by id).
create or replace function public.bump_brand_memory_usage(entry_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.brand_memory
  set
    times_used = times_used + 1,
    last_used_at = now()
  where id = any (entry_ids);
$$;

revoke all on function public.bump_brand_memory_usage(uuid[]) from public;
grant execute on function public.bump_brand_memory_usage(uuid[]) to authenticated, service_role;
