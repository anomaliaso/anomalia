# I giudizi sui video erano già stati tolti: qui restano solo le tracce

Mandato: togliere i giudizi sui video, misurati in 30 giorni a **$51,52** — `video.review.agent`
(1.387 chiamate, $42,64), `video.review` (447, $8,40), `motion.craft_review` (26, $0,48).

**Non c'era niente da togliere.** Il perimetro è già stato smontato il **29 agosto**, e la ragione
è scritta nel changelog di quel giorno: il modello dietro il giudice ha smesso di accettare file
video, quindi falliva su ogni clip. Le ultime righe in `ai_calls` sono del 30 agosto perché sono la
coda di quella rimozione, non un cron ancora vivo.

Verificato prima di scrivere una riga:

- **nessuna rotta**: sotto `src/routes/api/v1/videos/` esiste solo `render/work`. Né
  `videos/review/work`, né `brands/:slug/videos/review`.
- **nessun cron**: in `vercel.json` non c'è nessuna voce `videos/review`.
- **nessun emettitore**: `video.review.agent`, `video.review` e `motion.craft_review` non compaiono
  in nessun punto del codice che chiami un modello.
- **nessun file**: `video-review.ts` e `video-review-agent.ts` non esistono più.

## La correzione che conta sul numero

**I $51,52 non sono un risparmio da incassare: si sono già fermati il 29 agosto.** Contarli come
mensili ricorrenti li conterebbe due volte, ed è esattamente l'errore che questa verifica evita.
Il costo dei giudizi ancora vivi va misurato senza quelle tre label.

## Cosa resta davvero

**Due tabelle orfane**, che confermano quanto già segnalato dallo sweep del codice morto:
`video_reviews` e `motion_craft_scores` — 620 righe scritte e nessun lettore applicativo.
`motion_craft_scores` compare ancora in un elenco di nomi di tabella dentro
`src/lib/server/chat/query-tool.ts`, che è un elenco e non un lettore (ed è fuori dai file che
posso toccare).

**Non si droppano qui, e sono d'accordo sul perché**: cancellare codice si annulla con un revert,
droppare 620 righe no, e i deploy di questo repo non eseguono le migration. Il drop diventa una
decisione separata quando quelle tabelle non vengono toccate da un mese.

**Due commenti che mentivano**, corretti perché erano peggio di nessun commento:

- `design-judge.ts` diceva al presente che `video-review.ts` «guarda una clip». Non esiste più.
- `market-trends.ts` diceva che `video_url` «è ciò che alimenta il giudice Gemini». Non alimenta
  più niente: la colonna si raccoglie ancora — raccoglierla non costa e ricostruire lo storico
  costerebbe — ma **non ha un consumatore**, e il commento faceva credere di sì.

Sono la ragione per cui questa PR esiste invece di essere solo un messaggio: il prossimo che legge
quei file rifarebbe l'indagine che ho appena fatto.

## I riferimenti pendenti che la rimozione si era lasciata dietro

Cercati apposta, perché togliere una rotta lascia tracce che nessun controllo di import vede.
Verificato anche `scripts/export-oss.mjs`, che tiene liste di percorsi scritte a mano: **non
conteneva nulla di questo perimetro**.

Trovati e sistemati:

- **`textFromGraphicSource`** in `graphic-source.ts` — «visible text … used by video-review
  on-screen copy». Nessun chiamante di produzione: solo il suo test. Rimasta orfana quando il
  giudice è sparito, quindi esce adesso insieme al suo test.
- **`content-quality.ts`** diceva al presente «We already have an LLM judge for media» e citava
  `video-review-doctrine.ts`, un file che non esiste. La regola che quel commento spiegava — la
  seconda persona, il «call out» di Fekri — resta valida: è sopravvissuta al file che la nominava,
  e ora il commento lo dice.
- **`design-judge.ts`** e **`market-trends.ts`**, già descritti sopra.

## Uno che NON ho potuto toccare, e va segnalato

`src/routes/app/[brand]/calendar/page.server.delete.test.ts:26` fa
`vi.mock('$lib/server/video-review-store', …)` su un modulo **che non esiste più**. `vi.mock` con
una factory non fallisce su un percorso inesistente, quindi quel test passa mentre finge di
sostituire qualcosa che non c'è: se domani quella pagina tornasse a caricare i badge, il test non
se ne accorgerebbe. È sotto `src/routes/app/`, fuori dai file che posso modificare.

Nella stessa categoria, e nello stesso stato: `src/lib/server/chat/query-tool.ts` elenca ancora
`motion_craft_scores` fra i nomi di tabella interrogabili — è un elenco, non un lettore, ma nomina
una tabella orfana, ed è sotto `src/lib/server/chat/`.


## E la bugia con più lettori di tutte: `CLAUDE.md`

Segnalata da chi stava aggiornando la skill, e me l'ero persa. La lista di endpoint in `CLAUDE.md`
annunciava ancora due rotte che non esistono:

```
# Video review: POST /api/v1/brands/:slug/videos/review  { url | post_id, standard: organic|ads }
# Auto-score worker: GET/POST /api/v1/videos/review/work (cron */5)
```

`src/routes/api/v1/brands/[slug]/videos/` non esiste, e sotto `src/routes/api/v1/videos/` c'è solo
`render`. È lo stesso difetto dei commenti — un testo che promette una capacità sparita — ma con il
pubblico più ampio: **ogni agente di questo repo carica `CLAUDE.md` all'avvio della sessione**,
quindi era la riga con più probabilità di essere creduta.

Tolte. E già che il file era aperto, **verificate tutte le altre rotte che annuncia**: esistono
tutte. La marcescenza era confinata a queste due, non è un problema del file.
