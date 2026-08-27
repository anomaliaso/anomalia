-- 0214 — `agent-docs`: lo specchio di cosa leggono gli agenti.
--
-- PERCHÉ. I file che gli agenti leggono (`how/*.md`) vivono in codice e si aggiornano col deploy,
-- che è giusto: hanno i loro test, e il ricettario esiste in una forma sola — quella che il suo
-- test compila. Ma finché vivono SOLO in codice, il proprietario non ha modo di vedere con i
-- propri occhi cosa l'AI va a leggere: è una scatola nera.
--
-- Questo bucket la apre, e la struttura delle cartelle è la sicurezza:
--   defaults/how/…    scritto da noi da `syncAgentFiles()`, rigenerato, = ciò che dice il codice
--   overrides/how/…   scritto dal proprietario, VINCE quando c'è, cancellarlo è il rollback
--   INDEX/<agente>.md l'indice vero che quel mestiere riceve nel prompt, generato dalla stessa
--                     funzione che riempie il prompt (`filesIndexFor`), mai scritto a mano
--
-- Il riallineamento tocca solo `defaults/`: non può cancellare niente di suo. Non è un controllo
-- che qualcuno può dimenticare — è la forma delle cartelle.
--
-- PRIVATO. Nessuna policy di lettura pubblica: ci si arriva dalla dashboard Supabase (proprietario)
-- e dal service role (`syncAgentFiles`, `readAgentFile`). Non c'è niente di segreto dentro, ma è
-- il testo con cui gli agenti costruiscono: non è materiale da servire dal CDN.

insert into storage.buckets (id, name, public)
values ('agent-docs', 'agent-docs', false)
on conflict (id) do nothing;
