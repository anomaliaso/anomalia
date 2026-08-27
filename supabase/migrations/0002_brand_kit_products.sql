-- 0002 studio (part 1): brand_kit (from website analysis) + products (Shopify import)
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.

create table public.brand_kit (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  category text, about text, brand_style text, target_audience text,
  brand_colors jsonb, theme_color text, favicon_url text,
  logos jsonb, fonts jsonb, ai_character jsonb, images jsonb,
  source_url text, updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  external_id text, title text not null, description text, pricing text,
  images jsonb, url text, featured boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_brand_id_idx on public.products (brand_id);

alter table public.brand_kit enable row level security;
alter table public.products enable row level security;

create policy "brand_kit via brand" on public.brand_kit for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
create policy "products via brand" on public.products for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
