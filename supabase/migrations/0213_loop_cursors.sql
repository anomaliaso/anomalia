-- 0213 loop_cursors — QUANDO un lavoro ricorrente ha servito l'ultima volta questo brand.
--
-- PERCHÉ ESISTE. Un tick che sceglie i brand con `.from('brands').eq('status','active')` senza
-- `.order()` riceve le righe nell'ordine che decide il pianificatore — in pratica sempre lo stesso.
-- Con una finestra da 300s e un lavoro da ~60s a brand, i primi cinque della lista vengono serviti
-- ogni settimana e gli ultimi mai. Niente fallisce: si degrada. Misurato in produzione il
-- 2026-08-22 su 13 brand attivi: l'audit GEO (cron settimanale) ha servito gli stessi 3 brand per
-- sei settimane di fila, mentre 2 brand non sono MAI stati auditati e 3 una volta in 45 giorni.
--
-- LA CORREZIONE è la stessa che `brands.last_review_at`, `brands.last_crawl_at` e
-- `brands.last_visual_at` già applicano ai loro tre tick (e che in produzione funziona: tutti e 13
-- i brand serviti entro la cadenza): ordinare per "chi ha aspettato di più" e marcare il brand
-- PRIMA di lavorarlo. Questa tabella la rende disponibile a QUALUNQUE loop senza una colonna nuova
-- per ognuno — che è il motivo per cui i loop senza colonna si erano inventati altri gate (una
-- freschezza su una tabella di output, un contatore di successi) tutti affetti dallo stesso difetto.
--
-- NON è `loop_ticks`. Quella è telemetria: scritta in fire-and-forget, che non attende e non lancia,
-- e la sua stessa migration (0199) promette che la retention sarà «un delete per created_at».
-- Potare il log azzererebbe l'equità. Il cursore è stato, il tick è il registro.
--
-- Volume: una riga per (loop, brand). Con 44 cron e la flotta attuale sono decine di righe; anche a
-- mille brand sono decine di migliaia. Nessuna retention: la riga si cancella col brand.
create table if not exists public.loop_cursors (
  -- Stessa chiave di `loop_ticks.loop`: 'geo' | 'autopilot' | 'library' | … Testo, non enum, così
  -- aggiungere un lavoro non richiede DDL — è esattamente ciò che qui deve restare gratis.
  loop text not null,
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Quando il tick ha PRESO questo brand, non quando ha finito: si scrive prima dei gate, così un
  -- brand che non produce niente avanza lo stesso invece di tenersi lo slot per sempre.
  served_at timestamptz not null default now(),
  primary key (loop, brand_id)
);

-- L'unica query di lettura: «i cursori di questo loop per questi brand».
create index if not exists loop_cursors_loop_served_idx on public.loop_cursors (loop, served_at);

-- Solo il service role: è stato operativo dei cron, non dato di brand.
alter table public.loop_cursors enable row level security;
