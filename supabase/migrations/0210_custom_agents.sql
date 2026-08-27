-- 0210 custom_agents — L'AGENTE E LE SUE ROUTINE DIVENTANO DUE COSE DIVERSE.
--
-- Com'era: un "custom agent" ERA una riga di `custom_agent_schedules`. Nome, faccia, brief,
-- giorni, orari ed `enabled` tutti sulla stessa riga. Conseguenze, tutte visibili a schermo:
--   * un agente non poteva avere due routine (due cadenze = due colleghi con la stessa faccia);
--   * un agente non poteva esistere senza una routine (assumere = schedulare);
--   * spegnere la routine spegneva l'agente, e viceversa: un solo interruttore per due decisioni.
-- Per i sei agenti di default il modello giusto c'è già (agente = chi, routine = cosa fa ogni
-- tot: JOB_OWNERS + brand_job_optouts). Questa migration porta i custom nello stesso posto.
--
-- DOPO: `custom_agents` è l'IDENTITÀ (chi è, che faccia ha, qual è la sua consegna permanente,
-- se è in servizio). `custom_agent_schedules` resta la tabella delle ROUTINE, e ognuna dice a chi
-- appartiene nella colonna `agent` già esistente, con il prefisso `custom:<uuid>` che il prodotto
-- usa già ($lib/agent-owners.ts). Nessuna colonna nuova sulle routine.
--
-- ── IL TRUCCO CHE RENDE LA TRANSIZIONE UN NO-OP: L'ID SI RIUSA ────────────────────────────────
-- Ogni riga "agente classico" (quella senza prefisso in `agent`) genera una riga di
-- `custom_agents` CON LO STESSO id. Così tutto ciò che nel prodotto indica un custom agent per
-- uuid continua a indicare la stessa cosa, senza riscrivere una sola chiave:
--   * i thread-diario `surface='team'` + `surface_key='custom:<uuid>'`;
--   * `chat_threads.custom_agent_id` (il thread legato a un custom agent dal composer);
--   * `custom_agent_thread_runs.schedule_id` (la pila di avatar nella sidebar);
--   * le stanze (`chat_room_agents`, chiavi `custom:<uuid>`) e i DM fra agenti.
-- E la riga di partenza diventa la PRIMA ROUTINE di quell'agente (`agent = 'custom:<stesso id>'`),
-- quindi nessuno perde la propria cadenza, il proprio last_run_at o il proprio storico.
--
-- ── ORDINE DEI PASSI (è anche l'ordine sicuro per applicarla a mano) ──────────────────────────
--   1. crea la tabella (nessuno la legge ancora)
--   2. copia le identità, riusando l'id
--   3. lega le righe di partenza al loro nuovo proprietario
--   4. ripunta le foreign key che ora significano "l'agente", non "la schedulazione"
-- Fino al passo 2 il prodotto continua a funzionare com'era: il codice legge `custom_agents` e,
-- se la tabella non c'è ancora, ricade sulle righe senza proprietario (custom-agents.ts).

-- ── 1. L'identità ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.custom_agents (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- La consegna permanente: chi è e come lavora. È il persona che indossa in chat
  -- (custom-agent-persona.ts). Il "cosa fai il lunedì alle 9" sta sulla routine, non qui.
  prompt text not null,
  -- Lo specialista che esegue il suo lavoro (null = auto). Stessa colonna, stesso vocabolario
  -- delle routine, così `resolveAgent` non cambia.
  agent text,
  avatar_face text,
  avatar_color text,
  -- L'INTERRUTTORE DELL'AGENTE: spento sospende tutte le sue routine senza cancellarne nessuna,
  -- e senza toccare il loro `enabled` — riaccendendolo torna esattamente com'era.
  enabled boolean not null default true,
  template_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_agents_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint custom_agents_prompt_len check (char_length(btrim(prompt)) between 1 and 8000),
  constraint custom_agents_avatar_face_chk check (
    avatar_face is null
    or avatar_face in ('wide', 'dot', 'wink', 'sleepy', 'smile', 'happy', 'visor', 'surprise')
  ),
  constraint custom_agents_avatar_color_chk check (
    avatar_color is null or avatar_color ~ '^#[0-9a-f]{6}$'
  )
);

create index if not exists custom_agents_brand_idx
  on public.custom_agents (brand_id, created_at desc);

alter table public.custom_agents enable row level security;

drop policy if exists "custom_agents via brand" on public.custom_agents;
create policy "custom_agents via brand" on public.custom_agents
  for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

-- ── 2. Ogni riga senza proprietario diventa un agente, con lo stesso id ───────────────────────
-- `on conflict do nothing`: la migration si può rieseguire senza duplicare niente.
insert into public.custom_agents (
  id, brand_id, user_id, name, prompt, agent, avatar_face, avatar_color, enabled,
  template_slug, created_at, updated_at
)
select
  s.id, s.brand_id, s.user_id, s.name, s.prompt,
  -- Un prefisso non è mai finito qui (il filtro sotto lo esclude), ma restare espliciti costa nulla.
  s.agent, s.avatar_face, s.avatar_color, s.enabled,
  s.template_slug, s.created_at, s.updated_at
from public.custom_agent_schedules s
where s.agent is null
   or (s.agent not like 'team:%' and s.agent not like 'custom:%')
on conflict (id) do nothing;

-- ── 3. …e la sua riga di partenza diventa la prima routine di quell'agente ────────────────────
update public.custom_agent_schedules s
set agent = 'custom:' || s.id::text,
    updated_at = now()
where exists (select 1 from public.custom_agents a where a.id = s.id)
  and (s.agent is null or (s.agent not like 'team:%' and s.agent not like 'custom:%'));

-- ── 4. Le foreign key che ora significano "l'agente" ─────────────────────────────────────────
-- Un valore che non trova più un agente viene azzerato PRIMA di ricreare il vincolo: puntava a una
-- routine di qualcun altro, cioè a niente di sensato nel modello nuovo.
update public.chat_threads t
set custom_agent_id = null
where t.custom_agent_id is not null
  and not exists (select 1 from public.custom_agents a where a.id = t.custom_agent_id);

alter table public.chat_threads
  drop constraint if exists chat_threads_custom_agent_id_fkey;
alter table public.chat_threads
  add constraint chat_threads_custom_agent_id_fkey
  foreign key (custom_agent_id) references public.custom_agents(id) on delete set null;

-- La pila di avatar nella sidebar dice CHI ha lavorato in quel thread: un agente, non una
-- schedulazione. Le righe che non trovano più un agente sono cronologia di una routine altrui:
-- si buttano, valgono un'icona in meno in una lista.
delete from public.custom_agent_thread_runs r
where not exists (select 1 from public.custom_agents a where a.id = r.schedule_id);

alter table public.custom_agent_thread_runs
  drop constraint if exists custom_agent_thread_runs_schedule_id_fkey;
alter table public.custom_agent_thread_runs
  add constraint custom_agent_thread_runs_schedule_id_fkey
  foreign key (schedule_id) references public.custom_agents(id) on delete cascade;
