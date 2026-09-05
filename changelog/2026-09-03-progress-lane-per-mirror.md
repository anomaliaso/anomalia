# La corsia `progress` è dello specchio, non del run

Ogni specchio (`mirrorSseToRun`, `live.ts`) scriveva i suoi snapshot durevoli sotto la chiave
`<runId>:progress:<tick>`, dove `tick` è un contatore che nasce e muore con l'istanza dello
specchio. Finché di uno stesso run gira un solo specchio la chiave è unica; e uno stesso run può
avere due specchi in almeno due modi che capitano davvero:

- la sessione harness riusata non parte, il turno la butta e riprova con una fresca — stesso
  `run.id`, stessa invocazione, secondo stream (`live.ts`, «la sessione riusata non partiva»);
- un worker sfratta il lease di un altro che sta ancora scaricando il suo stream: le scritture su
  `agent_kit_runs` dello sfrattato le ferma il fence, gli append di `thread_events` no.

I due ripartono entrambi da `tick = 1`, con testo diverso: la seconda scrittura è un conflitto di
chiave, `append_thread_event` alza, `publishProgress` chiude la corsia (`progressLane = 'closed'`)
e per tutto il resto del turno nessun evento durevole viene più scritto. In log:

```
[AGENT_KIT] run <id> progress event Error: thread event append failed: thread event source key conflict
```

Chi ricaricava la scheda a metà turno perdeva il log durevole e restava sul solo `partial` —
poll da 4 secondi, testo a scatti. Degradazione silenziosa: nessuno se ne accorge finché non
legge i log.

La chiave ora porta l'identità dello specchio: `<runId>:progress:<mirrorId>:<tick>`. L'idempotenza
resta dov'era davvero utile — una RPC ritentata dallo stesso specchio con lo stesso tick e lo
stesso payload torna la riga di prima — e due specchi non si pestano più i piedi. Il riduttore
(`reduceThreadEvents`) indicizza il progress per `runId`, quindi due corsie dello stesso run
restano una sola voce di proiezione, l'ultima per `seq`; e `pruneRunProgress` pota per `runId`,
quindi le pota entrambe.

## Perché i test non l'avevano visto

Il fake di `append_thread_event` in `live.test.ts` accodava e basta: nessuna chiave unica, nessun
conflitto. Ora ha la semantica della migration 0226 — stessa chiave e stesso payload tornano la
riga esistente, stessa chiave e payload diverso sono un errore. Con quel fake, il test che fa
riprendere lo stesso run da due worker cade sulla chiave contesa `run-dead:progress:1`.
