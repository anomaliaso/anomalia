# La presa persa di un run non fa più girare un turno fantasma

`agent_kit_claim_run` (migration 0229) è dichiarata `returns public.agent_kit_runs`. Quando
l'UPDATE non prende righe — la riga è già di un altro worker, il lease è ancora valido — la
funzione non torna `null`: la riga composita esce tutta NULL, e PostgREST la consegna come
oggetto con ogni colonna a `null`.

`claimRun` controllava solo `if (!data) return null`. L'oggetto passava, e il turno partiva con
`run.id === null`: ogni scrittura filtrata per `id` toccava zero righe, il battito non batteva su
nessuna riga, e `agent_kit_close_run(null)` tornava `closed:false`. Nei log restava solo
`[AGENT_KIT] run null sfrattato prima della chiusura: nessun messaggio salvato` — cioè un turno
pagato per intero al modello che non lasciava niente in chat, e un utente davanti a una domanda
senza risposta.

È esattamente il caso che il commento in `live.ts` («DOPPIO RESUME: due dispositivi rispondono
insieme») dava per chiuso da un 409 ritentabile: il 409 non arrivava mai, perché il perdente
credeva di aver vinto.

Il controllo ora è sulla chiave, non sulla presenza dell'oggetto: `if (!run?.id) return null`.
Chi perde la presa riceve `busy`, il client riaccoda, e nessun run fantasma tocca il database.

## Perché i test non l'avevano visto

Perché i due fake mentivano nello stesso modo: sia `run-store.test.ts` sia `live.test.ts`
rispondevano `{ data: null }` alla presa persa, una risposta che il plpgsql non dà. Rendere
onesti i fake ha fatto cadere da solo un test che esisteva già («un lease ancora valido non si
porta via»). Il test nuovo di `live.test.ts` fa perdere la presa nell'istante fra
`currentWaitingRun` e il claim — senza il fix risponde `200` e deposita un turno, con il fix
risponde `409` e non tocca la riga.

La lezione sta in `LESSONS.md`: un fake che risponde `null` dove il database risponde con una
riga di NULL non è un'approssimazione, è il bug che nasconde.
