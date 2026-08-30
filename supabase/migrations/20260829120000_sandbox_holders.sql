-- Chi tiene viva una sandbox, per nome macchina. Righe con expires_at nel futuro = holder vivi;
-- a zero la macchina si spegne subito invece di correre fino al lease.
create table if not exists public.sandbox_holders (
  id uuid primary key default gen_random_uuid(),
  sandbox_name text not null,
  brand_id uuid not null,
  holder_key text not null,
  kind text not null default 'turn',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists sandbox_holders_name_key_idx
  on public.sandbox_holders (sandbox_name, holder_key);

-- Nessuna policy: scrive solo il service role. I membri non leggono la contabilità delle VM.
alter table public.sandbox_holders enable row level security;
