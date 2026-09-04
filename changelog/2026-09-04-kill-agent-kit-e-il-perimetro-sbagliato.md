# Via il kit degli agenti — e il perimetro «52k righe di chat» era sbagliato di cinque volte

Ultimo passo dello smantellamento. Se ne vanno il motore a turni del kit
(`agent/bridge/live.ts` e i suoi quattro moduli), i 25 plugin, l'endpoint
`/api/v1/chat/respond/run` e tre moduli di `server/chat/` rimasti senza
chiamanti. Con loro il flag `AGENT_KIT`.

## La cosa più importante di questa giornata: il conto era sbagliato

Il perimetro diceva **52.000 righe di chat**, di cui ~32.000 in
`src/lib/server/chat/`. Ho calcolato la raggiungibilità reale invece di
contare la cartella: si parte da tutto il codice che sopravvive e si segue
ogni import.

**Risultato: 42 moduli su 49 restano raggiungibili da codice vivo. Ne muoiono
7** — poi diventati 3, quando ho scoperto che `harness/run.ts` sopravvive.

Non perché la cancellazione sia rimasta a metà. **Perché quella cartella non
contiene la chat.** Contiene l'infrastruttura di esecuzione in background per
il lavoro lungo degli agenti: la coda `chat_jobs`, i limiti di turno, gli
artefatti, la risoluzione del modello. E i generatori **sono** agenti — girano
per minuti, hanno bisogno di una coda, producono artefatti. Il nome è
sbagliato, non il codice.

La catena che lo dimostra è una sola:
`motion-video/agent.ts → agent/tools/index.ts → chat/queue.ts → tutto il
resto`. Un import tiene in vita ~16.000 righe. Il punto più stretto è
`tools/shared.ts:79`, che importa `chat/queue` per **sei righe**
(`kickChatQueueWork`) con cui drena i lavori in background degli strumenti
lunghi.

**Chi verrà dopo non deve rifare il conto sbagliato.** `server/chat/` andrebbe
rinominata per quello che fa, ma rinominare 42 moduli mentre cinque agenti ci
lavorano intorno è rumore che non paga: sta scritto qui, ed è più utile del
rename.

## Due vie libere che ho fermato, e perché

**`harness/run.ts` e `harness/index.ts` NON si cancellano.** Erano dati per
morti con «esattamente due chiamanti, entrambi della chat». Un grep dice
altro: `harnessStreamText` è chiamato da `media-generator/agent.ts:876` e
`motion-video/agent.ts:757`. Cancellarli avrebbe rotto il generatore di
immagini e il motion video **alla prima generazione**, non in compilazione.

**`/api/v1/chat/queue/work` e `/api/v1/chat/models/sync` NON si cancellano**,
né i loro cron. `kickChatQueueWork` ha **otto chiamanti vivi** — fra cui
`agent-turns.ts`, che sta sul percorso crediti→scheduler di ogni agente, e
`video-render-queue.ts`. Tutti fanno `POST` a `queue/work`: togliere
l'endpoint avrebbe spento il drenaggio dei job in background in silenzio,
perché la chiamata è un `void fetch` con l'errore ingoiato. `models/sync`
scrive `chat_model_catalog`, che leggono `llm.ts` e `chat/model.ts`: il
listino modelli serve anche ai generatori.

Resta cancellabile di quella cartella il solo `respond/run` (311 righe), che
non ha un chiamante in tutto il repo.

## Il ramo kit dentro `queue.ts`

`queue.ts` sopravvive, e importava dinamicamente `bridge/live` per
`shouldUseKit`/`runKitTurn`. Un import dinamico: il typecheck non lo vede, si
sarebbe rotto a runtime. Il ramo era già dietro `AGENT_KIT === 'on'`, spento
di default: 213 righe che senza il bridge non hanno più un motore da chiamare.
Via loro, via il flag.

## I moduli che credevo morti e non lo erano

Il primo calcolo ne dava 7. Con `harness/run.ts` vivo ne restano **3**:

- `controller.ts` — lo importa `harness/run.ts:11` (`controllerPipeline`)
- `job-executor.ts` — lo importa `queue.ts:1344`
- `subagent-jobs.ts` — lo importa `job-executor.ts:442`
- `job-summaries.ts` — lo importa `tool-job-report.ts:18`

Muoiono solo `live-run.ts`, `model-preference.ts`, `agent-kit-approvals.ts`.

## Un orfano nuovo, segnalato e non cancellato

`dropLiveHarnessSession` (`bridge/adapters.ts:371`) aveva un solo chiamante:
`live.ts`. Ora ne ha zero. **Non la cancello**: rilascia la sandbox, vive in un
file condiviso con i generatori, e chi la debba chiamare è una domanda, non
una pulizia. I suoi test di comportamento restano; è caduta solo
l'asserzione che leggeva il motore cancellato.

## L'ADR 0001 è superato

`docs/adr/0001-agent-kit-is-the-only-turn-engine.md` decideva che il kit
avrebbe assorbito **ogni superficie di chat**. Non ce n'è più nessuna. L'ADR
resta agli atti con l'intestazione che lo dice: contraddirlo in silenzio
sarebbe peggio che cancellarlo.

## Tabelle non toccate

`agent_kit_runs` non riceve più righe (nessuno crea run kit), e
`agent-kit-recover.ts` — il reaper di quei run — diventa inerte ma resta.
Nessuna migration: i dati si cancellano quando lo decide Andrea.
