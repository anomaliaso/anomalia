-- Hosted brand blog (Phase 1): a public website of the brand's published articles, served by
-- hostname so the user can point their own domain (CNAME) at it. One host → one brand.
create table if not exists public.brand_sites (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  host text not null unique,          -- e.g. blog.brand.com (lowercased, no scheme)
  verified boolean not null default false,
  vercel_domain_id text,              -- set when registered via the Vercel Domains API
  created_at timestamptz not null default now()
);
create index if not exists brand_sites_brand_idx on public.brand_sites (brand_id);

alter table public.brand_sites enable row level security;
create policy "brand sites via brand" on public.brand_sites for select
  using (brand_id in (select public.auth_brand_ids()));

-- Publishing state for articles: when set, the article is live on the hosted site.
alter table public.brand_articles add column if not exists published_at timestamptz;
