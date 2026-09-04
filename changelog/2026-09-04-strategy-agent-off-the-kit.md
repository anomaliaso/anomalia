# Lo strategy agent esce dal framework, secondo dei dodici

Segue il week planner e usa la stessa ricetta, senza inventarne una nuova: era il punto —
se il secondo avesse richiesto un'altra forma, la ricetta non sarebbe una ricetta.

Perché questo per secondo: è quello che teneva ancora dentro il week planner. Il planner
importa da qui `agentModel`, `withAgentFallback` e la matematica del budget, e finché
`strategy-agent.ts` importava `$lib/server/harness` il planner ci arrivava lo stesso, in un
passo in più.

## Cosa fa il giro

1. carica il contesto di fattibilità (prodotti e persone con foto, rubriche approvate) e il
   budget del brand in dollari;
2. costruisce system e prompt secondo il modo — `propose`, `propose_next_cycle`, `revise`,
   `replan_week` — e apre un giro a strumenti con tetto di 80 step;
3. dodici letture gratuite dentro il brand, `search_web` (max 12, a pagamento),
   `draft_variants` (max 5, ognuna genera fino a tre varianti in parallelo e ne fa scegliere
   una), `check_feasibility`, `repair_plan` (max 12), `finish`;
4. si ferma dopo cinque step identici di fila;
5. `finish` non chiude se il piano viola ancora la fattibilità;
6. senza `finish` ma con una bozza esce in ripiego; senza niente solleva;
7. scrive `agent_runs`, `ai_calls`, e restituisce piano, note, citazioni, costo e crediti.

## Cosa nascondeva `harnessGenerateText`, qui

Le stesse cinque aggiunte del week planner, e le stesse tre vive su `batch`: la traccia di
sessione, il guardiano, la toppa al system. Ma qui il guardiano non è un dettaglio.

`search_web` è una **ricerca a pagamento**, e `stewardWouldBlock` la blocca finché non è
stata chiamata una lettura del brand. Il modello non riceve un errore — riceve
`blocked_by: 'steward'`, `ran: false`, `next_tool: 'read_brand_studio'` — perché un errore
lo farebbe ritentare, e ritentare una ricerca a pagamento costa. Sul week planner questa
regola era inerte (nessuno dei suoi strumenti è una ricerca a pagamento riconosciuta); qui
è la differenza fra un giro che legge il brand prima di pagare e uno che paga per scoprire
quello che aveva già in casa. Tre test la tengono, ed è la ragione per cui il guardiano
viene portato dietro invece di essere lasciato al framework.

## L'arco che spariva

Prima: `strategy-agent.ts → harness/index → harness/run → chat/model` e `→ chat/controller`
(e da lì `$lib/agent/bridge/verdict`). Adesso quell'arco non esiste più da qui.

Restano, misurati: `credits → scheduler → director → harness/index → …` — cioè
`director.ts`, un altro dei dodici — e `credits → scheduler → agent-turns → chat/queue`,
che è accoppiamento di infrastruttura e non del framework.

## La tabella al posto dell'elenco

Il guardiano in `nested-agents.test.ts` era un array di quattro nomi, e ogni PR della serie
avrebbe dovuto toglierne uno: dodici PR in parallelo sulla stessa riga. Adesso è una
tabella con una riga per orchestratore che dice chi guida il giro — `harness` o `sdk` — e
ogni PR ne cambia una diversa. Le eccezioni stanno in un posto solo, accanto alla regola
che le governa, e si vedono tutte insieme.

## Cosa non cambia

Il cliente non osserva niente: stesso piano, stesse righe in `agent_runs` e
`agent_sessions`, una sola chiamata al giro. Nessun changelog pubblico.
