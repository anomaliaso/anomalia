-- Brand members can read agent run telemetry; writes remain service-role only (admin client).
drop policy if exists "agent_runs readable by brand members" on public.agent_runs;
create policy "agent_runs readable by brand members" on public.agent_runs
  for select using (brand_id in (select public.auth_brand_ids()));
