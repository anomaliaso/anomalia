-- 0205: il diario degli obiettivi — cosa è successo, non solo com'è finita.
--
-- `chat_goals` tiene lo STATO: la frase, i criteri con il loro stato, quanti giri ha consumato,
-- come si è chiuso. È abbastanza per la card in chat e per il prompt del turno dopo, ed è
-- esattamente ciò che non basta per la domanda che conta davvero su una funzione come questa:
-- **funziona?**
--
-- Perché quella domanda non si risponde guardando una riga finale. Un obiettivo chiuso come
-- raggiunto può esserlo stato al primo colpo o dopo tre riprese; uno restituito alla persona può
-- essersi fermato perché era impossibile o perché l'agente girava a vuoto; e un criterio buttato
-- con una ragione dice più di dieci criteri spuntati. Lo stato finale schiaccia tutto questo in
-- una parola sola, e cancella per sovrascrittura la storia che serviva a capire.
--
-- Da qui una tabella in sola aggiunta: una riga per ogni cosa che succede a un obiettivo —
-- aperto, aggiornato, deciso a fine turno, chiuso. Tre proprietà volute:
--
-- 1. **I contatori sono colonne, non JSON.** `criteria_done`, `criteria_total`, `laps` stanno
--    fuori dal payload perché le domande vere sono aggregate ("quanti obiettivi si chiudono senza
--    riprese?", "quanti si fermano per no_progress?") e una query che deve aprire un jsonb per
--    ogni riga è una query che nessuno scrive due volte.
-- 2. **`reason` è la parola del motore, non un testo libero.** È lo stesso vocabolario di
--    `decideGoalContinuation` (open_criteria, out_of_time, no_progress, laps_exhausted, stalled,
--    met…): è ciò che rende confrontabili due righe scritte a un mese di distanza.
-- 3. **Il goal può sparire, l'evento resta finché resta il brand.** `goal_id` è on delete set
--    null: cancellare una conversazione non deve riscrivere la storia di com'è andata.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

create table if not exists public.chat_goal_events (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references public.chat_goals(id) on delete set null,
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  thread_id uuid references public.chat_threads(id) on delete set null,

  -- 'opened' | 'updated' | 'settled' | 'closed'
  kind text not null,
  -- La ragione, nel vocabolario del motore: per 'settled' la decisione, per 'closed' l'esito.
  reason text,
  -- 'agent' | 'user': chi ha causato l'evento. Un obiettivo dettato e uno dedotto non si
  -- confrontano fra loro, e senza questa colonna finirebbero nella stessa media.
  actor text not null default 'agent',

  criteria_done integer not null default 0,
  criteria_total integer not null default 0,
  /** Quanti se ne sono chiusi in QUESTO evento: è la misura dell'avanzamento, non del totale. */
  criteria_closed_now integer not null default 0,
  laps integer not null default 0,
  /** Profondità della catena di riprese quando l'evento è stato scritto. */
  depth integer not null default 0,
  /** La ripresa è stata davvero accodata? Distingue una decisione da un fatto. */
  queued boolean,

  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_goal_events_brand_idx
  on public.chat_goal_events (brand_id, created_at desc);
create index if not exists chat_goal_events_goal_idx
  on public.chat_goal_events (goal_id, created_at);
create index if not exists chat_goal_events_thread_idx
  on public.chat_goal_events (thread_id, created_at desc);

alter table public.chat_goal_events enable row level security;

-- Stessa forma delle policy di chat_goals. Nessun update, nessun delete: è un diario, e un diario
-- che si può riscrivere non serve a rispondere alla domanda per cui esiste.
drop policy if exists "chat_goal_events_select" on public.chat_goal_events;
create policy "chat_goal_events_select" on public.chat_goal_events for select
  using (brand_id in (select public.auth_brand_ids()));

drop policy if exists "chat_goal_events_insert" on public.chat_goal_events;
create policy "chat_goal_events_insert" on public.chat_goal_events for insert
  with check (brand_id in (select public.auth_brand_ids()));
