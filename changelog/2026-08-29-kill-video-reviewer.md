# 2026-08-29 — Kill video reviewer

## Cosa c'era

Il media reviewer giudicava i clip finiti (organico vs ads) con un giudice multimodale:
scaricava l'mp4, estrae still + audio con ffmpeg e chiedeva un verdetto `ship|fix|kill`
con punteggi per dimensione. Le superfici erano molte:

- Endpoint `POST /api/v1/brands/:slug/videos/review` e worker `/api/v1/videos/review/work`.
- Tool `review_video` in tre varianti (chat content, post-editor, media-generator) + le
  annotazioni `media_review` su read_posts e post-editor.
- QC automatica dei motion video: `motion-video/qc.ts` (loop review → remake), `craft-review`,
  `craft-scores`, `reference-fidelity`, job `motion_video_qc`, azione `qc` del workbench.
- Auto-review nei percorsi UGC: remake della presa sui punteggi in `ugc-batch` e
  `media-generator/agent`, accodamento review su ogni render/upload/produce.
- Pagine e componenti: settings Media reviewer, `/videos/review`, `/videos/scores`,
  `VideoReviewPanel`, `VideoScoreRing`, `VideoScoreNote`, `MediaReviewStatsPanel`,
  badge nel calendario e le medie di recensione nella home/analytics.
- Weak reviews nel recap settimanale (email + testo) e i relativi action item.
- Tabelle: `video_reviews`, `market_video_analyses`, `motion_craft_scores` (solo colonne
  fidelity in `motion_video_references` restano utili — nessuna migration scritta, le tabelle
  restano vuote: pulizia futura, non urgenza).

## Perché è morto

1. **Rotto a monte**: il provider centrale non supporta più i file part `video/mp4`
   ('file part media type video/mp4' functionality not supported) — ogni giudizio falliva,
   ovunque, da giorni. Il reviewer non era più una feature, era un rumore di errori.
2. **Costo del percorso alternativo**: il fix sarebbe stato estrarre frame e passare immagini;
   costa ffmpeg per clip e riapre il budget di giudizi su superfici che i dati di utilizzo
   mostrano poco usate (le recensioni richieste a mano erano una frazione delle automatiche).

## Decisioni

- **Kill completo, non smontaggio**: a differenza del precedente smontaggio da chat
  (`CHAT_REVIEW_VIDEO`), qui l'implementazione è cancellata. Riattivare significa ripartire
  dallo storico (tag/git), non decommentare.
- **Le utility di fetch sopravvivono**: `fetchVideoBytes`, `prepareReviewMedia`, la durata
  mp4 e i frame etichettati servono anche a `video-breakdown` (UGC) e `motion-references`
  (parete riferimenti). Estratti in `src/lib/server/video-fetch.ts`, senza logica di giudizio.
- **Il QC-remake UGC muore col giudice**: il loop "score < 7 → rifai la presa" non ha senso
  senza punteggi. Le clip UGC/motion escono al primo render; la voce-gate di motion resta
  (controlla il sorgente, non l'mp4).
- **`motion_craft_scores` letti da `unfinished.ts` e `agent-files.ts` sostituiti** da un
  criterio di consegna più onesto e più semplice: il video è consegnato quando c'è un
  `preview_url`. La definizione precedente (verdetto `ship`) era ormai non raggiungibile.
- **Niente rimozione dati**: tabelle e migration restano; una pulizia può venire dopo, quando
  la misura del rumore residuo lo giustifichi.

## Cosa non è stato fatto

- Nessun fix "estrae i frame e riprova": giudicato non pagato dal dato d'uso.
- Nessuna migration di drop: le tabelle restano (vedi sopra).
