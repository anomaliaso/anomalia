# Il piano editoriale non ricomincia da capo ogni volta

`onboarding_step_jobs` in produzione: cinque job `research`, quattro `done`, uno **failed con
`Job timed out after 3 attempts`**. Dopo di quello, due soli utenti sono arrivati a `plan_posts` e
uno a `preview_images`. Il criterio della task — *ti iscrivi da zero e arrivi in fondo vedendo i
tre post* — moriva qui.

## Il muro

Il worker `/api/v1/onboarding/steps/work` ha `maxDuration = 300`. Il job `research` fa, in
sequenza: handle dei concorrenti, scraping dei loro post, benchmark, analisi qualitativa, report
di strategia, e infine il piano editoriale. Misurato sullo stack locale (dove nessuno lo uccide a
300s), su un brand con cinque concorrenti:

| fase | tempo osservato |
| --- | --- |
| due chiamate strutturate iniziali | 12s + 12s |
| `strategy_report` | 39s al primo giro, **127s** al secondo |
| `upcomingTimelyHooks` | 56s, 74s |
| lo studio completo, prima che il piano cominci | **8–10 minuti** |

Il piano non veniva quasi mai raggiunto dentro una singola invocazione. Fin qui è fisiologico: il
reaper (`STALL_MS`, sei minuti) rimette il job in coda e il cron `*/2` lo ripesca.

**Il difetto è cosa succedeva al secondo tentativo: ricominciava da `handles`.** In
`runResearchJob` non c'era una sola lettura di `job.result`: i risultati parziali venivano
salvati (`mergeResult`) e mai riletti. Quindi ogni tentativo ripagava scraping, benchmark,
personas e report — e moriva contro lo stesso muro, tre volte, poi `failed`. Verificato dal vivo:
tre tentativi consecutivi hanno riscritto `handles>scraping>benchmark>analysis>strategy` da zero.

## Cosa cambia

Le fasi 1-4 stanno in `runMarketStudy()`, che alla fine deposita anche `planInputs` — quello che
al piano serve dello studio quando lo studio non c'è più: `aiContext`, `visualStyle`, i `topPosts`
del brand e `zeroToOne`. `resumableStudy(job.result)` decide, e restituisce lo studio **solo se
ogni pezzo è sopravvissuto**: uno studio a metà non serve, il piano girerebbe senza i propri
input.

E il budget dei tentativi si azzera quando lo studio è depositato. Senza, i tentativi spesi per
arrivarci restavano addebitati al piano — che da lì in poi riparte in pochi secondi — e un job
che aveva finalmente fatto progresso durevole veniva comunque fallito.

## Il limite che resta

La ripresa ha una sola giuntura, dove cade il muro dei 300s: studio → piano. Un tentativo che
muore *dentro* lo studio (per esempio nello scraping) lo rifà tutto. Frammentarlo di più
significa persistere lo stato intermedio di ogni fase, e non serve finché il punto in cui si muore
è quello misurato qui.

## Nota per chi verifica in locale

In locale non gira nessun cron: un job che stalla non riparte più e il wizard resta a *«Drafting
your editorial plan…»* per sempre. Non è il difetto — è l'ambiente. Sta in [`LESSONS.md`](../LESSONS.md).
