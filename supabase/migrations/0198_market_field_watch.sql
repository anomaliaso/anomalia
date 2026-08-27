-- 0198 — Field watch: i post virali NEL CAMPO del brand, catalogati una volta per tutti.
--
-- Il market harvest (0181) scopre per verticali fisse e serve a tarare il rubric; le market
-- references (0132) partono dagli handle dei competitor già noti. Nessuno dei due risponde alla
-- domanda "cosa sta girando adesso nel campo di QUESTO brand, e perché". Questo lo fa: la scoperta
-- è guidata dal brand, i post finiscono nel catalogo GLOBALE (market_posts, deduplicato per
-- platform+external_id), e il teardown è globale anche lui — due brand nello stesso campo trovano
-- lo stesso post e lo pagano una volta sola.
--
-- I deploy NON eseguono le migration. Applicare prima di spedire il codice che legge queste tabelle.

-- Il teardown di un post: come comunica, cosa ha fatto per farsi diffondere, quanto ragebait.
-- Globale e service-role come il resto di market_* (nessuna policy: nulla di questo è per-tenant).
create table if not exists public.market_teardowns (
  id uuid primary key default gen_random_uuid(),
  market_post_id uuid not null references public.market_posts(id) on delete cascade unique,

  tone_of_voice text,             -- l'etichetta breve: "amico che ti avverte", "esperto seccato"
  communication text,             -- registro, persona, ritmo: come parla, non cosa dice
  format text,                    -- il formato strutturale (lista, screenshot + commento, prima/dopo…)
  hook_type text,

  -- Cosa hanno FATTO perché girasse: callout con nome, invito a dissentire, screenshot da salvare,
  -- promessa di seguito, seeding nei commenti. Le leve, non il contenuto.
  spread_strategy jsonb not null default '[]'::jsonb,

  -- 0-10. Non è un giudizio morale: è quanto il post si regge sull'indignazione invece che sul
  -- valore. Serve sia come leva (quando nel campo funziona) sia come tetto — un brand che non
  -- vuole andarci vicino deve poterlo misurare.
  ragebait integer,
  ragebait_levers jsonb not null default '[]'::jsonb,

  why_it_spread text,
  transferable jsonb not null default '[]'::jsonb,   -- mosse concrete riutilizzabili
  avoid text,                                        -- cosa NON copiare, e perché

  model text,
  created_at timestamptz not null default now()
);

create index if not exists market_teardowns_ragebait_idx on public.market_teardowns (ragebait desc);

alter table public.market_teardowns enable row level security;

-- Il legame brand → post del catalogo globale. Il post sta in market_posts una volta sola; qui c'è
-- solo chi lo sta guardando, con la query che l'ha trovato.
create table if not exists public.brand_field_posts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  market_post_id uuid not null references public.market_posts(id) on delete cascade,
  query text,                     -- la query di campo che l'ha fatto emergere
  relevance integer,              -- 0-100: quanto è davvero del campo di questo brand
  discovered_at timestamptz not null default now(),
  unique (brand_id, market_post_id)
);

create index if not exists brand_field_posts_brand_idx
  on public.brand_field_posts (brand_id, discovered_at desc);

alter table public.brand_field_posts enable row level security;

-- I membri leggono i propri; la scrittura è service-role (il tick del campo).
drop policy if exists "field posts via brand" on public.brand_field_posts;
create policy "field posts via brand" on public.brand_field_posts
  for select using (brand_id in (select public.auth_brand_ids()));

-- Il playbook di campo vive accanto alle market references, così il brief del planner resta UNA
-- riga per brand e i due consumatori esistenti (content-preview, produce-agent) lo ricevono senza
-- toccare niente.
alter table public.brand_market_references add column if not exists field_topics jsonb;
alter table public.brand_market_references add column if not exists field_playbook jsonb;
alter table public.brand_market_references add column if not exists field_updated_at timestamptz;
