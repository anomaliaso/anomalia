-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- Il marcatore per il reaper (sweep/+server.ts): quando `onFinish` (live.ts) salva davvero il
-- messaggio assistant, scrive qui il suo id. Prima il reaper indovinava se un run zombie era
-- già stato salvato con un `.ilike('content', primi-40-char%')` — due difetti veri: i primi 40
-- caratteri possono contenere `%`/`_` (wildcard LIKE non escapati → match sbagliato), e due turni
-- con lo stesso incipit collidono. Con l'id in mano il reaper confronta un valore, non indovina
-- un testo.
alter table public.agent_kit_runs add column if not exists partial_saved_msg_id uuid null;
