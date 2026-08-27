-- 0098 talent: shared AI talent library (global, not brand-scoped).
-- Models are reusable across brands for advanced photo/video tools.
-- Photos live in the private `talent` storage bucket as optimized WebP.
-- Applied to Supabase kszazivzwievqixcnanp via MCP.

create table public.talents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  gender text,
  age int,
  body text,
  ethnicity text,
  summary text,
  -- Structured appearance pack: hair, eyes, face, skin, marks, wardrobe, hair_style, …
  traits jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.talent_views (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.talents(id) on delete cascade,
  view_key text not null,
  label text not null,
  aspect_ratio text,
  -- Storage path inside the `talent` bucket, e.g. valeria/face-front.webp
  path text not null,
  mime_type text not null default 'image/webp',
  width int,
  height int,
  bytes int,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (talent_id, view_key)
);

create index talent_views_talent_idx on public.talent_views (talent_id, sort_order);
create index talents_status_idx on public.talents (status);

alter table public.talents enable row level security;
alter table public.talent_views enable row level security;

-- Catalog readable by any signed-in user (picker). Writes via service role only.
create policy "talents read authenticated"
  on public.talents for select to authenticated
  using (status = 'active');

create policy "talent_views read authenticated"
  on public.talent_views for select to authenticated
  using (
    exists (
      select 1 from public.talents t
      where t.id = talent_id and t.status = 'active'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'talent',
  'talent',
  false,
  5242880,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- Authenticated users can read objects (needed for createSignedUrl from the app).
create policy "talent read authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'talent');
