-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- LA COMPUTER DEL BRAND, che sembra sempre accesa e non lo è. Forma minima: una riga per brand,
-- non una macchina a stati per bot/scope/controllo umano — non c'è takeover in questo modulo,
-- vedi la nota in computer.ts sul perché waiting_* non tengono accesa la VM.
--
-- STATI: 'stopped' (default, mai provisionata o dormiente col checkpoint salvato), 'running'
-- (VM viva, `provider_ref` è il nome della sandbox), 'error' (provisioning fallito, riportato ma
-- non ritentato automaticamente in v1). Niente 'booting'/'suspending': qui non c'è concorrenza
-- da arbitrare fra processi diversi sullo stesso ensureComputer — vedi il ponytail in computer.ts
-- su upsert+select invece di un claim a due fasi.
--
-- brand_id UNIQUE: una computer per brand, non per bot/scope. Se un giorno serve più di una VM
-- per brand (un bot con la sua), questa riga smette di bastare — non prima.
create table if not exists public.agent_computers (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null unique references public.brands (id) on delete cascade,
  provider_ref text null,
  state text not null default 'stopped' check (state in ('stopped', 'running', 'error')),
  last_touch_at timestamptz null,
  checkpoint_path text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Il sweep (`sleepIdleComputers`) cerca esattamente questa combinazione: running + last_touch_at
-- vecchio. Un indice parziale, non uno generico su tutta la tabella.
create index if not exists agent_computers_running_idle_idx
  on public.agent_computers (last_touch_at)
  where state = 'running';

alter table public.agent_computers enable row level security;

-- Solo lettura per i membri del brand, come agent_kit_runs (0216). Scritture solo dal service
-- role (admin client, bypassa RLS): ensureComputer/touchComputer/sleepIdleComputers girano lì,
-- mai da una sessione utente.
create policy "agent_computers readable by brand members" on public.agent_computers
  for select using (brand_id in (select public.auth_brand_ids()));

-- `agent-homes` — dove il checkpoint del workspace vive fra uno stop e il prossimo risveglio
-- (checkpoint-storage.ts). Stesso stile di 0214_agent_docs_bucket.sql: privato, niente policy di
-- lettura pubblica, ci arrivano solo lo sweep e ensureComputer col service role. Non è materiale
-- da servire dal CDN — sono i file di lavoro di un brand, non asset pubblici.
insert into storage.buckets (id, name, public)
values ('agent-homes', 'agent-homes', false)
on conflict (id) do nothing;
