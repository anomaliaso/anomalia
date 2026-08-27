-- 0021 brand_documents: user-added knowledge for a brand — free-text notes, uploaded
-- documents (text extracted at upload), and reference images. Feeds rebuildBrandContext().
-- Plus a private `brand-knowledge` storage bucket for the uploaded files.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-04 via MCP.
create table public.brand_documents (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null check (kind in ('note', 'document', 'image')),
  title text,
  content_text text,
  file_url text,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brand_documents_brand_idx on public.brand_documents (brand_id);
alter table public.brand_documents enable row level security;
create policy "brand_documents via brand" on public.brand_documents for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- Private bucket for uploaded docs/images; path-scoped to {userId}/ like the media bucket.
insert into storage.buckets (id, name, public) values ('brand-knowledge', 'brand-knowledge', false)
  on conflict (id) do nothing;
create policy "brand-knowledge read own" on storage.objects for select to authenticated
  using (bucket_id = 'brand-knowledge' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "brand-knowledge insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-knowledge' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "brand-knowledge delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'brand-knowledge' and (storage.foldername(name))[1] = auth.uid()::text);
