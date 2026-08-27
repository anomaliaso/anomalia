-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- UNA COMPUTER PER AGENTE, non più per brand.
--
-- La 0217 diceva: «brand_id UNIQUE: una computer per brand, non per bot/scope. Se un giorno serve
-- più di una VM per brand (un bot con la sua), questa riga smette di bastare — non prima.»
-- Quel giorno è oggi, e il motivo è lo schermo: la VM ha UN display `:1`, quindi due agenti dello
-- stesso brand che usano `observe`/`act` insieme si muovono il puntatore a vicenda, e l'utente che
-- ha preso il controllo del desktop se lo vede scrivere sotto le mani.
--
-- `agent_id` è testo e non una FK: un agente può essere uno specialista di prodotto (`motion`,
-- `web`) oppure un agente custom (uuid di `custom_agent_schedules`). Le due famiglie non vivono
-- nella stessa tabella, quindi la chiave qui è il NOME con cui il resto del codice li distingue.
--
-- La riga per brand che esiste già NON si butta: diventa la macchina «senza agente», quella dei
-- lavori che un agente dietro non ce l'hanno (un cron, uno script).
--
-- `agent_id` è NOT NULL con default stringa vuota, non nullable: con NULL l'unicità avrebbe avuto
-- bisogno di `nulls not distinct` e ogni lettura di un `is null` invece di un `=`. Una stringa
-- vuota è un valore come gli altri, e la macchina del brand è semplicemente quella con agente ''.
alter table public.agent_computers
  add column if not exists agent_id text not null default '';

alter table public.agent_computers
  drop constraint if exists agent_computers_brand_id_key;

create unique index if not exists agent_computers_brand_agent_uidx
  on public.agent_computers (brand_id, agent_id);
