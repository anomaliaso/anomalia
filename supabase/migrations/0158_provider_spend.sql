-- 0158 monthly provider spend, summed in the DB.
-- The rank tracker's DataForSEO budget gate read 50 rows of ai_calls and summed them in JS:
-- 50 × $0.013 = $0.65, so `spent >= $15` could never be true and the weekly SERP tick had no
-- ceiling at all. PostgREST aggregates are disabled on this project, so the sum needs a function.
-- SECURITY DEFINER + service_role only: ai_calls is service-role territory (0089 added a member
-- SELECT policy for the credits counter, which still applies to direct table reads).
create or replace function public.brand_provider_spend_usd(
  p_brand_id uuid,
  p_provider text,
  p_since timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)::numeric
  from public.ai_calls
  where brand_id = p_brand_id
    and provider = p_provider
    and created_at >= p_since
$$;

revoke execute on function public.brand_provider_spend_usd(uuid, text, timestamptz) from public, anon, authenticated;

create index if not exists ai_calls_brand_provider_created_idx
  on public.ai_calls (brand_id, provider, created_at);
