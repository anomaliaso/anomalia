# Video, carosello e rifinitura senza nominare un brand

`generate_image` sapeva già disegnare senza uno slug (`POST /api/v1/images`, commit `015c8406`).
Gli altri tre no, e non per una decisione di prodotto: il lavoro non era stato finito. Un agente a
cui si chiedeva un video doveva prima scegliere un'azienda a cui addebitarlo — e sceglierla a caso
è esattamente ciò che quella rotta esisteva per togliere.

## Le tre risposte, riusate invece di riscritte

La rotta delle immagini aveva già risolto le tre domande che una strada senza brand solleva, e le
aveva risolte dentro sé stessa. Alla quarta copia sarebbero state quattro versioni divergenti,
quindi sono diventate una funzione: `orgScopeFor` in `cli-auth.ts`, con `openOrgScope(request)`
sopra.

- **Chi paga.** L'organizzazione dell'utente, con la stessa regola con cui atterra un brand nuovo
  (`ensureOrgForUser`: pagante prima, poi la più vecchia). Nessuna → `no_organization`, e ci si
  ferma.
- **Le chiavi ristrette.** Una chiave limitata a certi brand si rifiuta (`brand_scoped_key`): dove
  nessun brand si nomina non c'è niente da confrontare, e lasciarla passare allargherebbe in
  silenzio una restrizione che l'utente ha scelto.
- **Lo stile del brand.** `brandStyleRefusal` — `brand_style_needs_a_brand`, che dice la mossa
  invece di applicare un default silenzioso.

`authenticate` e la decisione sono due mestieri: tenerli insieme rendeva i rifiuti raggiungibili
solo passando da una chiave API vera, quindi non si provavano. `orgScopeFor(caller)` è dove si
provano, uno per uno.

## Dove atterra un video senza brand

Era l'unica vera incognita. Un'immagine risponde sincrona e consegna un percorso; un clip no: kie
ci mette minuti, la richiesta è finita da un pezzo, e a chiuderlo è un cron che ha in mano la sola
riga di `video_renders` — una riga in cui ogni risposta era un brand.

Il file non era il problema: `persistMp4` scrive da sempre sotto `${userId}/generated/…`, nel
bucket pubblico `media`, senza toccare nessun brand. Il problema era tutto ciò che veniva dopo.

La strada scelta è quella che `ai_calls` ha già preso, perché prenderne un'altra darebbe a questa
tabella un secondo vocabolario per la stessa domanda:

```
con un brand   →  video_renders.brand_id → brands.org_id → il pool
senza          →  video_renders.org_id ─────────────────→ lo stesso pool
```

`brand_id` diventa nullable, `org_id` si aggiunge, e `video_renders_one_payer` impone che ne sia
scritto esattamente uno. Il clip senza brand atterra **sulla riga stessa**: `media_url` è dove
sta il file, e `GET /api/v1/videos` lo consegna.

Quello che un clip senza brand NON prende, e perché:

- **nessuna riga in `brand_media`** — la policy di quella tabella dice
  `brand_id in (select auth_brand_ids())`, e `NULL in (…)` vale NULL, non true: una riga senza
  brand sarebbe invisibile a tutti, non visibile a tutti. È lo stesso motivo per cui il disegno
  senza brand consegna un percorso invece di un id;
- **nessuna allocazione mensile** — il numero di video è del PIANO di un brand. Qui il tetto è il
  saldo crediti dell'organizzazione, lo stesso cancello che passa il disegno senza brand;
- **nessun post, nessun thread** — erano già nullable, e questo percorso non li scrive mai.

La policy RLS prende un secondo braccio (`org_id in (select auth_org_ids())`): senza, una riga
senza brand sarebbe leggibile da nessuno — il render avviene, il denaro esce, e la riga è una
scatola nera.

## Come si nomina una sorgente quando una libreria non c'è

Il nodo di `refine_media`. Sotto un brand `base_media_id` è «qualunque asset della libreria di
questo brand», e la risoluzione filtra per `brand_id`. Senza brand non c'è una libreria da cui
pescare.

La maniglia è quella che la strada senza brand consegna già: `storage_path` per un disegno, l'URL
pubblico per un clip. Tutte e due dicono lo stesso percorso, e il suo **primo segmento è lo user** —
la stessa cosa che guarda la policy dello Storage (`media insert own scope`, migration
`20260905140000`). Il percorso di un altro non risolve, esattamente come l'id di un altro inquilino
non risolve sotto il brand. `ownStoragePath` è quella regola, in un posto solo.

**Un URL scelto da chi chiama è stato scartato.** Sarebbe stato un fetch lato server verso un
indirizzo arbitrario — la SSRF appena chiusa in sei punti — e in cambio di una capacità che nessuno
ha chiesto. Qui non si scarica niente da un host esterno: si firma un percorso del nostro bucket.
Una stringa che non è un nostro percorso cade come `source_not_found`.

Il TIPO della sorgente lo dice il file (`storedKind`): senza una riga di libreria il percorso è
tutto ciò che c'è, e un mp4 mandato al motore delle immagini è il difetto che questo percorso
toglie. La tabella `REFINERS` resta una riga per tipo, com'era.

## L'esito con il motivo, ereditato invece di rifatto

Durante questo lavoro `#403` ha corretto un difetto che Andrea aveva trovato usando il prodotto:
una sorgente da 7,47 MB superava il tetto di 6 MB, `fetchImagePart` tornava `null`, e il tool
rispondeva `source_not_found` — «non trovata» per una cosa che c'era. L'agente lo leggeva e
rigenerava da zero, cioè esattamente il danno che `refine_media` esiste per impedire. La correzione
è `loadLibraryMediaPart`, che restituisce un esito col motivo (`too_large` | `not_an_image` |
`fetch_failed`), tradotto in `source_too_large` (413) col peso e il tetto.

La prima stesura di questo ramo faceva l'opposto: `storedImagePart` tornava una parte o
`undefined`, e `runImageJob` schiacciava ogni motivo su `source_not_found`. Fondendola così il
percorso senza brand sarebbe nato con la bugia appena tolta — e peggio, perché lì le sorgenti sono
file che l'utente ha appena caricato, quindi grandi per definizione.

Quindi la forma di `#403` vale su **entrambi** i rami: `libraryImageSource` e `storedImageSource`
tornano lo stesso `SourceOutcome`, e il ramo senza brand eredita gratis sia il messaggio vero sia
il ridimensionamento a 2048px. `refusedSource` prende il peso invece della riga di libreria, perché
senza libreria il peso non è scritto da nessuna parte: `null` è il fatto, e il tetto resta detto.

## Il cancello dei crediti dentro `video.ts`

Tre punti di `video.ts` spendevano guardando `getBrandContext()` soltanto. Sotto uno scope di
organizzazione quella domanda risponde `null`, quindi il cancello sarebbe stato saltato: una clip
pagata da un saldo che nessuno ha guardato. `gateScopedCredits()` è la stessa domanda per tutti e
tre — il brand quando c'è, l'organizzazione quando non c'è.

## Il branch che non è stato ripreso

`feat/brand-free-media` (due commit, mai aperto in PR, 156 commit indietro) portava la migration
`ai_calls_org_id` e lo split di `credits.ts`. Entrambi sono già in `dev` — `readOrgBillingById`,
`orgCreditsUsage`, `gateOrgCredits` e la `sum_org_ai_cost_usd` con il join esterno. Nulla è andato
perso per quella strada; il branch si può cancellare.

## Quello che resta fuori

`regenerate_slide`, `reorder_slides`, `regenerate_post_media` e `make_video` lavorano su una riga
di `posts`, che appartiene a un brand: senza brand non c'è il post da modificare. Restano ancorati,
e un test lo dichiara invece di lasciarlo all'interpretazione.

La lettura di un clip senza brand è REST (`GET /api/v1/videos`), non un tool MCP: `check_media_job`
è stato ritirato apposta dalla superficie dei tool e `query` legge un brand. Un agente collegato
solo via MCP riceve il `job_id` e l'indirizzo dove ritirarlo, ma non ha un tool per interrogarlo.
