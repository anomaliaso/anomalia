-- 0199 loop_ticks — un esito per OGNI brand valutato da un tick, non solo per chi arriva in fondo.
--
-- Perché serve. `agent_runs` nasce solo quando un agente completa (o fallisce dentro) il suo loop:
-- un brand scartato da un gate — piano free, nessun dato, già fresco — non lascia traccia, e un
-- crash prima di persistAgentRun non ne lascia nemmeno lui. Risultato: "0 righe in agent_runs" non
-- distingue "mai stato eleggibile" da "è esploso ogni volta", che è esattamente la differenza da
-- sapere quando un loop sembra morto (vedi docs/38-salto-di-qualita.md §1).
--
-- Una riga per (loop, brand, tick). Volume: ~40 cron × pochi brand per run, cioè ordine delle
-- decine di righe al giorno: nessuna retention per ora, e quando servirà sarà un delete per
-- created_at. Meglio dirlo che promettere un cleanup che non c'è.
create table if not exists public.loop_ticks (
  id uuid primary key default gen_random_uuid(),
  -- Quale ciclo: 'analytics_review' | 'autopilot' | 'seo' | 'radar' | 'field' | …
  loop text not null,
  brand_id uuid references public.brands(id) on delete cascade,
  -- 'ok' = il loop ha fatto il suo lavoro; 'skipped' = un gate lo ha escluso; 'failed' = ha provato ed è andato male.
  outcome text not null check (outcome in ('ok', 'skipped', 'failed')),
  -- Il MOTIVO, che è il punto di tutta la tabella: quale gate, o quale errore.
  reason text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

-- La query di lettura è sempre "ultimi esiti di questo loop" o "ultimi esiti di questo brand".
create index if not exists loop_ticks_loop_created_idx on public.loop_ticks (loop, created_at desc);
create index if not exists loop_ticks_brand_created_idx on public.loop_ticks (brand_id, created_at desc);

-- Solo il service role scrive e legge: è telemetria operativa, non dato di brand.
alter table public.loop_ticks enable row level security;
