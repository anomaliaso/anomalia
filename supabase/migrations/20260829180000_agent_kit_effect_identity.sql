alter table public.agent_kit_effects
  add column if not exists invocation_id text;

alter table public.agent_kit_effects
  alter column idempotency_key drop not null;

drop index if exists public.agent_kit_effects_brand_key_idx;

create unique index if not exists agent_kit_effects_brand_invocation_idx
  on public.agent_kit_effects (brand_id, invocation_id)
  where invocation_id is not null;

create index if not exists agent_kit_effects_legacy_key_idx
  on public.agent_kit_effects (brand_id, idempotency_key)
  where invocation_id is null;
