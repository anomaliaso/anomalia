-- 0028 people: brand "people" — real creators/founders (uploaded photos) or AI-generated
-- avatars (built from a few attributes). A person is one row + 1..N reference images stored in
-- the private `brand-knowledge` bucket. The planner can feature a person in a post; the image
-- generator receives the person's photos as references to keep the face/identity consistent.
-- Applied to Supabase kszazivzwievqixcnanp via MCP.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  role text,                      -- e.g. "Founder", "Creator", "AI avatar"
  kind text not null check (kind in ('real', 'ai')),
  description text,               -- free-text appearance/persona (drives AI generation + prompts)
  attributes jsonb,              -- AI builder selects (gender, age, ethnicity, vibe, …)
  images jsonb not null default '[]'::jsonb,  -- [{ path, label }] in the brand-knowledge bucket
  consent boolean not null default false,     -- real people must confirm likeness consent
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_brand_idx on public.people (brand_id);
alter table public.people enable row level security;
create policy "people via brand" on public.people for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
