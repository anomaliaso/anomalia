-- 0209 Group chats: più agenti dentro lo stesso thread ("room")
--
-- Oggi un thread ha UN agente (`chat_threads.agent`, 0102) più eventualmente un custom agent
-- (0197). Una room è la stessa riga con una lista: chi è nella stanza. Chi parla in un dato
-- momento lo decide il router (src/lib/server/chat/room.ts), non la colonna.
--
-- Perché una jsonb e non una tabella di join:
-- - non c'è stato PER MEMBRO da tenere (niente ruoli, niente ordine editabile, niente permessi):
--   una join table sarebbe quattro policy RLS e una query in più per leggere un array di 2 stringhe;
-- - `getThread` fa già `select('*')`, quindi la colonna arriva gratis dove serve e NON entra in
--   nessuna select condivisa esplicita — la regola che ha già azzerato letture in passato.
--
-- DEGRADO: finché la migration non è applicata la colonna non esiste, `room_agents` si legge come
-- undefined e il thread si comporta esattamente come oggi — un agente solo. Nessun percorso della
-- chat richiede questa colonna per funzionare.
--
-- Formato: array di chiavi membro, ognuna è o un agente di sistema (`content`, `ugc`, `motion`,
-- `web`, `analyst`) o un custom agent dell'utente (`custom:<uuid>`). Nessun vincolo in SQL apposta:
-- la normalizzazione (dedup, tetto di 4, id sconosciuti scartati) sta in `parseRoomAgents`, così
-- un id rinominato lato codice non lascia righe illeggibili nel database.
--
-- Il nome NON è `agents`: quel campo esiste già nella risposta di /chat/threads e porta gli avatar
-- dei custom agent che HANNO GIRATO nel thread. Due cose diverse, due nomi diversi.

alter table public.chat_threads
  add column if not exists room_agents jsonb;

-- Le room sono una minoranza dei thread: indice parziale, si legge solo quando la colonna c'è.
create index if not exists chat_threads_room_idx
  on public.chat_threads (brand_id, user_id)
  where room_agents is not null;
