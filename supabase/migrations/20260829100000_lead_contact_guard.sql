-- ── Lead contact guard: soppressione globale + impronta dell'autore ──────────────────────────
--
-- Due dati, un solo scopo: mai un secondo tocco alla stessa persona.
--
--   lead_suppressions  → chi ha detto "stop" (o l'utente lo ha segnalato) NON viene più proposto
--                        a nessun brand. Globale di proposito: l'opposizione è della persona,
--                        non del cliente. Solo service-role la tocca: RLS attiva senza policy.
--
--   brand_news_items.author_handle / author_platform → l'impronta (piattaforma, handle) scritta
--                        al momento dell'engage. È la chiave con cui il gate riconosce i contatti
--                        passati: status 'posted' o done_at valorizzato = un tocco già dato.

alter table public.brand_news_items
  add column if not exists author_handle text,
  add column if not exists author_platform text,
  add column if not exists gist text;

create table if not exists public.lead_suppressions (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  handle text not null,
  source text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (platform, handle)
);

alter table public.lead_suppressions enable row level security;

create index if not exists idx_lead_suppressions_lookup
  on public.lead_suppressions (platform, handle);

create index if not exists idx_brand_news_items_author
  on public.brand_news_items (author_platform, author_handle)
  where author_handle is not null;
