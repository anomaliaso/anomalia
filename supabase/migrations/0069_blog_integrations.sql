-- Third-party blog publishing (Shopify first). Articles can publish to external CMS targets
-- (chosen per-brand via blog_config.publish_targets) instead of / alongside the hosted blog.
-- Secrets live HERE (server-only), never in blog_config which is loaded into the app layout.
create table if not exists public.blog_integrations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text not null,                 -- 'shopify' (more platforms later)
  store text,                             -- shopify store subdomain, e.g. 'na70yq-bn'
  client_id text,
  client_secret text,
  access_token text,                      -- optional: legacy direct Admin API token
  blog_id text,                           -- selected blog (GraphQL gid)
  author text,
  publish_immediately boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, platform)
);

-- RLS on with NO policies: only the server admin client (service role, bypasses RLS) ever touches
-- this. The anon/authenticated clients can't read the secrets.
alter table public.blog_integrations enable row level security;

-- Track the external article id per source article so re-publishing updates instead of duplicating.
alter table public.brand_articles add column if not exists shopify_article_id text;

-- Switch to enable/disable an integration as a publish destination without deleting its creds.
alter table public.blog_integrations add column if not exists active boolean not null default true;
