-- Design doc componibile del post: layer + canvas, renderizzato da Remotion nel browser.
-- media_url / media_urls restano l'output: ogni lettore esistente (card, calendario, email,
-- publish → Zernio) continua a funzionare senza modifiche. NULL = post legacy a sola immagine.
alter table public.posts add column if not exists design jsonb;

create table if not exists public.brand_design_templates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  kind text not null default 'post',
  aspect text not null default '4:5',
  doc jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists brand_design_templates_brand_idx
  on public.brand_design_templates(brand_id);

alter table public.brand_design_templates enable row level security;

-- Align with brand_kit / products (auth_brand_ids UNION, see 0077).
-- Migrations here are applied BY HAND (Vercel does not run them), so a re-run must not error:
-- create policy is not idempotent on its own — drop first, like 0109 does.
drop policy if exists "brand_design_templates via brand" on public.brand_design_templates;
create policy "brand_design_templates via brand" on public.brand_design_templates for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
