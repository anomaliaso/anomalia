-- 0207 brand_job_optouts — l'interruttore per brand sui lavori ricorrenti (il "roster").
--
-- PERCHÉ UNA TABELLA DI SOLI NO. Oggi l'unico interruttore per brand è `brands.autopilot_enabled`:
-- tutto o niente. Il roster mostra al cliente la squadra dei lavori ricorrenti e gli lascia
-- spegnerne uno. La forma ovvia sarebbe "una riga per brand per lavoro con un booleano", ed è la
-- forma sbagliata: ogni lavoro nuovo pretenderebbe un backfill su TUTTI i brand, e un backfill
-- dimenticato spegnerebbe in silenzio il lavoro per tutti. Qui si scrive solo il rifiuto esplicito:
--   riga presente = il cliente ha spento quel lavoro
--   riga assente  = acceso (il default, e quindi anche il default di un lavoro che non esiste ancora)
-- Riaccendere è una DELETE. Nessun backfill, mai.
--
-- E il codice deve funzionare anche PRIMA che questa migration giri (i deploy non le applicano):
-- il gate degrada a "acceso" se la tabella non c'è, non a "spento" — vedi jobEnabledForBrand.
create table if not exists public.brand_job_optouts (
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- La chiave del lavoro, la stessa che finisce in `loop_ticks.loop`: 'geo', 'seo', 'radar_recap'…
  -- Testo libero di proposito: un lavoro nuovo non deve richiedere una migration per essere spegnibile.
  job_key text not null,
  disabled_at timestamptz not null default now(),
  -- Chi l'ha spento: quando qualcuno chiederà "perché non gira", la risposta è una persona.
  disabled_by uuid references auth.users(id) on delete set null,
  primary key (brand_id, job_key)
);

-- L'unica lettura che esiste: "tutti i no di questo brand", in un colpo solo (la PK la copre già).

-- Solo il service role: la pagina roster passa dall'admin client dopo che il layout ha già
-- autorizzato il brand, e i cron non hanno un utente.
alter table public.brand_job_optouts enable row level security;
