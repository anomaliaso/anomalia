-- Per-article version history + AI chat. Each row is a content SNAPSHOT plus the chat exchange that
-- produced it (instruction = user message, reply = assistant message). undo/redo = moving the
-- brand_articles.version_seq pointer across these; a new edit truncates the redo tail.
create table if not exists public.brand_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.brand_articles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  seq integer not null,
  body_md text not null,
  title text,
  source text not null default 'ai',   -- initial | ai | user
  instruction text,                     -- the user's chat message (null for the initial snapshot)
  reply text,                           -- the assistant's short reply
  created_at timestamptz not null default now(),
  unique (article_id, seq)
);
create index if not exists brand_article_versions_article_idx on public.brand_article_versions (article_id, seq);

alter table public.brand_article_versions enable row level security;
create policy "article versions via brand" on public.brand_article_versions for select
  using (brand_id in (select public.auth_brand_ids()));

-- Which version is currently applied to brand_articles.body_md.
alter table public.brand_articles add column if not exists version_seq integer not null default 0;
