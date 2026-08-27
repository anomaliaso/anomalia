-- GEO (Generative Engine Optimization): is the brand crawlable + citable by LLMs?
-- Level 1 is a deterministic technical audit (llms.txt, AI-crawler robots rules, JSON-LD, sitemap).
-- Level 2 is citation share-of-voice: category questions (AI-seeded, user-editable) asked against a
-- web-grounded model to see whether the brand — or its competitors — get named in the answer.

-- The category questions a real buyer would ask an LLM. Seeded from the brand profile on first run.
create table if not exists public.brand_geo_prompts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  prompt text not null,
  lang text,                    -- 'it' | 'en' | null
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (brand_id, prompt)
);

-- One snapshot per audit run — the history is what powers the trend line (score/share over time).
create table if not exists public.brand_geo_audits (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  tech_score integer,              -- 0-100 from the technical audit
  tech jsonb,                      -- GeoTechAudit (llmsTxt, aiCrawlers, structuredDataTypes, issues…)
  share_of_voice integer,          -- 0-100: % of prompts where the brand is named
  citations jsonb,                 -- CitationResult[] (per-prompt: mentioned, rank, competitors, sources)
  created_at timestamptz not null default now()
);
create index if not exists brand_geo_audits_brand_created_idx on public.brand_geo_audits (brand_id, created_at desc);

alter table public.brand_geo_prompts enable row level security;
create policy "geo prompts via brand" on public.brand_geo_prompts for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

alter table public.brand_geo_audits enable row level security;
create policy "geo audits via brand" on public.brand_geo_audits for select
  using (brand_id in (select public.auth_brand_ids()));
