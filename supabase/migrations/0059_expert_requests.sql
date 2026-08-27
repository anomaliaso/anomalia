-- Expert-assistance requests: when a user asks to talk to a human expert about a specific SEO
-- initiative, we capture their contact details here (and email the team) so we can call them back.
create table if not exists public.expert_requests (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  initiative_id text,
  initiative_title text,
  initiative_type text,
  full_name text not null,
  email text not null,
  phone text not null,
  created_at timestamptz not null default now()
);
create index if not exists expert_requests_brand_created_idx on public.expert_requests (brand_id, created_at desc);

alter table public.expert_requests enable row level security;
create policy "expert requests via brand" on public.expert_requests for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
