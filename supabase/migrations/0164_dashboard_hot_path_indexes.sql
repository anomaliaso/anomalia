-- 0164 dashboard hot-path indexes + credits SUM RPC.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-08-13 via MCP.
--
-- Every /app/[brand] navigation re-runs RLS via auth_brand_ids() and a handful of
-- brand-scoped counts. Prod pg_stat showed seq scans on organizations (owner_id),
-- brands (slug-only lookup), and content_plans (no brand_id index). Credits also
-- pulled every ai_calls.cost_usd row and summed in JS — PostgREST aggregates are
-- disabled on this project (see 0158), so the sum lives in a function.

-- ── RLS choke point (auth_brand_ids / member_brand_ids) ──────────────────────
create index if not exists organizations_owner_id_idx
  on public.organizations (owner_id);

create index if not exists brands_slug_idx
  on public.brands (slug);

create index if not exists brand_members_user_id_idx
  on public.brand_members (user_id);

-- ── Layout / plan / calendar / home ──────────────────────────────────────────
create index if not exists content_plans_brand_idx
  on public.content_plans (brand_id);

create index if not exists content_plans_editorial_plan_idx
  on public.content_plans (editorial_plan_id);

create index if not exists ai_calls_brand_created_cost_idx
  on public.ai_calls (brand_id, created_at)
  where cost_usd is not null;

create index if not exists posts_brand_status_scheduled_idx
  on public.posts (brand_id, status, scheduled_for);

create index if not exists social_post_history_brand_published_idx
  on public.social_post_history (brand_id, published_at desc);

create index if not exists publish_logs_post_idx
  on public.publish_logs (post_id);

create index if not exists brand_articles_brand_status_idx
  on public.brand_articles (brand_id, status);

-- ── Credits: SUM in SQL (authenticated + service_role; 0 if caller can't see the brand)
create or replace function public.sum_brand_ai_cost_usd(
  p_brand_id uuid,
  p_start timestamptz,
  p_end timestamptz
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
    and created_at >= p_start
    and created_at < p_end
    and cost_usd is not null
    and (
      auth.role() = 'service_role'
      or p_brand_id in (select public.auth_brand_ids())
    );
$$;

revoke execute on function public.sum_brand_ai_cost_usd(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.sum_brand_ai_cost_usd(uuid, timestamptz, timestamptz) to authenticated, service_role;
