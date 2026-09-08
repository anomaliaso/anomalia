# Media del post e settimana: pesate coi quattro criteri, non ne regge nessuna delle due

`changelog/2026-09-07-write-families.md` ha pesato quattro famiglie e ne ha collassata una. Restavano
due mai guardate — le quattro rotte che toccano i media di un post, e le quattro che toccano una
settimana — entrambe date per interamente additive dal registro (`destructive: false` su tutte e
otto). L'argomento duro, quello del `destructiveHint`, non avrebbe morso nessuna delle due.

**Il registro sbagliava su una.** E il metodo che lo ha scoperto è l'unico che conta: aprire gli
handler invece di leggere il flag.

## I quattro criteri

1. Le forme di risposta stanno in un tipo solo?
2. Il nome di famiglia è meno vago di quelli che sostituisce?
3. Sbagliare un campo fa un danno peggiore di sbagliare tool?
4. Un membro può fallire in un modo che gli altri non conoscono?

Il quarto è il più selettivo, ed è quello che ha deciso di nuovo entrambe.

| famiglia | tool | forme diverse | fallimenti comuni | esito |
|---|---|---|---|---|
| media del post | 4 | 4/4 | 0 | **separata** |
| settimana | 4 | 4/4 | 0 | **separata** |

## Media del post: i quattro membri si escludono a vicenda per costruzione

`render_post`, `regenerate_post_media`, `regenerate_slide`, `reorder_slides`. Quattro forme di
risposta su quattro, con campi disgiunti: `{ok, url}`, `{success, rendered, media_url, notes}`,
`{success, slide_index, rendered}`, `{success, slide_count}`.

Ma il fatto che chiude il discorso non è la forma, è **su quale post ognuno lavora**:

| tool | rifiuta | messaggio |
|---|---|---|
| `render_post` | un post che HA già un'immagine | `Post already has an image` — con HTTP **200** |
| `regenerate_post_media` | un carosello | `This is a carousel — edit a specific slide instead.` |
| `regenerate_slide` | un post che NON è un carosello | `This post is not a carousel.` |
| `reorder_slides` | un post che NON è un carosello | `This post is not a carousel.` |

`render_post` lavora esattamente sui post che gli altri tre rifiutano, e `regenerate_post_media`
esattamente su quelli che gli altri due rifiutano. Un tool solo risponderebbe con un rifiuto scelto
dalla **forma del post**, non dal campo mandato: chi chiama non può prevedere la risposta dal tool
che ha aperto, che è il criterio 4 nella sua forma più netta. E `render_post` non condivide nemmeno
il codice: gli altri tre passano da `postMediaTarget` e `post-editor-tools`, lui carica il brand kit
e tutti i prodotti e chiama `renderPreviewImages`.

Il costo, come per `import_media_url`: `reorder_slides` è l'unico gratuito ed è l'unico senza
`gateAiAction`; gli altri tre fatturano un render. Il segnale di prezzo vive nel nome.

### E il flag additivo era falso

**`reorder_slides` distrugge.** `order` non riordina soltanto: è l'elenco di ciò che RESTA, e
`restructureCarouselSlides` scrive `media_urls = order.map(i => urls[i])`. Un `[0, 2]` su un
carosello da cinque slide ne cancella tre dalla riga, senza che il chiamante le abbia mai nominate
e senza ritorno. Il registro dichiara `destructive: false`, e `docs/mcp-tool-review.md` §9 lo
segnalava già.

Quindi la famiglia **contiene** un verbo che distrugge, e l'argomento duro morde: un tool solo
davanti a queste quattro rotte porterebbe UNA annotazione per un'operazione che toglie e tre che
non tolgono, ed è la meccanica per cui `ads_action` fa avvisare su `sync` e su `propose`.

Il fatto è pinnato da un test — `src/lib/agent/tools/carousel-reorder.test.ts` — che le rotte
accanto non potevano avere: `server.actions.test.ts` mocka `restructureCarouselSlides` e verifica
l'inoltro degli argomenti, non cosa succede alla riga. **Il flag non è stato corretto qui**:
farlo passare a `true` cambia quando i client chiedono conferma a una persona, ed è una decisione
di prodotto, non una correzione di contratto. Il test porta la contraddizione come asserzione, così
scade da sé quando qualcuno la ripara.

## Settimana: quattro tool, tre bersagli, due tabelle

`plan_week`, `replan_week`, `save_week_seeds`, `save_brief`. Quattro forme di risposta su quattro —
`{ok, draft}`, `{ok, week}`, `{ok, draft_id, week_index, seeds_saved, editorial_plan_id, replaced,
review_url}`, `{ok}` — e due che spendono crediti accanto a due che non spendono, che è il verdetto
già scritto in `docs/mcp-tools.md`. Ma non è quello che decide.

| tool | scrive | costo |
|---|---|---|
| `plan_week` | INSERISCE una riga `content_plans` (bozza) | crediti |
| `save_week_seeds` | AGGIORNA la bozza `content_plans` che c'è, o la apre | gratis |
| `replan_week` | AGGIORNA `editorial_plans.weeks[i]` — **il piano ATTIVO** | crediti |
| `save_brief` | AGGIORNA `editorial_plans.weeks[i].brief` — **il piano ATTIVO** | gratis |

Non è un soggetto solo: sono due coppie su due tabelle diverse, e su due radici di rotta diverse
(`/weekly-plan/*` e `/editorial-plan/*`). E `save_week_seeds` è l'unico che **funziona senza un
piano attivo** — risponde `editorial_plan_id: null` — mentre gli altri tre rispondono 404
`No active editorial plan`. Criterio 4: un tool solo risponderebbe 404 o no a seconda di un campo,
per uno stato del brand che chi chiama non vede dal tool che ha aperto.

Il nome, criterio 2: `plan_week` è già il migliore del gruppo. Un `week` o un `set_week` unificato è
più vago di tutti e quattro.

### Il `reschedule_post` di questa famiglia

**`replan_week` riscrive una settimana del piano ATTIVO, in posto.** Carica il piano `status =
'active'` e fa `.update({ weeks })`. Nel resto della famiglia del piano quella riga è intoccabile e
lo dicono tutti: `save_plan` — *«the brand active plan is left untouched»*; `revise_plan` — *«the
active plan is untouched until approve_plan»*; e `approve_plan`, l'unico documentato come quello
che sostituisce il piano attivo, è anche l'unico con `destructive: true`.

`replan_week` porta `destructive: false` e la sua descrizione dice soltanto *«replaces that week»*,
che accanto a `plan_week` si legge come la bozza della settimana. Non è quella: è una settimana del
piano che il brand sta seguendo, e non torna.

**Non è stato corretto qui**, per la stessa ragione di `reschedule_post`: è un cambiamento su cosa
un tool ha il diritto di sostituire, non una correzione di forma. Sta scritto perché il prossimo che
apre la famiglia lo trovi già trovato.

### Due cose trovate di striscio, che vivono fuori da questa decisione

- **Nessuna delle quattro rotte di pianificazione a pagamento chiama `gateAiAction`.**
  `propose_plan`, `revise_plan`, `plan_week` e `replan_week` chiamano un modello senza controllare
  né il piano né i crediti; l'unico che gatta è `produce_week`. Il cancello dello scope in
  scrittura c'è (`authenticate` lo applica una volta per tutte le rotte non-GET), quello dei
  crediti no.
- **`plan_week` INSERISCE una bozza nuova** dove `save_week_seeds` aggiorna quella che c'è, e il
  commento del secondo spiega perché: *«a brand keeps ONE week draft in review — the plan page reads
  the newest and a second row would hide the first»*. La descrizione di `plan_week` dice
  «replaces the week draft in review», ed è vero solo per ombra: le righe si accumulano.

## `produce_week` sta nella famiglia e resta fuori lo stesso

È registrato a mano (`cli/mcp/tools/plan.ts`) perché fa due chiamate: legge il piano per trovare
l'id della bozza, poi produce. È l'unico che crea POST, l'unico che fattura per post, e ha un
fallimento suo — `No weekly seeds draft found` — che nessuno degli altri quattro conosce. Criterio 4
di nuovo, e stavolta anche il criterio 3: sbagliare campo qui produce una coda di post veri.

## Il conto

Nessuno, ed è il punto: **84 tool / 91.158 caratteri** prima e dopo, misurati su questo branch col
transport. Due famiglie pesate, due «no» con il motivo, un fatto pinnato da un test che prima non
c'era e due difetti nominati dove il prossimo li trova. Il rientro di caratteri di questa giornata
viene da un'altra parte — i quattro CRUD di una riga, `changelog/2026-09-08-retire-row-crud.md`.
