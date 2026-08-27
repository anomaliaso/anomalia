-- Session-scoped brand memory (docs/24 §2.3 / Fase 3).
-- Session rows MUST carry thread_id; project/global stay brand-wide.

alter table public.brand_memory
  add column if not exists thread_id uuid references public.chat_threads(id) on delete cascade,
  add column if not exists promoted_at timestamptz,
  add column if not exists promoted_by uuid references auth.users(id) on delete set null;

create index if not exists brand_memory_thread_idx
  on public.brand_memory (thread_id) where thread_id is not null;

do $$ begin
  alter table public.brand_memory add constraint brand_memory_session_scope
    check (layer <> 'session' or thread_id is not null);
exception when duplicate_object then null; end $$;

-- Old unique (brand_id, key) blocked session keys per thread and session vs project.
-- Replace with partial uniques.
alter table public.brand_memory drop constraint if exists brand_memory_brand_id_key_key;

create unique index if not exists brand_memory_project_key_uniq
  on public.brand_memory (brand_id, key) where layer <> 'session';

create unique index if not exists brand_memory_session_key_uniq
  on public.brand_memory (brand_id, thread_id, key) where layer = 'session';
