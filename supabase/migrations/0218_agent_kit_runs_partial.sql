-- DA APPLICARE A MANO: i deploy di questo repo non eseguono le migration.
--
-- Il parziale del turno in corso, per il riaggancio dello stream al reload (live.ts). Il ramo
-- specchio del tee su `toUIMessageStreamResponse`'s `consumeSseStream` lo riscrive ogni ~1s con
-- { text, reasoning?, toolNames?, updatedAt } — quello che GET kit-run/+server.ts espone quando lo
-- stato è ancora attivo, cosicché un client che ha perso il canale Realtime veda comunque il testo
-- crescere a scatti col poll da 4s invece del solo "sta lavorando".
alter table public.agent_kit_runs add column if not exists partial jsonb null;
