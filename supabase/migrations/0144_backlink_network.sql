-- Cross-brand Anomalia backlink network: contextual links between opted-in brands' published
-- articles. Placements are written when blog generation weaves a partner URL into a draft;
-- opportunities are the ranked candidate list shown in Studio / CLI.

create table if not exists public.brand_backlink_placements (
  id uuid primary key default gen_random_uuid(),
  source_brand_id uuid not null references public.brands(id) on delete cascade,
  source_article_id uuid references public.brand_articles(id) on delete set null,
  target_brand_id uuid not null references public.brands(id) on delete cascade,
  target_article_id uuid references public.brand_articles(id) on delete set null,
  target_url text not null,
  anchor_text text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_backlink_placements_source_idx
  on public.brand_backlink_placements (source_brand_id, created_at desc);
create index if not exists brand_backlink_placements_target_idx
  on public.brand_backlink_placements (target_brand_id, created_at desc);
create index if not exists brand_backlink_placements_source_article_idx
  on public.brand_backlink_placements (source_article_id)
  where source_article_id is not null;

-- One open opportunity per (brand, direction, partner article).
create table if not exists public.brand_backlink_opportunities (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  direction text not null check (direction in ('give', 'receive')),
  partner_brand_id uuid not null references public.brands(id) on delete cascade,
  partner_article_id uuid references public.brand_articles(id) on delete cascade,
  partner_url text not null,
  partner_title text,
  partner_brand_name text,
  relevance numeric not null default 0,
  suggested_anchor text,
  rationale text,
  status text not null default 'open'
    check (status in ('open', 'placed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_backlink_opportunities_brand_idx
  on public.brand_backlink_opportunities (brand_id, direction, status, relevance desc);

create unique index if not exists brand_backlink_opportunities_open_unique
  on public.brand_backlink_opportunities (brand_id, direction, partner_brand_id, partner_article_id)
  where status = 'open' and partner_article_id is not null;

alter table public.brand_backlink_placements enable row level security;
alter table public.brand_backlink_opportunities enable row level security;

-- Brand members can read placements where they are source OR target.
drop policy if exists "backlink placements brand read" on public.brand_backlink_placements;
create policy "backlink placements brand read" on public.brand_backlink_placements
  for select using (
    source_brand_id in (select public.auth_brand_ids())
    or target_brand_id in (select public.auth_brand_ids())
  );

drop policy if exists "backlink opportunities brand read" on public.brand_backlink_opportunities;
create policy "backlink opportunities brand read" on public.brand_backlink_opportunities
  for select using (brand_id in (select public.auth_brand_ids()));

-- Writes are service-role only (blog generation + generate action).
