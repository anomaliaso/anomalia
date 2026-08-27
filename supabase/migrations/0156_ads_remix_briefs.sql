-- 0156: Ads remix briefs — the agent's "how to recompose competitor ads for this brand" output.
-- Consumed by the CLI/MCP ads remix surface and (later) the dashboard ads UI.
-- (Renumbered from 0151, which collided with 0151_post_links — that one is already applied.)

create table if not exists public.ads_remix_briefs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Source competitor ad (Meta Ad Library archive id) this brief recomposes.
  source_ad_id text not null,
  source_page_name text,
  source_body text,
  source_thumbnail text,        -- archived bucket path (or CDN url) for the source creative
  source_library_url text,
  rank int not null default 1, -- priority: 1 = best remix candidate
  strategy text not null,      -- why this ad is worth remixing + the angle for OUR brand
  keep text,                   -- what to keep from the source (hook structure, CTA, offer…)
  change text,                 -- what to change (product, tone, visuals…)
  hook text not null,          -- the remixed hook, in the brand's voice
  headline text not null,
  body text,
  cta text,
  product_name text,           -- brand product this remix features
  visual_prompt text,          -- direction for the media generator (for the eventual render)
  status text not null default 'proposed' check (status in ('proposed','approved','converted','discarded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ads_remix_briefs_brand_idx on public.ads_remix_briefs (brand_id);
alter table public.ads_remix_briefs enable row level security;
drop policy if exists "ads_remix_briefs via brand" on public.ads_remix_briefs;
create policy "ads_remix_briefs via brand" on public.ads_remix_briefs for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
