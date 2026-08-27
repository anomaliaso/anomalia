-- 0201 — L'esito dei lead: cosa è successo al commento dopo che l'hai incollato.
--
-- Finora il loop si chiudeva su "fatto" e finiva lì. Misuravamo solo processo — item trovati, lead
-- scritti, profili costruiti — e zero risultati: se una bozza abbia mai ottenuto una risposta, un
-- upvote o una rimozione non lo sapeva nessuno. Senza questo si ottimizza alla cieca, e "sembra
-- meglio" resta un'opinione.
--
-- I deploy NON eseguono le migration. Applicare prima di spedire il codice che legge queste colonne.

-- Quando il lead è stato segnato come fatto. Serve a sapere QUANDO ricontrollare: prima di 48h il
-- punteggio di un commento non si è ancora assestato.
alter table public.brand_news_items add column if not exists done_at timestamptz;

create index if not exists brand_news_items_done_at_idx
  on public.brand_news_items (done_at) where done_at is not null;

-- Un'osservazione per controllo, non un verdetto sovrascritto: lo stesso commento a 48h e a una
-- settimana racconta due cose diverse, e la seconda non deve cancellare la prima.
create table if not exists public.lead_outcomes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.brand_news_items(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  checked_at timestamptz not null default now(),

  -- Il commento lo pubblica l'umano con il suo account, quindi non sappiamo quale sia: lo
  -- ritroviamo per somiglianza col testo che avevamo scritto. `method` dice come è stato trovato e
  -- `match_score` quanto è stata sicura la corrispondenza — un esito trovato male vale meno di un
  -- esito non trovato, e va potuto distinguere a posteriori.
  found boolean not null,
  method text,                    -- 'text' | 'handle' | null quando non trovato
  match_score numeric,

  upvotes integer,
  replies integer,
  -- Thread ancora vivo ma commento sparito = rimosso o cancellato. È il segnale più prezioso che
  -- abbiamo sulle regole di una community, e l'unico che si prende solo tornando a guardare.
  removed boolean,

  comment_url text,
  raw jsonb,

  unique (lead_id, checked_at)
);

create index if not exists lead_outcomes_brand_idx on public.lead_outcomes (brand_id, checked_at desc);
create index if not exists lead_outcomes_lead_idx on public.lead_outcomes (lead_id, checked_at desc);

alter table public.lead_outcomes enable row level security;

-- I membri leggono i propri; la scrittura è service-role (il worker degli esiti).
drop policy if exists "lead outcomes via brand" on public.lead_outcomes;
create policy "lead outcomes via brand" on public.lead_outcomes
  for select using (brand_id in (select public.auth_brand_ids()));
