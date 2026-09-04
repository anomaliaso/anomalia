# L'agente esterno genera verso la libreria, non verso un post

Nel registry c'erano 114 tool e nessuno sapeva **generare** un media. `render_post` è
`POST /posts/:id/render`, `regenerate_post_media` e `make_video` pure: tutti vogliono un post che
esista già. `import_media_url` importa un file fatto altrove, `list_media` elenca e basta. Quindi
per ottenere un'immagine un agente esterno doveva **prima creare un post in calendario**.

Tre conseguenze, tutte sbagliate: si sporcava il calendario per esplorare (tre direzioni visive =
tre post finti da cancellare), l'asset nasceva attaccato a un post invece che nella libreria dove
sarebbe stato riutilizzabile, e il generatore di media era di fatto irraggiungibile — cioè proprio
la cosa che un modello di chat non sa fare da solo. `docs/external-agent-plan.md` dichiarava
"Image generation, video generation, rendering … remain explicit paid Anomalia capabilities":
capacità dichiarate, senza una porta.

## Il vincolo del post era cablaggio, non un vincolo vero

Il censimento lo ha chiarito: `renderPostImage` prende una stringa e nient'altro; `enqueueVideoRender`
accetta `post_id` nullo **da sempre**, e `applyToPost` si apre con `if (!row.post_id) return true;`.
Una rotta in produzione (`content/create-single`) chiamava già `submitAndTrackVideoRender` con
`postId: null`. La strada era aperta e nessuno ci era passato.

Quindi qui non si è costruito un motore: si è aperta una porta su quelli che c'erano.

```
genera → l'asset entra in brand_media → create_post lo attacca con media_ids
```

L'ultimo passo esisteva già e funzionava. Mancava il primo.

## Due tempi, due forme

Immagine e video non si aspettano allo stesso modo, quindi non hanno la stessa forma:

```
immagine  →  sincrona, ~10s   →  { status: 'ready',     media: [...] }
video     →  minuti           →  { status: 'rendering', job_id }  → check_media_job
```

Aspettare un video non era un'opzione da valutare: il poll di kie arriva a 600s contro un muro di
funzione a 300s, quindi chi aspetta muore **sempre** a metà. Si riusa la coda `video_renders` e il
cron che già la drena — nessuna coda nuova, nessuna tabella nuova.

L'unico cambiamento al motore è un ramo nel reconciler: quando `post_id` è nullo il clip va in
libreria via `saveRenderedVideoToLibrary`, con `sourceRef` uguale all'id del lavoro. È così che
`check_media_job` ritrova l'asset **senza una colonna in più** — `brand_media.source_ref` esisteva,
e `source = 'generate'` era già nel CHECK di `0220_widen_source_checks.sql`. Zero migration.

### Effetto collaterale che valeva da solo

`saveRenderedVideoToLibrary` è l'**unica** funzione del repo che deposita un video generato in
`brand_media`, e i suoi due soli chiamanti erano `src/lib/server/chat/job-executor.ts` e
`src/lib/agent/tools/create-content-tools.ts` — entrambi in smantellamento. Sarebbe diventata
codice morto nel giro di una settimana: la porta murata dall'interno mentre la costruivamo. Ora ha
un chiamante che sopravvive, e la correzione nasce dal progetto invece di essere una toppa messa
dopo.

## L'allocazione mensile si conta comunque

`addUsage({ videos: 1 })` viveva **dentro** il ramo del post, e lasciarlo lì apriva un arbitraggio:
genero in libreria, attacco dopo, e il video non conta mai. Non è un difetto teorico — è la
scorciatoia che un cliente attento trova da solo, e la troverebbe prima di noi. Spostata in
`chargeMonthlyVideo`, che gira ovunque il clip atterri. Resta addebitata **all'atterraggio** e non
all'invio, così dieci render rifiutati non si mangiano il margine di un mese.

È una decisione di prezzo, non tecnica, e va detta: da oggi anche i video generati in libreria
consumano l'allocazione mensile.

## Crediti e tetto

Il percorso è quello delle 13 rotte a pagamento che già esistono — `gateAiAction` (403 chiave di
sola lettura, 402 crediti finiti) e poi `withBrandContext`, sotto cui ogni `logAiCall` accredita
il costo al brand giusto. Nessun flag `paid` aggiunto a `BrandEndpoint`: un campo su 14 endpoint
con un consumatore vero è l'astrazione difensiva che questo repo vieta.

La descrizione del tool **apre con il conto** invece di nasconderlo in fondo. È il rovescio esatto
di `import_media_url`, che dichiara di non spendere: se lì lo diciamo, qui lo diciamo.

Il tetto sulle alternative è `MAX_MEDIA_ALTERNATIVES = 4`, definito **una volta** in
`api-contracts` e usato dallo schema zod. Un solo ceiling, non due che divergono: il server non ha
una seconda soglia da tenere allineata, perché è lo schema a rifiutare al confine. Un video per
chiamata e basta — su ~210 crediti un parametro di lotto è un modo per perdere soldi con un errore
di battitura.

## Un contratto che mentiva

Cinque endpoint (`render_post`, `seo_action`, `geo_action`, `refresh_keywords`,
`research_competitors`) chiamavano `gateAiAction` senza dichiarare `credits_exhausted`. Un agente
esterno legge quell'elenco per decidere cosa fare di un errore, e `statusForFailure` degradava quel
402 a **500** — che si legge come "guasto nostro" invece di "crediti finiti". Un contratto che
mente è peggio di un contratto assente.

Corretti in un commit a parte, con un guardiano in `registry.test.ts`, che già inverte `pathFor`
per trovare la rotta su disco: se il file chiama `gateAiAction` e l'endpoint non è una GET, il
contratto deve dichiarare `credits_exhausted`. Le GET sono escluse perché il gate sta sempre
nell'handler che scrive — una GET che condivide il file legge soltanto (verificato su `seo`, `geo`,
`keywords`, `backlinks`).

## Cosa resta fuori, e perché

- **Motion video / Remotion**: vuole sorgente TSX e una riga `motion_videos`, rende in modo
  sincrono per 8 minuti e addebita secondi di sandbox anche quando fallisce. Forma sbagliata per un
  agente esterno.
- **UGC batch**: SSE, affettato su `chat_jobs`, fino a 20 clip. Capacità vera, contratto di lavoro
  molto più grande di questo.
- **`transformVideo`** (refine / motion-control): raggiungibile in teoria — prende un URL di clip,
  non un post — ma il suo unico chiamante sta per essere cancellato, quindi esporlo è una decisione
  separata sul se tenerlo.
- **`design_graphic`**: gratis (satori, nessun modello), senza post, e utile. Vive dentro il loop
  dell'agente media-generator invece che come primitiva chiamabile. Vale un giro suo.
