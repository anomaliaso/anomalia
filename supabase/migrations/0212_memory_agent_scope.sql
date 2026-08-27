-- 0212: la memoria dell'agente — il MESTIERE, non il brand.
--
-- brand_memory aveva due livelli e nessuna terza dimensione: `layer='project'` (il brand, letto da
-- tutti) e `layer='session' + thread_id` (la singola conversazione). Un agente non aveva niente di
-- suo, perché `unique (brand_id, key)` era un unico spazio dei nomi per brand.
--
-- Questa colonna NON crea un archivio per agente. Aggiunge una dimensione:
--
--   agent IS NULL          → memoria del BRAND. La leggono tutti gli agenti, sempre.
--   agent = 'content'      → nota di MESTIERE di quello specialista ("i caroselli di questo brand
--   agent = 'custom:<uuid>'  rendono col prezzo alla terza slide"). La legge solo lui.
--
-- La grammatica è quella che il prodotto usa già (`custom:<uuid>`, `team:<id>` in agent-owners.ts):
-- niente secondo dizionario.
--
-- LA REGOLA CHE STA IN CODICE, NON NEL PROMPT: 'voice', 'constraint' e 'fact' sono per definizione
-- del brand. Se un agente prova a scriverle come sue, `writeMemory` le riporta a agent=null
-- (memoryAgentScope in brand-memory.ts). Un modello che sbagliasse qui frammenterebbe la
-- conoscenza del brand un pezzo alla volta, in silenzio.
--
-- ⚠️  IL DEPLOY NON ESEGUE LE MIGRATION. Finché questa non è applicata a mano, ogni filtro su
-- `agent` fa tornare VUOTA la lettura di brand_memory (colonna inesistente → errore PostgREST →
-- data null). Applicarla PRIMA di spedire il codice che la usa.

alter table public.brand_memory
  add column if not exists agent text;

comment on column public.brand_memory.agent is
  'NULL = memoria del brand (tutti la leggono). Altrimenti l''agente proprietario della nota di mestiere: un id builtin (content|ugc|motion|web|analyst|auto) o custom:<uuid>.';

-- Unicità: due agenti devono poter avere una nota con la STESSA chiave senza collidere.
--
-- ATTENZIONE, verificato su questo database (PG 17.6) e non a memoria: un indice unico su una
-- colonna NULLABLE tratta ogni NULL come diverso da ogni altro, quindi (brand_id, agent, key) con
-- agent=NULL lascerebbe passare DUE righe di brand con la stessa chiave — cioè romperebbe
-- esattamente il vincolo che c'era prima. `nulls not distinct` (PG 15+) è quello che serve:
-- prova eseguita, indice semplice 2 righe duplicate, `nulls not distinct` 1 sola.
drop index if exists public.brand_memory_project_key_uniq;
create unique index brand_memory_project_key_uniq
  on public.brand_memory (brand_id, agent, key) nulls not distinct
  where layer <> 'session';

-- Stessa cosa per il livello di sessione: nello stesso thread, Content e Motion possono annotare
-- la stessa chiave. thread_id qui è già non-null (CHECK brand_memory_session_scope), agent no.
drop index if exists public.brand_memory_session_key_uniq;
create unique index brand_memory_session_key_uniq
  on public.brand_memory (brand_id, thread_id, agent, key) nulls not distinct
  where layer = 'session';

-- Nessun indice nuovo per la lettura: il filtro è `agent is null or agent = $1` dentro un brand,
-- e brand_memory_core_idx (0113) copre già la scansione per brand. 864 righe di progetto su 37
-- brand — un indice in più sarebbe manutenzione senza un piano da migliorare.
