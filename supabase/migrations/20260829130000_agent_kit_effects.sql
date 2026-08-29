-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- IL LEDGER DEGLI EFFETTI DEI TOOL — il pezzo che Rakazo ha come `ExternalEffect` e noi no.
-- Un tool che scrive/post/schedula (pubblicazione, schedulazione, file, render) ha un effetto
-- collaterale reale: se il run muore a metà e riparte, lo stesso tool può essere rieseguito e
-- lo stesso effetto accade due volte. Qui ogni effetto ha una `idempotency_key` deterministica e
-- una macchina a stati: `intended` (registrato PRIMA di eseguire) -> `completed`/`failed`, con gli
-- stati di ripiego `ambiguous` (eseguito ma esito sconosciuto: il segmento è morto) e `reconciled`
-- (confermato a mano/fuori). Prima di rieseguire, l'executor legge per chiave: se esiste già un
-- effetto non-fallback, NON riesegue.
--
-- La chiave NON contiene il run_id: l'idempotenza deve sopravvivere a un resume che riparte da
-- zero e a un takeover, non solo alla ripresa dello stesso run. Contiene brand + nome + args
-- (canonicalizzati), così due turni diversi con la stessa intenzione si riconoscono.

create table if not exists public.agent_kit_effects (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  run_id uuid null references public.agent_kit_runs (id) on delete set null,
  tool_name text not null,
  idempotency_key text not null,
  status text not null default 'intended' check (
    status in ('intended', 'completed', 'failed', 'ambiguous', 'reconciled')
  ),
  request jsonb null,
  result jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un solo effetto per (brand, chiave): la seconda esecuzione della stessa intenzione COLLIDE,
-- e il gate la risolve leggendo la riga invece di rieseguire.
create unique index if not exists agent_kit_effects_brand_key_idx
  on public.agent_kit_effects (brand_id, idempotency_key);

create index if not exists agent_kit_effects_run_idx on public.agent_kit_effects (run_id);
create index if not exists agent_kit_effects_status_idx on public.agent_kit_effects (status);

alter table public.agent_kit_effects enable row level security;

-- Come agent_kit_runs (0216): i membri del brand possono leggere, scrive solo il service role.
create policy "agent_kit_effects readable by brand members" on public.agent_kit_effects
  for select using (brand_id in (select public.auth_brand_ids()));
