-- 0105 brand_media catalog: extend the existing brand_media asset table with AI catalog
-- metadata (description, tags, usage guidance) so agents can reuse library assets.
-- The base table (kind image|video, storage_path, url, mime, dimensions, bytes) already
-- existed remotely; this migration only adds catalog + UX columns.
--
-- SELF-HOST: la tabella base non è mai nata da un migration (creata fuori-banda sul hosted).
-- Su un replay pulito serve qui: le colonne sotto sono quelle che insertBrandMedia scrive da
-- sempre; tutto il resto arriva dagli alter di questo file e dei successivi.
create table if not exists public.brand_media (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id),
  user_id uuid references auth.users (id),
  kind text not null,
  storage_path text not null,
  url text,
  source text,
  mime text,
  bytes bigint,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);
create index if not exists brand_media_brand_idx on public.brand_media (brand_id, created_at desc);
alter table public.brand_media enable row level security;

alter table public.brand_media
  add column if not exists file_name text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists subjects text[] not null default '{}',
  add column if not exists colors text[] not null default '{}',
  add column if not exists mood text,
  add column if not exists media_kind text,
  add column if not exists suggested_use text,
  add column if not exists when_to_use text,
  add column if not exists how_to_use text,
  add column if not exists where_to_use text,
  add column if not exists catalog_status text not null default 'pending',
  add column if not exists catalog_error text,
  add column if not exists cataloged_at timestamptz,
  add column if not exists duration_seconds real,
  add column if not exists updated_at timestamptz not null default now();

-- catalog_status check (drop/recreate if re-run is needed)
do $$ begin
  alter table public.brand_media
    add constraint brand_media_catalog_status_check
    check (catalog_status in ('pending', 'ready', 'failed'));
exception when duplicate_object then null;
end $$;

create index if not exists brand_media_brand_created_idx
  on public.brand_media (brand_id, created_at desc);
create index if not exists brand_media_catalog_idx
  on public.brand_media (brand_id, catalog_status);
create index if not exists brand_media_tags_idx
  on public.brand_media using gin (tags);

-- Backfill file_name from storage_path basename when missing
update public.brand_media
set file_name = coalesce(file_name, split_part(storage_path, '/', -1))
where file_name is null;
