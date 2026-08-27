-- 0204: l'OBIETTIVO di una conversazione — cosa deve essere vero perché il lavoro sia finito.
--
-- Un turno di chat finisce quando il modello smette di chiamare tool. Non quando il lavoro è fatto:
-- sono due cose diverse, e la distanza fra le due è il difetto più caro di un agente. "Ho sistemato
-- gli articoli" dopo averne sistemati sei su dieci non è una bugia deliberata, è un turno che è
-- finito prima del compito — e nessuno se ne accorge finché non va a contare.
--
-- Un obiettivo è la risposta a quel difetto: l'agente, PRIMA di iniziare, scrive cosa dovrà essere
-- vero alla fine, in criteri verificabili uno per uno. Poi li chiude mano a mano. Finché ne resta
-- uno aperto il lavoro non è finito, e il motore lo sa senza doverlo chiedere a nessuno: riprende
-- da solo in background invece di lasciare all'utente il compito di accorgersene e richiedere.
--
-- Tre decisioni che questa tabella incorpora:
--
-- 1. **Appartiene al thread, non al messaggio né al turno.** È il punto: un obiettivo sopravvive al
--    turno che l'ha aperto, ed è l'unico pezzo di stato della chat che deve farlo. L'indice unico
--    parziale impone la regola vera — un solo obiettivo aperto per conversazione. Due obiettivi
--    aperti insieme sono due agenti che si contendono lo stesso turno.
-- 2. **I criteri stanno in una colonna jsonb, non in una tabella figlia.** Si leggono e si
--    riscrivono sempre tutti insieme, con la riga; una tabella a parte pagherebbe una join a ogni
--    turno per una lista di al massimo otto righe che nessuno interroga per conto suo.
-- 3. **`laps` è un contatore di sicurezza, non una statistica.** Ogni ripresa automatica costa una
--    invocazione e dei crediti veri. Il numero di giri che un obiettivo ha già consumato è ciò che
--    permette di fermare una catena che non avanza, invece di scoprirla dalla bolletta.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

create table if not exists public.chat_goals (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,

  -- L'obiettivo in una frase, nella lingua dell'utente: cosa sarà vero quando avrà finito.
  statement text not null,
  -- [{ id, text, status: 'open'|'done'|'dropped', note }] — i fatti verificabili uno per uno.
  criteria jsonb not null default '[]'::jsonb,

  -- 'open' | 'met' | 'handed_back' | 'abandoned'.
  -- 'handed_back' non è un fallimento del sistema: è un obiettivo che ha smesso di avanzare e che
  -- viene restituito alla persona con detto cosa manca. È l'esito onesto, e va distinto da 'met'.
  status text not null default 'open',
  -- Quante riprese automatiche ha già consumato questo obiettivo.
  laps integer not null default 0,
  -- 'agent' quando se lo è dato da solo (il caso normale), 'user' quando l'ha dettato la persona.
  source text not null default 'agent',
  -- Come si è chiuso, in una riga: serve a chi riapre la chat fra un mese, non al modello.
  closing_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- La regola, non un'ottimizzazione: un solo obiettivo aperto per conversazione.
create unique index if not exists chat_goals_one_open_per_thread
  on public.chat_goals (thread_id)
  where status = 'open';

create index if not exists chat_goals_thread_idx
  on public.chat_goals (thread_id, created_at desc);
create index if not exists chat_goals_brand_idx
  on public.chat_goals (brand_id, created_at desc);

alter table public.chat_goals enable row level security;

-- Stessa forma delle policy degli artefatti. La differenza: qui l'UPDATE serve davvero, perché il
-- turno interattivo scrive con il client dell'utente (è l'agente che spunta i criteri mentre
-- lavora), mentre la coda di background passa dal service role.
drop policy if exists "chat_goals_select" on public.chat_goals;
create policy "chat_goals_select" on public.chat_goals for select
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

drop policy if exists "chat_goals_insert" on public.chat_goals;
create policy "chat_goals_insert" on public.chat_goals for insert
  with check (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

drop policy if exists "chat_goals_update" on public.chat_goals;
create policy "chat_goals_update" on public.chat_goals for update
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid())
  with check (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());

drop policy if exists "chat_goals_delete" on public.chat_goals;
create policy "chat_goals_delete" on public.chat_goals for delete
  using (brand_id in (select public.auth_brand_ids()) and user_id = auth.uid());
