-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- Lo stato del run, persistito — il pezzo che Rakazo ha e noi no. `waiting_input` e
-- `waiting_takeover` sopravvivono al reload della pagina e alla morte del processo:
-- lo stato vive nella riga, non nella memoria di un processo che può morire.
--
-- NOME: non `agent_runs` — quel nome è già preso (0106_agent_runs.sql), una tabella di
-- telemetria per-sessione (agent/mode/status/notes/citations) che src/lib/server/agent-runs.ts
-- scrive ancora oggi. Schema e scopo diversi: qui è la macchina a stati di un run che può
-- restare vivo in attesa di un umano, là è un log a cui si aggiunge una riga a fine turno.
-- Chiamarla uguale avrebbe fatto collidere `create table` con quella esistente (o peggio,
-- silenziosamente niente con `if not exists`). Quindi `agent_kit_runs`, dal percorso
-- src/lib/agent/kit/ da cui vengono i contratti (contracts.ts, kit/types.ts).
--
-- Gli stati sono quelli di RUN_STATES in src/lib/agent/contracts.ts, copiati letterali nel
-- CHECK: se cambiano là, questa migration smette di combaciare e va aggiornata insieme.

create table if not exists public.agent_kit_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  thread_id uuid null,
  agent_id text not null,
  user_id uuid null,
  state text not null default 'queued' check (
    state in ('queued', 'running', 'waiting_input', 'waiting_takeover', 'done', 'failed', 'aborted')
  ),
  reason text null,
  question jsonb null,
  lease_until timestamptz null,
  heartbeat_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_kit_runs_brand_state_idx on public.agent_kit_runs (brand_id, state);
create index if not exists agent_kit_runs_state_lease_idx on public.agent_kit_runs (state, lease_until);

alter table public.agent_kit_runs enable row level security;

-- Solo lettura per i membri del brand. Insert/update restano al service role (admin client,
-- bypassa RLS): nessuna policy per authenticated oltre questa select, come in 0109/0205.
create policy "agent_kit_runs readable by brand members" on public.agent_kit_runs
  for select using (brand_id in (select public.auth_brand_ids()));
