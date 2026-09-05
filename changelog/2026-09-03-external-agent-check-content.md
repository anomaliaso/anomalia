# Un agente esterno può controllare la copy prima di crearla

Terza slice verticale della Fase 1 del piano [external agent](../docs/external-agent-plan.md),
dopo la creazione e i media. `check_content` prende una content spec e restituisce errori
bloccanti, avvisi, punteggi e il campo esatto da riparare, **senza chiamare nessun modello**.

## Il vincolo che ha deciso tutto

Il piano è esplicito: «Reuse the existing brand context, platform guidance, post templates,
approved rubrics, performance history, deterministic content score, and feasibility checks. **Do
not copy their rules into the MCP adapter.**»

Quindi il lavoro non è stato scrivere delle regole, è stato trovarle. Ce n'erano già,
deterministiche, pure e con dei test:

| Cosa controlla | Dove vive già |
|---|---|
| Limiti di caratteri per piattaforma | `captionViolations` in `platform-limits.ts` |
| Piattaforme che non reggono il solo testo, e YouTube che vuole un video | `VISUAL_REQUIRED_PLATFORMS` / `VIDEO_ONLY_PLATFORMS` |
| Caption vuota o segnaposto | `isPlaceholderCaption` in `prepublish-check.ts` |
| Marcatori `[NEED: …]` | `needMarkers` in `proof-discipline.ts` |
| Indice di qualità 0–100, dodici check pesati | `scoreContentQuality` in `content-quality.ts` |
| Proprietà di un media | `findBrandMediaByIds` in `brand-media.ts` |
| Doppia prenotazione dello stesso minuto | `listCalendarConflicts` in `schedule.ts` |
| Hashtag da reach | `reachChasingHashtags` in `platform-hygiene.ts` |

`content-check.ts` non contiene una sola soglia sua. Contiene **la composizione** — quali di
quei verdetti bloccano e quali avvisano — e la versione di quella composizione.

## Due regole che stavano dentro il percorso che scrive

`need_media`, `need_video`, `over_limit` e `reddit_title` erano una catena di `if` dentro
`createManualPost`: raggiungibili solo creando un post. Un chiamante che voleva sapere se una copy
sarebbe passata, senza creare niente, avrebbe dovuto riscriverle — e due copie di una regola
divergono al primo cambiamento, in silenzio.

Sono diventate `publishBlockers`, una tabella ordinata in `platform-limits.ts`, accanto agli
insiemi di piattaforme e ai limiti che già leggevano. `createManualPost` restituisce il primo
blocker che la tabella trova, nello stesso ordine di prima: l'errore che dà per un dato input non
cambia. Il commit che sposta è separato da quello che aggiunge.

Stessa storia per il preavviso minimo di programmazione (`MIN_SCHEDULE_LEAD_MS`), che è finito in
`schedule.ts` dove stanno le altre regole di calendario.

## Perché una POST che non scrive

`check_content` è una lettura che ha bisogno di un body. Il registry degli endpoint regge GET con
query e POST con body: una POST che calcola e restituisce senza scrivere ci sta, e si dichiara
`destructive: false`.

La route **non chiama `checkApiKeyWriteAccess`**, ma non per lasciar passare le chiavi di sola
lettura: perché sarebbe ridondante. `resolveCaller` in `cli-auth.ts` quel controllo lo fa già, una
volta sola, per **ogni** richiesta che non sia `GET` o `HEAD`:

```ts
// Write scope, enforced once here instead of per-route: a read-only key may only ever read.
// Every mutating CLI route is a non-GET, so the method is the whole check.
```

**Quindi oggi una chiave di sola lettura `check_content` non lo raggiunge**: prende `403` prima
che la route parta. Va detto perché è controintuitivo — un endpoint che non scrive niente,
rifiutato a chi può solo leggere — e perché la causa non sta qui.

`check_content` è il primo POST del repo che **calcola senza scrivere**. Quel commento dice «ogni
route che muta è una non-GET», e resta vero; quello che non è più vero è l'implicito opposto, che
ogni non-GET muti. Cambiare la regola — far dichiarare a un endpoint se scrive, invece di dedurlo
dal metodo — tocca ogni route del repo, e non si fa di straforo dentro la PR che ha trovato il
controesempio. Sta scritto qui perché chi la cambierà sappia che questo endpoint la aspetta.

Una prima versione di questa PR aveva un test che affermava il contrario — chiave di sola lettura,
`200` — e passava soltanto perché `authenticate` era mockato. Un test che asserisce uno stato che
la produzione non può produrre non fallisce mai, e intanto racconta al prossimo lettore l'opposto
della verità. È stato sostituito con quello che fissa il comportamento vero: quando `authenticate`
ha già negato, la route restituisce quel `403` e non calcola niente.

Un verdetto negativo è un `200` con `ok: false`. È un referto, non un cancello: chi chiama vuole
sapere *tutto* quello che non va, non il primo errore con uno status.

## Cosa non c'è, e perché non l'ho inventato

- **Cadenza delle rubriche.** Esiste (`checkRubricsAndBatchFeasibility`), ma è una regola di
  *batch*: pretende i seed di tutta la settimana e i conti attesi per rubrica. Su una singola
  content spec non ha niente da confrontare. Inventare un sostituto per post singolo avrebbe
  prodotto un controllo che finge di essere la regola di Anomalia mentre è una mia — che è peggio
  di un controllo che manca.
- **Qualsiasi giudizio percettivo.** Il piano lo vuole come azione separata e pagata. Qui non si
  guarda un pixel, e il test verifica che né `structured` né `llmStructured` vengano chiamati.
- **`assertRedditCraft`.** Il suo «missing title» duplica `reddit_title`, e deduplicare
  confrontando stringhe di messaggio sarebbe esattamente la condizione sparsa che vietiamo. Il suo
  pezzo unico — il sospetto di self-promo con link — resta per dopo.
- **`link_url` e `subreddit`.** `create_post` li accetta; qui non c'è nessuna regola dietro, e un
  campo dichiarato che non controlla niente è peso morto. Lo schema `.strict()` li rifiuta invece
  di ignorarli, così chi li manda lo scopre subito.

## Le versioni, che sono il punto

Ogni risposta porta `versions: { rules, scorer }`. `CONTENT_SCORER_VERSION` esisteva già e il suo
modulo spiega perché: i campioni si conservano per versione e l'aggregazione si rifiuta di
mescolarle, o una modifica alle regole si legge come una regressione del prodotto. `check_content`
eredita quel vincolo e ne aggiunge uno suo, `CONTENT_CHECK_RULES_VERSION`, che si alza quando una
regola entra, esce, o si sposta fra bloccante e avviso.

## Il registry, di nuovo

Una riga in `BRAND_ENDPOINTS` più la route. Il metodo del client CLI e il tool MCP sono comparsi
da soli — c'è un test in `cli/mcp/create-post.test.ts` che lo dimostra elencando i tool esposti.
Il contratto sta in `packages/api-contracts/src/content.ts`, un file nuovo, perché due PR in
parallelo che aggiungono un endpoint non devono litigare su `posts.ts`.
