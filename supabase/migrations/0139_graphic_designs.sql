-- Version log for programmatically composed graphics (typographic posts + media-generator items).
--
-- A graphic is not a pixel buffer, it is a SPEC: an ordered list of blocks (see $lib/design/blocks)
-- that a renderer turns into a PNG deterministically. Keeping the spec means an edit is "change the
-- headline" instead of "compose a new graphic from scratch", and every render stays reproducible.
--
-- Append-only by convention: an edit inserts a new row with version+1 rather than updating, so the
-- whole history of a graphic is recoverable and a bad edit can be rolled back to any earlier take.

create table if not exists public.graphic_designs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid,

  -- What the graphic is attached to. 'post' → posts.id, 'media_item' → media_generator_items.id.
  -- Untyped on purpose: a plain FK per kind would need two nullable columns and two constraints for
  -- no gain, and the media-generator grid is prunable independently of posts.
  target_kind text not null check (target_kind in ('post', 'media_item')),
  target_id uuid not null,
  -- Carousels address a slot; null means the post's single cover.
  slide_index int,

  version int not null check (version >= 1),
  -- The Graphic spec: { aspect, theme, blocks[] }. Validated by zod on read, never trusted raw.
  spec jsonb not null,
  -- The PNG this exact spec produced, so a version can be shown without re-rendering.
  media_url text not null,
  -- What was asked for — the brief on v1, the edit instruction on later versions.
  brief text,

  created_at timestamptz not null default now()
);

-- "Latest version of this graphic" is the hot read; the target tuple leads, version descends.
create unique index if not exists graphic_designs_version_key
  on public.graphic_designs (target_kind, target_id, coalesce(slide_index, -1), version);

create index if not exists graphic_designs_target_idx
  on public.graphic_designs (target_kind, target_id, version desc);

create index if not exists graphic_designs_brand_idx
  on public.graphic_designs (brand_id, created_at desc);

alter table public.graphic_designs enable row level security;

-- Same brand gate as the rest of the app (auth_brand_ids covers owned + shared brands).
drop policy if exists "graphic_designs via brand" on public.graphic_designs;
create policy "graphic_designs via brand" on public.graphic_designs
  for all
  using (brand_id in (select auth_brand_ids()))
  with check (brand_id in (select auth_brand_ids()));
