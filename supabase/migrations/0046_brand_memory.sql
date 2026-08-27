-- 0046: brand_memory — structured, shared memory layer for all AI subsystems.
--
-- Replaces the monolithic brand_kit.ai_context blob with atomic memory entries that every
-- AI call (research, editorial plan, content production, GTM, chatbot) can read and write.
-- Each entry captures one piece of knowledge with a confidence score, source attribution,
-- and lifecycle metadata (reinforcement count, decay tracking).

create table public.brand_memory (
  id               uuid primary key default gen_random_uuid(),
  brand_id         uuid not null references public.brands(id) on delete cascade,
  layer            text not null default 'project' check (layer in ('session', 'project', 'global')),
  category         text not null check (category in ('voice', 'constraint', 'fact', 'preference', 'insight')),
  key              text not null,
  value            text not null,
  source           text not null default 'user' check (source in ('chat', 'research', 'onboarding', 'user', 'analysis')),
  confidence       real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  times_reinforced integer not null default 0,
  last_reinforced_at timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (brand_id, key)
);

create index idx_brand_memory_brand on public.brand_memory (brand_id, confidence desc);
create index idx_brand_memory_decay on public.brand_memory (expires_at) where expires_at is not null;

alter table public.brand_memory enable row level security;

create policy "brand_memory via brand" on public.brand_memory for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
