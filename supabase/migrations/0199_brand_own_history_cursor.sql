-- 0199 brands.own_history_at — "questo brand ha dati propri, e di quando sono".
--
-- Il tick dell'analytics review deve poter chiedere al DB *solo i brand su cui ha senso girare*.
-- Finora l'eleggibilità (almeno una riga social_post_history con source='zernio') si controllava
-- DOPO aver preso 2 brand a caso dal round-robin: con ~4 brand eleggibili su 84, il giro completo
-- durava 42 giorni e i 79 non eleggibili consumavano 79 slot per ciclo. Denormalizzando qui, la
-- selezione diventa una scansione d'indice e il round-robin gira sui soli brand che hanno dati.
--
-- Stesso pattern dei cursori già presenti su brands (last_review_at, 0150). Serve anche al
-- "doctor" del brand: quanti giorni sono passati dall'ultimo dato proprio è la risposta più
-- frequente alla domanda "perché l'AI non adatta niente".
alter table public.brands
  add column if not exists own_history_at timestamptz;

-- Backfill dallo storico già presente: senza, ogni brand esistente resterebbe invisibile al tick
-- finché non pubblica di nuovo.
update public.brands b
set own_history_at = s.last_own
from (
  select brand_id, max(coalesce(published_at, synced_at)) as last_own
  from public.social_post_history
  where source = 'zernio'
  group by brand_id
) s
where s.brand_id = b.id
  and b.own_history_at is null;

-- Parziale: la sola query che lo usa filtra già su status='active' e own_history_at not null.
create index if not exists brands_own_history_review_idx
  on public.brands (last_review_at)
  where status = 'active' and own_history_at is not null;
