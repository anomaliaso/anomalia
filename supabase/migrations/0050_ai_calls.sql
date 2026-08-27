-- Observability for every LLM call in the pipeline (onboarding → autopilot loop).
-- One row per call, written fire-and-forget by the server AI wrappers (service role only):
-- label = the call site ('return_editorial_plan', 'renderImage', 'grounded', …),
-- prompt_hash = automatic prompt fingerprint (correlates quality changes with prompt changes
-- without manual versioning), ms/ok/error = the operational signal.
create table if not exists public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  -- Tenant della chiamata. Nato fuori dai migration sul database hosted (aggiunto qui dopo):
  -- senza, le policy RLS e gli indici dashboard dei file successivi non compilano su un replay pulito.
  brand_id uuid references public.brands (id),
  label text not null,
  provider text not null,            -- 'gemini' | 'xiaomi'
  model text,                        -- model id when known at the call site
  prompt_hash text,                  -- sha1 prefix of the prompt text
  prompt_chars integer,              -- prompt size (rough token proxy)
  ms integer not null,               -- wall-clock latency
  ok boolean not null,
  error text,                        -- truncated message on failure
  created_at timestamptz not null default now()
);

create index if not exists ai_calls_label_created_idx on public.ai_calls (label, created_at desc);
create index if not exists ai_calls_created_idx on public.ai_calls (created_at desc);

-- Service-role writes only; no user-facing reads yet.
alter table public.ai_calls enable row level security;
