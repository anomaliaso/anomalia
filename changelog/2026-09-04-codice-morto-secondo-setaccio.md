# Secondo setaccio: 33 file che nessuno importa

Il primo giro aveva reso 11.911 righe su 191 file, ma girava su un albero di metà giornata.
Da allora la chat è stata smantellata, il desktop agentico rimosso, il sito pubblico potato da
112 a ~70 pagine, quattro rotte di impostazioni fuse in una. Ogni cancellazione lascia orfani.
Questi sono quelli rimasti: **3.312 righe, 33 file**, tutti con **zero importatori**.

## Come sono stati trovati, e perché il grafo da solo non bastava

Il grafo degli import risolve `$lib`, i relativi, `@anomalia/*`, `.js`→`.ts`, gli import nudi,
`import()` e `vi.mock`, e parte dalle radici vere (rotte SvelteKit, hook, worker, script, cron,
i due `import.meta.glob`). Da solo dava **39 file morti, 2.074 righe** — poco, perché il primo
giro aveva già pulito bene.

Il resto è venuto da un secondo passaggio: **rifare la raggiungibilità senza i test fra le
radici**. Un modulo il cui unico importatore è il proprio `*.test.ts` è raggiungibile per il
grafo e morto per il prodotto: sono 28 file, e da lì escono `speech-to-text`, `seo-tools`,
`thread-identity`, `model-price`, `design-discovery`, `check-gtm-feasibility`.

## Cosa se n'è andato, e chi l'aveva lasciato indietro

**I tool gratuiti ritirati** (`25faba40`, `98b18453`) — `ToolPage.svelte`,
`ToolKeywordTable.svelte`, `ToolStats.svelte`, e `seo-tools.ts` col suo test: l'analizzatore di
meta tag, robots e schema che alimentava quelle pagine. `parseRobots` continua a esistere, ma in
`geo.ts`, che è vivo: la copia in `seo-tools.ts` era la seconda.

**Lo smantellamento della chat** (`3d1ad402`, `f7da47f4`) — `PostCard.svelte`,
`speech-to-text.ts` (il registratore vocale del composer), `model-price.ts`,
`thread-identity.ts`, `workbench-context.ts` + `stores/workbench-tabs.ts`, e
`tests/e2e/chat-reply-notifications.real.spec.ts`, che navigava su `/app/<brand>/chat/threads` —
una rotta che non esiste più (lo spec era `test.skip` senza `REAL_E2E=1`, quindi in CI passava
senza mai aprire una pagina).

**Il pannello post sollevato alla radice del brand** (`d528d9c0`) — tutta
`src/lib/components/ui/alert-dialog/`, 13 file. Delle due copie di `PostPanel.svelte` è
sopravvissuta quella che conferma inline; l'`alert-dialog` era della copia che ha perso. Il
changelog `2026-09-04-thin-frontend-calendar.md` lo descrive ancora come essenziale: quel testo
è storia, e resta com'è.

**Mai collegati dall'import OSS** (`5ae50498`) — `design-discovery.ts` (411 righe: lo sweep di
account e topic di design, con `accountsForTick`, `topicsForTick`, `runTopicSweep`) e
`check-gtm-feasibility.ts`. Nessuno dei due ha mai avuto un chiamante: sono sopravvissuti a
`f826893e` («Remove 96 exports nothing imports») solo perché i loro export li usava il loro test.

## La lista che nominava due file come stringhe

`src/lib/ui-tokens.test.ts` tiene `LEGACY_STRAYS`, il debito congelato dei `var(--x)` senza
definizione, e ci nominava `ToolKeywordTable.svelte` e `ToolPage.svelte` **come stringhe**: nessun
import, quindi nessun grep sui simboli le trova. Il test asserisce che il debito possa solo
scendere (`ripuliti` deve essere vuoto), quindi cancellare i due componenti senza togliere le due
righe lo faceva fallire. Tolte.

È il buco cieco che oggi ha fatto diventare rossa `dev` tre volte. Il cancello, prima di ogni PR:

```
npx vitest run $(git grep -ln "readFileSync\|readdirSync\|globSync" -- 'src/**/*.test.ts' 'packages/**/*.test.ts' 'scripts/**/*.test.ts')
```

75 file, 939 test, verdi.

## Verifica

`npm run check` è già rosso su `dev` e la CI non lo esegue, quindi conta solo il **delta**:
diffate le due liste di errori, **nessun errore nuovo** e uno in meno — quello di `ToolPage.svelte`,
che non esiste più. Gli errori comparsi fra i due run vivono tutti in
`api/v1/brands/[slug]/{posts,web}/`: sono di `feat/split-post-media` e `feat/split-web-actions`,
atterrate su `dev` mentre questa girava.

## Cosa NON è stato toccato, di proposito

- **Le librerie del patrimonio** — `wall.ts`, `wall-media.ts`, `design-judge.ts`, `talent.ts`,
  `playbooks.ts`, `design/presets/`, `WallTile.svelte`. Il grafo le dà raggiungibili solo dai
  test, ed è vero: le pagine che le mostravano sono uscite oggi. Restano in attesa della
  superficie MCP — `changelog/2026-09-04-librerie-fuori-dal-sito.md` lo dice esplicitamente.
- **`src/lib/agent/*`** — gli undici barrel da due righe (`kit/`, `turn`, `testkit`, `executor`,
  `contracts`, `memory-context`, `tools/builtin`, `adapters/graphical-bootstrap`) non hanno
  importatori, ma sono shim di compatibilità documentati in `src/lib/agent/README.md`, e il
  perimetro è di un altro agente. 22 righe: non valgono un conflitto.
- **`web-push-client.ts`** — è morto davvero (nessuno chiama `enableWebPush` da quando la chat è
  uscita), ma è anche l'unico chiamante di `/api/push/subscribe` e `/api/push/vapid-public-key`.
  Cancellarlo non romperebbe la build: spegnerebbe in silenzio le notifiche push, mentre la metà
  server (`web-push.ts`, `brand-notify.ts`) continua a leggere `push_subscriptions`. È una
  decisione di prodotto, non una pulizia. Segnalato, non toccato.
- **`preset-render.ts`, `StyleGridThumb.svelte`** — orfanati da `311eb9ef`, la stessa commit che
  intima di non cancellare quello che sembra orfano. Non sono nella lista esplicita dei tenuti,
  ma rendono la libreria di stili che invece c'è. Segnalati.
- **`chat-modes.ts`, `plan-budget.ts`** — raggiunti solo da test, ma i test sono di codice vivo
  (`agents.registry.test.ts` e `credits.test.ts`, che usa `productionCredits` come oracolo di
  `creditQuota`). Perimetro chat il primo, percorso dei crediti il secondo.

## Le tabelle: segnalate, mai cancellate

Sei tabelle senza un solo lettore applicativo: `video_reviews` (0165, il reviewer è uscito il
29/8), `motion_craft_scores` (0195), `brand_design_templates` (0108), `brand_article_versions`
(0066), `onboarding_jobs` (0040), `agent_kit_approval_requests` (0227 — i suoi due lettori sono
funzioni plpgsql che non chiama nessuno da `98b18453`). Cinque delle sei compaiono ancora
nell'allowlist di `query-tool.ts`, quindi il tool generico `query` le raggiunge: toglierle
significa anche editare quella stringa. Qui i deploy non eseguono migration e le righe dei
clienti non si buttano insieme a una funzione — restano tutte.

Non sono dead code trovato per grep ingenuo: `admins`, `tool_usage`, `stripe.subscriptions`,
`market_video_analyses`, `talent_views`, `agent_computers`, `chat_thread_reads`,
`agent_kit_effects` sembrano morte allo stesso modo e non lo sono — le legge una funzione
plpgsql, un embed PostgREST o una costante `TABLE`.

## Cosa resta aperto

- `/api/v1/onboarding/social-history/work` è l'unico drenatore di coda `*/work` senza cron
  (`onboarding/steps/work`, il fratello, ce l'ha).
- `src/routes/app/[brand]/settings/competitors/` non è in `SETTINGS_SECTIONS` né in
  `SETTINGS_GROUPS`: irraggiungibile da nav, ⌘K e rail. `SETTINGS_ADS_SECTIONS`
  (`components/settings/platforms.ts:72`) non ha consumatori e il suo primo elemento,
  `'ads-accounts'`, non è una rotta. Perimetro di un altro agente.
- `SettingsSidebar.svelte:51` ha `settingsBase = '/app/settings'` come default, e quella rotta
  non esiste; l'unico chiamante lo sovrascrive.
- `scripts/export-oss.mjs:108` tiene `src/lib/server/chat/notify-tools.ts` in
  `PRODUCT_DOMAIN_SERVER_PATHS`, un'allowlist di policy: il file è uscito con la chat.
- Il percorso dati delle anteprime post è vivo (`previewFromOutput`, `previewsByCall`,
  `ChatPostPreview`) ma da oggi non ha più un renderer: `PostCard.svelte` era l'ultimo, e i
  prompt degli agenti promettono ancora «render as PostCard previews».
