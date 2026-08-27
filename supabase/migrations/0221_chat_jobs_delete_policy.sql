-- chat_jobs aveva INSERT/SELECT/UPDATE ma NESSUNA policy di DELETE: con RLS attiva una delete
-- col client utente non fallisce, semplicemente non tocca righe (0 rows, error null). Le due
-- azioni della coda («elimina» e «invia ora», chat/+server.ts queue_delete / queue_send_now)
-- cancellavano nel vuoto in silenzio: la riga pending restava, il drain la ripescava — «elimina»
-- non eliminava e «invia ora» duplicava il messaggio.
-- Stesso perimetro delle policy esistenti: membri del brand E proprietari della riga.
create policy chat_jobs_delete on public.chat_jobs
  for delete using (
    (brand_id in (select auth_brand_ids())) and (user_id = auth.uid())
  );
