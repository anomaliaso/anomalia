# Changelog

## 2026-08-27

### Il pannello agente non si ricordava come lo avevi lasciato

`agentPanelOpen` era uno `$state(false)` locale alla pagina del thread: ogni navigazione lo
riportava chiuso. Chi teneva il pannello aperto su un agente e tornava nella chat dalla
sidebar lo ritrovava chiuso, e viceversa.

La preferenza ora segue l'AGENTE (`custom_agent_id ?? agent`) e vive in localStorage
(`anomalia:chat-agent-panel:<brand>:<agent>`, stesso pattern delle bozze di chat): atterrando
su un thread il pannello torna com'era stato lasciato per l'agente di quella chat, e ogni
cambio — toggle in topbar o X del pannello — la riscrive. Chiuso = chiave assente: il default
è già chiuso. Lettura a un `$effect` di atterraggio (ri-allineato quando cambia il thread),
scrittura a un `$effect` idempotente: entrambi passano da `chat-agent-panel-pref.ts`, mai
dallo storage diretto.

## 2026-08-27

### Self-host: nascondere il sito di marketing, partire dall'app

Non c'era. `TENANT_BRAND_ID` salta lo switcher dei brand, `BILLING_PROVIDER=open`
toglie i crediti, ma `/` restava la landing di anomalia.so — pricing, pitch,
waitlist e tutto. Chi installa per sé non ha un sito commerciale da mostrare.

`HIDE_MARKETING=1` (anche `true` / `yes`) reindirizza il gruppo
`[[lang=locale]]` e `/start` a `/app`. Login, auth, API, admin e i blog dei
brand restano. Non è nella guida: si accende dall'env, si rilegge a ogni
richiesta, il hosted product senza la variabile non cambia. Un bounce OAuth
sul Site URL con `?code=` passa ancora da `/auth/callback` prima del
redirect, altrimenti il code si perde. Lo sitemap smette di elencare le
pagine che ormai 303-ano e, se manca la service-role key (CI, self-host
minimale), esce con la sola parte statica invece di un 500 permanente;
in produzione una query fallita resta comunque un errore — il crawler
mantieni l'ultima copia buona invece di vedere mezzo sitemap svanire.

L'healthcheck di compose picchiava `/`: busybox wget tratta un 303 come
errore, quindi accendere la flag avrebbe lasciato l'app forever-unhealthy.
Ora picchia `/robots.txt`, che è sempre 200.

### Il secondo messaggio di un thread si vedeva rifiutare OGNI tool

`startHarnessTurn` cuoce il ToolSet una volta per `sessionKey` (il thread) e
riusa quello a ogni turno successivo. Il recinto dentro `applyTool` leggeva
`runClosedBy` e `stoppedByUser` per chiusura lessicale — le bandiere del turno
che i tool li aveva cotti. Finito il primo turno, quelle bandiere restano
`done` per sempre: dal secondo messaggio in poi ogni chiamata tornava «Turno
chiuso dal sistema (done): niente altro viene eseguito». In produzione morde
quando l'istanza è la stessa fra due messaggi — cioè, su Fluid Compute, spesso.

Ora il recinto guarda `liveTurnByThread`, dove ogni turno registra le proprie
bandiere: i tool sono del thread, le bandiere sono del turno vivo.

**Il difetto era invisibile perché il finto harness dei test non poteva
vederlo.** `toUIMessageStreamResponse` fotografava `sseBody(uiChunks)` alla
chiamata, e i chunk di output dei tool nascono dietro un `await`: lo stream
conteneva `tool-input-available` e `finish`, mai una risposta. L'asserzione
sull'output non ha MAI potuto fallire per il motivo giusto — falliva perché
l'evento non c'era. Il corpo ora si compone dopo `drained`, e il test ha visto
subito il rifiuto vero.

Due asserzioni vicine erano invece scadute e sono state tolte:
`markComputerRunning` non ha più un chiamante (la marcatura è passata ad
`agent-desktop.ts` quando ogni agente ha avuto la sua computer, ed è coperta
là), e `touchComputer` parte solo dai tool della VM (`shell`/`observe`/`act`),
non da un `brand_ls`.

### Gli ultimi dodici rossi: 5940/5940

- **`agents/computer/status` e `/screen`**: i test montavano un evento senza
  `url` e una catena con un solo `.eq`, da prima che la riga si cercasse per
  agente E per brand. Ora la catena mock si richiama da sola, così il prossimo
  `.eq` non li rompe di nuovo.
- **`ui-tokens`**: dieci `var(--fg)`, `var(--muted)`, `var(--bg)`,
  `var(--border)`, `var(--background)`, `var(--foreground)`,
  `var(--muted-foreground)` nel pannello computer, nella sua pagina e in
  `TranscriptList` — token che non esistono in nessun tema. Sul chiaro il
  fallback cablato somigliava al vero; sul SCURO era testo grigio chiaro su
  bianco. Puntati ai token reali (`--ink`, `--ink-faint`, `--paper`,
  `--paper-2`, `--line`) e fallback tolti: un token definito non ne ha bisogno.
  Tolte anche cinque voci di `LEGACY_STRAYS` che non erano più stray.

### Lo schema del self-host contro quello di produzione, tabella per tabella

Domanda diretta: quello che diamo a chi installa è lo stesso database che gira
in produzione? No. Confrontate le impronte (nome tabella, numero di colonne,
md5 dei nomi) di un database appena migrato contro la produzione in SOLA
LETTURA — nessuna scrittura, nessuna DDL, nessun dato letto.

**143 tabelle in produzione, 138 nel self-host.** Sei tabelle non le crea
nessuna migration, e sette tabelle hanno meno colonne. Di queste, ciò che il
CODICE usa davvero:

| manca | cosa si rompe, in silenzio |
|---|---|
| `radar_feed_cache` | la cache condivisa delle fonti: ogni brand riscarica tutto, e la lettura fallisce |
| `radar_jobs` + `claim_radar_jobs()` | il worker del radar chiama un RPC che non esiste |
| `post_revisions` | le versioni di un post non si salvano (`upsert` su una tabella assente) |
| `brand_articles.source` | la traduzione di un articolo seleziona una colonna che non c'è → legge null |
| `brand_media.source_ref` | la provenienza di un media |
| `chat_messages.reasoning` | il ragionamento della chat non si conserva |
| `posts.title`, `posts.link_url`, `posts.subreddit` | i post Reddit/link partono senza il campo che li definisce |

`20260827130000_selfhost_schema_parity.sql` le crea tutte, con gli indici veri
(compreso l'unico su `(post_id, version)` che serve all'`onConflict`), l'RLS
accesa e la policy di `post_revisions` copiata da produzione — la scrittura
passa dalla sessione dell'utente, non dal service role.

**Cosa è rimasto fuori, di proposito**: `ai_calls.cost_cents`, `ai_calls.steps`,
`chat_threads.asset_project_id`, `motion_videos.qc_rerender`,
`motion_videos.qc_rewritten`, `posts.generation_alternatives`, e le tabelle
`asset_projects`, `asset_project_files`, `mcp_logs`. Nessuna riga di codice le
nomina: sono debito di PRODUZIONE, non schema che serva a far girare l'app.
Ricrearle in una migration le renderebbe eterne.

Dopo: la differenza fra i due schemi è esattamente quella lista, più
`app_schema_migrations` (il registro delle migration, che in produzione non
c'è perché là si applicano a mano). E l'app su quello schema parte, fa login e
apre `/app/demo`, `/plan`, `/radar`.

**Una chiave finta con la forma giusta ha fermato il primo push.** La
scansione di GitHub riconosce `rk_live_…` dalla FORMA, non dal valore, e ha
rifiutato l'import per una fixture di `redact.test.ts` inventata a mano
(«INVENTATA» nel mezzo). Ora la fixture si compone a pezzi — il test prova la
stessa identica stringa — e il guard dell'export ha imparato la stessa forma:
deve essere severo almeno quanto la scansione che ci aspetta dall'altra parte,
o il primo a dircelo è il rifiuto di un push pubblico.

**La documentazione interna non esce più.** `docs/` è escluso in blocco e
rientrano solo `SELF_HOSTING.md` e `docs/api/**`: undici file invece di
settantacinque. Fuori restano i piani di prodotto, le review di sicurezza (una
nomina un IDOR), le analisi con dati veri di produzione, i playbook
commerciali, e i due documenti che nominano il progetto Supabase di produzione.
Per scriverlo senza venti esclusioni puntuali, le regole dell'export accettano
ora un `!` che ripesca (`docs/` esclude, `!docs/api/` riporta dentro): le
eccezioni si leggono accanto alla regola che le genera.

E i rimandi restati orfani diventano testo semplice invece di 404: `CHANGELOG`
e l'indice dell'API puntavano a dodici documenti che ora non si spediscono.
`delinkMissing` lo fa a ogni export, così la prossima stretta non lascia link
morti dietro di sé.

Fuori dall'export anche tre cose che una repo pubblica non deve trovarsi in
mano: le due migration `DRAFT-*.sql.disabled` (piani interni di rimozione, con
i conteggi di righe di produzione e un percorso di scratchpad che qui non
esiste), `gen-hero.mjs` (uno script una tantum che nessuno richiama) e
`bun.lock` — due lockfile per lo stesso progetto sono un invito a divergere, e
la guida e la CI usano npm.

Tolti anche dall'allowlist del tool `query` i tre nomi morti: l'agente credeva
di poter leggere `asset_projects`, `asset_project_files` e `mcp_logs`, che in
un'installazione da zero non esistono affatto. Ora tutte e 138 le tabelle che
la lista promette esistono davvero in un database appena migrato.

**Come rifarlo** — la procedura, che non è automatizzata:
`docker compose up` su un volume nuovo → `npm run db:migrate` → l'impronta
`select table_name, count(*), md5(string_agg(column_name, ',' order by
column_name)) from information_schema.columns where table_schema='public'
group by 1` sui due database, e diff. `schema-drift-check.mjs` NON basta:
confronta il codice con la produzione, quindi una colonna aggiunta a mano lì e
mai scritta in un file gli risulta sana.

### Con le chiavi vere: l'app parte, risponde davvero, e il conto non si scriveva

Rifatto il giro del self-host con il `.env` di produzione — chiavi AI, kie, Zernio
— e il solo database puntato allo stack locale (azzerate Resend, Sentry, PostHog,
Seline, Meta pixel e Stripe: da un'installazione di prova non deve uscire niente
verso persone o cruscotti veri).

`/api/status` **ok su tutta la riga**: database 17ms, ai:text 319ms, ai:vision
242ms, social:publishing 493ms. Login dal form, `/app/demo`, e un turno di chat
vero: risposta in streaming («Sono Anomalia, un'assistente AI che aiuta a
gestire strategia, contenuti e presenza digitale del brand»), due messaggi
scritti nel database locale.

**E lì è saltato fuori il difetto vero.** Nel log dell'app, due volte:
`[ai-log] insert failed: Could not find the 'cached_tokens' column of 'ai_calls'`.
Otto colonne che `logAiCall` scrive da sempre — `input_tokens`, `output_tokens`,
`cached_tokens`, `thinking_tokens`, `service_tier`, `user_id`, `thread_id`,
`context` — **non le crea nessuna migration**: in produzione ci sono perché sono
state aggiunte a mano, quindi il buco esiste solo per chi installa da zero. E il
rifiuto è un `console.warn`: l'app funziona benissimo e non registra un centesimo
di quanto sta spendendo. Su un prodotto che si paga a consumo, è la peggiore
delle due possibili.

`20260827120000_ai_calls_usage_columns.sql` le aggiunge tutte con `if not
exists` (su produzione non cambia niente). Dopo, stesso giro: `chat / kie /
gpt-5-6-luna / 41004 input / 5 output / $0.0023` e `memoryExtract / gemini /
gemini-3.7-flash / $0.000875`. Chi ha già installato deve rilanciare
`npm run db:migrate`.

Il test che lo guarda (`scripts/self-host-compose.test.ts`) confronta le colonne
che `ai-log.ts` inserisce con quelle DICHIARATE nelle istruzioni che parlano di
`ai_calls` — non col nome cercato in tutto il corpus, che direbbe «c'è» perché
`input_tokens` esiste su `chat_messages`.

**Il sospetto che resta**: `ai_calls` è la tabella che ho toccato, non
necessariamente l'unica. `schema-drift-check.mjs` confronta il CODICE con la
produzione, non le MIGRATION con la produzione: una colonna aggiunta a mano lì e
mai scritta in un file gli risulta sana. La stessa domanda va fatta a ogni
tabella prima di dire a qualcuno «installalo».

### Il self-host provato davvero, da database vuoto: tre cose non funzionavano

Fatto il percorso della guida sulla COPIA ESPORTATA, non su questo repo: `npm ci`
da zero, stack su un volume nuovo, migrazioni, seed, build di produzione, login.
Ogni difetto qui sotto è uscito da un comando che falliva, non da una lettura.

- **Il database pubblicato su una porta dove non ascoltava.** Il compose mappava
  `${POSTGRES_PORT}:5432`, ma dentro il container Postgres ascolta su
  `${POSTGRES_PORT}` (PGPORT) e ogni servizio lo raggiunge su
  `db:${POSTGRES_PORT}`. Con il default 5432 le due cose coincidono e nessuno se
  ne accorge; con qualunque altro valore lo stack parte SANO e dall'host il
  database è irraggiungibile — `npm run db:migrate`, il primo comando della
  guida, muore con ECONNRESET.
- **`npm run start` non leggeva `.env`.** `$env/dynamic/private` legge
  `process.env` a runtime, e `node build` non carica nessun file: lo fa Vite, che
  a quel punto non c'è più. L'app partiva, rispondeva 200 e non aveva database
  («SUPABASE_SERVICE_ROLE_KEY not configured» su `/api/status`) — sembra un
  guasto di chi installa. Ora `node --env-file-if-exists=.env build`.
- **`.env.example` spediva `ORIGIN=` vuota.** adapter-node distingue «vuota» da
  «non impostata» e rifiuta di partire («Invalid ORIGIN: ''»), proprio mentre il
  commento sopra dice di lasciarla non impostata. Restava invisibile finché
  `.env` non veniva letto a runtime: appena riparato il punto sopra, l'app non
  partiva più. Ora la riga è commentata, com'era l'intenzione.

Tre test nuovi in `scripts/self-host-compose.test.ts`, scritti prima e visti
rossi, che leggono il compose, `package.json` e `.env.example` veri.

Il giro completo, verde: 276 migrazioni da vuoto, seed (utente demo + org +
brand via l'admin API di GoTrue), build di produzione, login dal form dell'app,
`/app` → `/app/demo` 200, le pagine principali 200, `activate` e `upgrade` 404
com'è giusto in una build aperta, `/api/status` che dichiara solo le
degradazioni volute (niente chiavi AI, niente publisher), e il tick
dell'autopilot fail-closed senza `CRON_SECRET` e 200 con — «considered 1,
queued 1» sul brand seminato. Lo stack di prova girava su porte sue
(5433/8001/3001) e alla fine è stato distrutto col suo volume.

### L'export OSS costruiva una copia che non compilava, e il guard diceva ok

`npm run oss:export` usciva 0, ma `vite build` dentro la copia moriva su
`Could not resolve "./billing" from src/lib/server/usage.ts`. Rollup risolve
staticamente anche un import dinamico con path letterale: i seam pigri verso i
moduli esclusi (`./billing`, `$lib/server/stripe`,
`$lib/server/vercel-domains`) non erano una degradazione a runtime, erano
quattro buchi che facevano fallire il build di produzione — cioè la repo
pubblica non sarebbe partita a nessuno.

Il guard non poteva vederlo: `specifiersIn` cercava
`(?:from\s+|import\s+|require\()`, e `import('./billing')` non ha lo spazio
dopo la parola. Verde e rotto insieme.

- **I moduli esclusi ora vengono sostituiti da uno stub** (`STUB_MODULES`), non
  lasciati come buco: il file esiste e esplode all'import, che è esattamente
  ciò che i seam già intercettano (`billing/index.ts` → `openBillingProvider`,
  `blog-settings.ts` → `null`). Di conseguenza `src/lib/server/billing/` non è
  più escluso in blocco: resta `index.ts`, che è **progettato** per l'assenza
  del provider a pagamento; se ne va solo `anomalia-provider.ts` (più le sue
  due suite, che asserivano il comportamento della build chiusa).
- **Guard nuovo al posto di `IMPORT_SENSITIVE`**: non più una lista di nomi
  sensibili, ma «ogni specificatore relativo o `$lib` deve risolvere a un file
  presente nella copia» (`danglingImports`) più «un modulo stub si raggiunge
  solo da un seam pigro» (`staticImportsOfStubs`). Il primo avrebbe preso
  questo difetto; ha anche trovato `scripts/chat-live/` che importa
  `scripts/eval/` (escluso) e `scripts/gen-why-images.mjs`, un one-off che
  importava `../videos/log-ai-call.mjs` — cartella che non esiste da nessuna
  parte: cancellato invece di esportare codice morto e rotto.
- **`vercel.json` torna nella copia.** Non contiene niente di interno,
  `docs/SELF_HOSTING.md` lo cita come l'elenco dei cron da replicare e
  `wall-digest.test.ts` ne legge le cadenze: escluderlo rendeva rosso un test
  e bugiarda una guida.
- **Due test non davano più per scontato l'ambiente di chi li lancia.**
  `agents.registry.test.ts` accende le credenziali DataForSEO come già faceva
  con `GROUP_CHATS`: senza, `createDataForSeoTools` torna `{}` e sette chiavi
  di `web` non risolvono — il test era verde solo su chi ha le chiavi in
  `.env`, e rosso in CI per definizione. `page-modal-tiers.test.ts` tollera
  l'assenza delle sole rotte che l'export toglie di proposito (`activate`);
  ogni altra assenza continua a fallire.
- L'unico dominio interno rimasto in tutto il repo era in questo file, nell'entry
  che *descrive* il guard che lo vieta: riscritta senza nominarlo.

Verifica: 16 test nuovi su `scripts/export-oss.test.ts` (rossi prima — il primo
diceva che `import('./billing')` non veniva nemmeno letto), export a 2978 file
con guard verdi, `npm run build:node` dentro la copia **verde in 1m23s** (è la
cosa che non era mai stata provata), suite dentro la copia 5687/5715 con zero
fallimenti causati dall'export — gli otto file rossi rimasti falliscono
identici nel repo principale con lo stesso `.env` (quattro dipendono da chiavi
vere: `chat-markdown`, `chat-media`, `persistence`, `oauth`; quattro sono i
noti instabili di rete).

**E i quattro test che pretendevano chiavi vere ora se le danno da soli.**
`chat-markdown`, `chat-media` e `persistence` mockano `$env/static/public` con
un host di prova: `isOwnMediaUrl` esige `https:`, quindi con un
`PUBLIC_SUPABASE_URL` di sviluppo (o vuoto) l'URL nostro non veniva
riconosciuto e il media non si mostrava — verde solo su chi ha un progetto
vero. `oauth` si assegna `APP_SECRET`, che `token.ts` pretende fail-closed.
Nessuna asserzione cambiata: cambia solo chi decide l'ambiente.

Il conto finale: nella copia esportata, con un `.env` da CI (due sole variabili
pubbliche), 5703/5715 — e i dodici rossi rimasti sono ESATTAMENTE quelli del
repo principale con `.env` completo (`live.test`, `ui-tokens`, i due
`agents/computer/*`: WIP altrui, `url` indefinito e dieci token CSS mai
definiti). Zero fallimenti dovuti all'export, zero dovuti all'ambiente.

Non fatto: `docker compose up` dalla sola copia esportata.

## 2026-08-26

### La risposta ripresa a metà non esce più mescolata: i chunk hanno una posizione

Riaprire una chat con un turno già in corso restituiva testo illeggibile: «Il
nastro è risultato troppoo compress per poterlo tagliare una frase batt peruta
con certzaez». Nel database il testo era pulito — a mescolarlo era il client.

Chi si aggancia a un turno vivo legge DUE sorgenti della stessa risposta: il
canale Realtime, che consegna incrementi, e il poll di `kit-run`, che porta il
testo assoluto. Il 25/8 era stata messa una finestra a tempo
(`REALTIME_OWNS_TEXT_MS`): finché il canale parlava, il poll non toccava il
testo. Copriva una direzione sola. L'altra è quella che restava rotta, ed è la
norma: chi entra a metà turno parte dallo snapshot e poi ci appende sopra
incrementi che cominciano da un altro punto — il canale non dice mai da dove.
Stessa forma quando un chunk si perde: `broadcastToBrand` è best-effort, e il
buco veniva cucito sopra la parola sbagliata.

Ora ogni chunk viaggia con la posizione da cui comincia (`at: {text,
reasoning}`, le lunghezze sul server PRIMA di piegare l'evento). Il client
(`chat-live-join.ts`) applica un chunk **solo se continua esattamente dove
siamo**; quello che arriva in anticipo aspetta in coda, quello già visto si
scarta, e lo snapshot assoluto del poll — che va solo avanti — colma il buco e
fa entrare gli arretrati in ordine. Le due sorgenti non si arbitrano più a
orologio: hanno una posizione sola.

La finestra a tempo è stata **tolta**, non affiancata: con l'allineamento per
posizione le due sorgenti convivono, e un secondo criterio che dice la stessa
cosa in modo diverso è il modo in cui i due divergono. Un buco che non si chiude
degrada al peggio a testo che avanza al ritmo del poll (350ms, specchio a 100ms),
mai a testo corrotto.

Test: `chat-live-join.test.ts` (9 casi: giunzione fasulla, arretrati che entrano
in ordine, chunk in ritardo che non raddoppia, snapshot che non torna indietro,
tool sempre applicati, ragionamento con la sua posizione, server vecchio senza
posizione, coda che non cresce all'infinito), più i pin di sorgente in
`shell.test.ts` e `live.test.ts` — quest'ultimo tiene la lettura della posizione
PRIMA del fold, che è l'unico modo in cui l'errore può rientrare in silenzio.

### La sandbox lavora sul computer dell'agente, e a schermo acceso si vede

Un delegato `sandbox` ha girato mezz'ora su anomalia.so mentre il proprietario
guardava lo schermo dell'agente: il desktop è rimasto vuoto per tutto il tempo.
Due difetti sovrapposti, nessuno dei due visibile dai log — che infatti dicevano
`chromium ready`.

**La macchina era di un altro.** Dal 26/8 la VM è dell'agente
(`sandboxName(brandId, agentId)`) perché lo schermo `:1` è uno solo, e il
pannello apre il computer con `?agent=`. Ma `agentId` era un campo *opzionale* di
`SandboxToolsOptions` e **nessuno dei quattro chiamanti lo passava**: chat
interattiva, coda, `agent-base` e il sotto-agente aprivano tutti la VM del brand
— un'altra macchina, un altro disco, un altro schermo. Ora il campo è
obbligatorio (`string | undefined`): `undefined` resta lecito per un cron o uno
script, ma va scritto, così è una decisione e non una dimenticanza. Chi ha due
identità (hub e agente custom) le risolve con `computerOwner`, la stessa funzione
che usa il pannello — erano due espressioni scritte a mano in posti diversi, ed è
esattamente lì che divergevano.

**E il browser era headless.** `BROWSE_SCRIPT` lanciava Chromium senza display
comunque, quindi anche sulla macchina giusta non c'era niente da vedere. Ora lo
script guarda se `/tmp/.X11-unix/X1` esiste — cioè se qualcuno ha acceso il
desktop — e in quel caso naviga a vista su `:1`. Senza display resta headless, e
ci ritorna anche se il lancio a vista fallisce: un socket rimasto lì da uno
schermo morto non deve spegnere la navigazione.

Il limite dichiarato: le pagine aperte PRIMA che l'utente apra il pannello restano
headless: Xvfb lo accende `ensureGraphicalMode`, che gira quando il pannello
comincia a chiedere schermate.

### Il self-host regge il giro completo: login, cron, non solo lo schema

Lo schema applicato non basta a dire «funziona». Provato davvero — stack fresco,
volume vuoto, 276 migration, seed, login dal browser — sono venuti fuori due
difetti che nessun test unitario poteva vedere, perché vivono nella distanza fra
il container e l'origine della richiesta:

- **`ORIGIN` non impostata**: adapter-node deduce l'origine dagli header e
  assume **https**. Il controllo CSRF confronta `Origin` (che il browser manda
  `http://localhost:3000`) con quella origine dedotta: ogni POST di form era
  «cross-site», 403, login compreso. Il self-host non aveva un modo di entrare.
- **Lo stesso buco uccideva il cron**: la richiesta interna arrivava con host
  `app`, che `reroute` (src/hooks.ts) non riconosce come host dell'app e manda al
  gruppo `_site` — il blog di un brand. Ogni job: 404. Con `ORIGIN` l'URL della
  richiesta è quella dell'app e i job tornano 200.

Il prezzo dichiarato: con `ORIGIN` fissa, i blog dei brand su dominio proprio
vogliono un reverse proxy davanti. In compose, entrare nell'app vale più
dell'hosting multi-dominio in chiaro su localhost.

Chi ha già avviato lo stack prima di questa correzione ha la contabilità di
GoTrue in `public.schema_migrations`: con `?search_path=auth` il servizio non la
trova e riapplica tutto. Si sistema copiandola —
`insert into auth.schema_migrations (version) select version from public.schema_migrations on conflict do nothing;`
— e riavviando `auth`.

### Il self-host parte da un cluster vergine, non da uno riparato a mano

Le 276 migration si applicavano solo sul database della produzione: su un Postgres
appena nato il replay si fermava quattro volte, e ogni volta la riparazione era
manuale — grant a mano, colonne aggiunte a mano, ruoli inventati. Un self-hoster
non ha quelle mani. Ora il giro completo (`docker compose up -d --wait` →
`npm run db:migrate`) arriva a 276/276 su un cluster vuoto, verificato su un
container usa-e-getta distrutto a fine prova.

Cosa era rotto, e dove:

- **`PGDATA` in una sottodirectory** faceva saltare l'init dell'immagine: gli
  script in `docker-entrypoint-initdb.d` non giravano MAI, quindi password dei
  ruoli e `app.settings.jwt_secret` non venivano applicati. Serviva col bind
  mount; col volume nominato è solo un danno, quindi è tolto.
- **`roles.sql`** faceva `ALTER USER supabase_functions_admin`, ruolo che
  `supabase/postgres:17.6.1.136` non crea più (e che questo stack non usa: niente
  edge-runtime). L'errore abortiva l'intero init.
- **GoTrue senza `?search_path=auth`** creava la propria `schema_migrations` in
  `public`, dove `supabase_auth_admin` non ha CREATE: il servizio moriva al primo
  avvio. Non era un grant mancante — era la URL.
- **`0091`** dava per scontata `gtm_plans.phases`, che su un replay pulito non
  esiste più (`0042` l'ha rinominata) e sull'hosted era stata riaggiunta fuori
  banda: ora la ricrea lei, visto che è il file che la elegge a sorgente unica.
- **`0204`** faceva `VACUUM` e il migratore avvolgeva ogni file in una
  transazione. Non basta togliere il `begin`: più statement in una sola query
  sono comunque un blocco transazionale implicito, quindi `applyOne` spezza il
  file e manda le statement solitarie una per una.

### Il modello scelto diventa un dato del thread, non dello schermo che l'ha scelto

Il picker del composer cambiava due variabili di componente e finiva lì: bastava
un reload, un altro device o un turno accodato dal cron perché il turno tornasse
al default del brand. E il ramo `AGENT_KIT` era peggio: `runKitTurn` chiamava
`resolveHarnessModelRef()` **senza tier**, quindi la catena env cadeva su
`*_AUTO_MODEL`, poi su `HARNESS_MODEL_AUTO`, poi sulla costante `'ox-alpha'` —
l'utente metteva `OPENROUTER_PRO_MODEL=gpt-5.6` e l'agente continuava a
presentarsi come ox alpha, perché il tier non arrivava mai fin lì.

La preferenza ora è una colonna (`0225`): `chat_threads.model` e
`custom_agents.model`, forma `AgentModelPolicy` (`{family, thinking}`) dei
contratti, `null` = «segui il default». La catena è una sola e sta in un punto
solo (`chat-model-policy.ts`): **thread → agente custom → tier del turno**.
`turnModelFamily` la applica, `policyForChoice`/`choiceForPolicy` traducono
picker ⇄ riga, e una riga sporca nel database si scarta invece di esplodere.

Il salvataggio è ottimistico con rollback all'ultima scelta confermata
(`chat-model-choice.svelte.ts`): il DB è la fonte di verità, niente copia in
localStorage, e una PATCH persa riporta il picker dov'era invece di mentire.

`resolveHarnessModelRef` prende ora la preferenza (famiglia + tier) e la
risolve in ordine: famiglia servibile dal provider attivo → `*_MODEL` del tier
→ famiglia di default del tier → lista dichiarata (`*_MODELS`). Il fallback
`'ox-alpha'` è stato **tolto**, non riordinato: un modello inventato che
risponde è peggio di un errore che dice «nessun modello configurato».

Il percorso classico segue la stessa preferenza: `resolveChatModel` accetta
`opts.model` e la tratta come la policy dell'agente — vince sullo spec su Auto,
e blocca la scalata Auto→Pro, perché una famiglia scelta a mano è una scelta,
non un default da correggere. Serviva: un agente custom schedulato non passa
mai dal ramo kit (`personaId` lo esclude), quindi senza questo il select
"Modello" nella scheda dell'agente non avrebbe cambiato nulla.

Anche l'agent-lab smette di cablare `kie/grok-4-6`: usa lo stesso ref, con la
famiglia dello spec dell'agente.

### Il Motion Specialist smette di scrivere Remotion: passa un brief a chi sa il mestiere

L'agente motion in chat (`AGENT_KIT=on`, `plugins/motion.ts`) scriveva la TSX da
sé, con **sei righe** di spec e il ricettario delle transizioni dietro
`how/MAKE-MOTION-VIDEO.md` — un file che nessun cancello lo obbligava ad aprire:
`gateOnFileRead` è montato solo sui tool della chat classica
(`chat/tools.ts:186`), mai su `motion_write`/`motion_edit`. L'agente della
pagina, per confronto, riceve a OGNI turno `MOTION_CRAFT_SPECS` +
`MOTION_TRANSITIONS_COOKBOOK_PROMPT` interi, il brand brief con la tipografia
risolta, il muro dei riferimenti già cercato, e un `finish` che rifiuta una
composizione scritta in una botta sola (`agent.ts:1036`). Da qui la differenza
di qualità che il proprietario vedeva: la pagina faceva video migliori
dell'agente.

Inlinare il mestiere nel turno di chat non era la strada: misurato, sono 15.750
token (craft 6.100 + ricettario 9.650) e il system viaggia a ogni step, contro
il tetto cumulativo di 1M di `chatTokenBudget` — a 64 step il solo prompt
esaurisce il turno. La pagina se lo permette perché quel contatore non ce l'ha.

Quindi `motion_write` cambia forma: `source` esce, entra `brief`. Il tool passa
il brief a `runMotionVideoTurn` — lo stesso agente che `scoreAndMaybeRewriteMotion`
già chiamava per le riscritture di QC — e il costo del mestiere finisce nel
turno del sotto-agente invece che moltiplicato per ogni step della chat.

Un tool solo, non due: `motion_compose` accanto a `motion_write` era una seconda
porta identica accanto a cui sbagliare. Tenuto il nome, cambiato l'ingresso. E
`source` sparisce del tutto dalla superficie del kit — `motion_edit` copre il
cambio mirato, `motion_write(id, brief)` la riscrittura — perché ogni gate di
craft di quel plugin esisteva per compensare un agente che scriveva codice senza
il mestiere davanti.

Cosa torna: `compactMotionPersist` (che porta già la cicatrice del 22/8 — mai
`ok:true` con `preview_url:null`) più `built` (il summary del `finish` del
sotto-agente), `complete`, `reviewed` e `next_step`. **Mai il sorgente**: 30k
caratteri di TSX nel contesto del chiamante rimetterebbero il costo che
delegare serviva a togliere. E `next_step` nomina `motion_render`, non
`render_motion_video`: quel tool nel kit non esiste, e prima lo si prometteva.

`complete:false` (la fetta è finita senza `finish`) rimanda a `motion_write` con
lo stesso id, non al render: renderizzare una composizione a metà è la stessa
forma dell'incidente del 21/8. Nessuna catena di continuazione nuova — la
ripresa la guida l'agente, che un loop ce l'ha già.

Contorno: `DesignerSliceEnd` porta `summary` e `unreviewed`, e `agent.ts` li
riempie a `finish` — prima quella prosa moriva nel tool result.

Test: sei nuovi in `plugins/motion.test.ts`, scritti prima e visti rossi. I
cinque che pinnavano la forma a sorgente sono riscritti — il gate sull'import
sbagliato di `@remotion/transitions` ora è esercitato da `motion_edit`, che è
rimasta la scrittura diretta.

**Scartato:** il pin del modello sul tier `pro` del provider attivo
(`OPENROUTER_PRO_MODEL`). Non è un file: `createAgentBase` vuole un
`ChatModelResolved`, il cui `provider` è un'unione chiusa senza i provider
dell'harness, e la contabilità dei crediti è per provider (`takeKieUsage`).
Spostare solo il turno e lasciare i delegati su Gemini contraddirebbe il
commento a `agent.ts:575` — orchestratore e lavoratori su modelli diversi
producono pezzi che non combaciano. Va fatto intero, e il verdetto lo dà
l'eval.


### I pallini verdi della sidebar vedono tutto ciò che gira, all'apertura

`GET /app/:brand/chat?running=1` — la chiamata che `#hydrateRuns` fa quando il
canale Realtime del brand si abbona — filtrava su `tool_name = 'chat_response'`.
I tool job asincroni (render, piani, grafica) e i run kit non esistevano per
quell'endpoint: aprendo l'app, un agente al lavoro non accendeva il pallino
finché non entravi nella sua chat o finché una transizione realtime non passava
per caso. Ora il ramo restituisce l'unione di tutti i job pending/running e dei
run kit vivi (`kitRunIsAlive`, stesso criterio del guard anti-doppio-turno), e
il pallino di presenza in sidebar è fermo — il pulse era rumore su dieci
conversazioni. Test nuovo: `thread-load.test.ts` (rosso prima, verde dopo).

### I sei monoliti più grandi sono smontati (solo spostamenti, zero semantica)

La lettura del confronto con rakazo segnava le concentrazioni: 100k righe
piatte in src/lib/server e file da 2–4.7k righe. Smontati i primi sei, con
il vincolo che l'API pubblica di ogni modulo resti identica e i test che
pinnano il sorgente continuino a custodire gli stessi invarianti:

- `content-preview.ts` (4696) → barrel su 7 moduli per concern, DAG senza
  cicli (seed-model → plan-pipeline → images → caption-quality/articles →
  creation/weekly-planner).
- `chat/tools.ts` (4533) → composition root su 7 gruppi tool + contesto
  condiviso; censimento tool 89/89.
- `MediaGeneratorWorkbench` (3572→991) e `MotionVideoWorkbench` (2316→918) →
  children per sezione, stato parent-owned, nessuno store inventato;
  svelte-check sui percorsi toccati migliora (−3 errori, −10 warning).
- Onboarding (3204→784) → undici componenti per step + moduli di supporto
  (poll job, restore draft, publish flow); nove difetti lasciati da un
  passaggio interrotto riparati in posto, tra cui il crash dei preview per
  brand senza sito e il loop che ri-pagava ricerche già fatte.
- Route chat: `+server.ts` (2194→803) su sei moduli; thread page (2099→995)
  su componenti transcript. Il diff meccanico delle regole CSS trova e
  ripristina la base `.chat-column` rimasta indietro nell'estrazione — era
  il layout messaggi collassato a sinistra.

Verifica: audit CSS selettore-per-selettore verde («tutte le regole
conservate»), suite completa 5771 verdi; i 19 rossi classificati uno a uno —
nessuno nostro dopo fix (chat-expression ripuntato al modulo che ospita ora
il markup sticker), il resto è WIP della sessione parallela su bridge/
sandbox/computer o flaky di timing (redact, youtube-thumbnail).

## 2026-08-26

### Il gate lettura→scrittura: l'agente non sovrascrive più alla cieca

Un agente che patcha un sorgente senza rileggerlo prima sovrascrive in silenzio
il lavoro di chi nel frattempo ha cambiato la riga — la persona sul browser,
un altro agente, l'autopilot. Ora le porte di scrittura chiedono il receipt di
lettura: `replace_motion_source` / `write_motion_source` (sorgenti Remotion),
`replace_source` / `write_source` (grafiche), `set_text` (editor del post),
`update_post` e `update_document`. Senza lettura precedente la scrittura è
rifiutata («Read before writing»); se il token della risorsa (`updated_at`,
oppure `version` per le grafiche) non è più quello visto alla lettura, la
scrittura è rifiutata con l'ordine di rileggere e rifare la modifica sul
contenuto attuale. Una scrittura riuscita aggiorna il receipt, quindi una catena
di patch dello stesso agente non si blocca da sola.

Il meccanismo vive in `src/lib/server/chat/read-guards.ts` (receipt in memoria
di processo: entro un turno è sempre coerente, tra turni costa al massimo una
ri-lettura). Per dare a `posts` un token vero c'è `0224_posts_updated_at.sql`:
colonna + trigger, così OGNI strada di scrittura (form, API, worker) bumpa il
tempo senza fidarsi del codice. `brand_documents.updated_at` invece viene
timbrato solo dove conta (`saveDocumentMarkdown`, patch titolo/collection): un
trigger lì renderebbe stantio ogni receipt a ogni giro del worker della
pipeline, che tocca `status`/`attempts`.

Esclusi per ora: i render (`regenerate_image`, `make_video`, `design_graphic`)
che costano crediti e hanno gate propri, e `sandbox_write_file` (VM
monoscrittore, niente scrittore concorrente).

### Gli occhi della squadra: team_activity

«Fai parte di un team» finora era una frase nel prompt: senza fatti da
controllare, un agente duplicava il lavoro di un collega o gli passava sopra.
`team_activity` (nei SHARED_TOOL_KEYS di ogni specialista) restituisce in una
chiamata l'ultimo resoconto di ogni collega dal suo diario
(`chat_threads.surface='team'`) e i DM agente-agente dove la palla sta a chi:
l'ultima battuta porta il `speaker`, quindi «chi deve muovere» è un fatto, non
un'impressione. Il blocco THE TEAM ora istruisce la coordinazione come mestiere:
guardare cosa esiste prima di costruire, e lasciare al collega una riga di
`message_agent` quando il lavoro gli passa in mano — un passaggio consegnato non
scritto non esiste. Scenario eval nuovo (`squadra`): prende l'agente che ignora
la squadra o attribuisce ai colleghi lavori che nessun resoconto sostiene.

### Pricing: via la riga crediti dalle card dei piani

Le card mostravano `{sym}{api} in credits included`: la stringa era rimasta
al vecchio placeholder “valore API” in valuta, mentre il componente passava
già `credits`. Quella riga è tolta dalle card. Il pill Free e la FAQ usano
ora il numero di crediti, non i placeholder `{sym}{api}`.

### Una macchina sola per brand, ed è quella dell'harness

Erano tre: `research` per l'harness e `sandbox_browse`, `research`+`motion` per
Remotion, `agent` per il computer. Tre affitti, tre installazioni di Chromium,
tre snapshot — e una bugia in faccia all'utente: il pannello mostrava «il
computer dell'agente» mentre il `shell` dell'agente girava altrove. Ora
`sandboxName` ignora `mode` e `lane`: chi arriva primo crea, gli altri
riprendono.

**Il prezzo, dichiarato.** La policy di rete si fissa alla creazione, quindi
non può più dipendere dal chiamante: vince quella dell'harness (`research`,
internet aperto), perché senza rete il desktop e il render Motion non
funzionano. Vuol dire che `shell` degli specialisti gira ora con internet
aperto sullo stesso disco dello snapshot del brand — la separazione che la lane
`agent` teneva. Restano i guard sui percorsi, `commandRejection` e le subnet
private negate.

### Il desktop ha una pagina sua, e non muore più dopo cinque minuti

Dentro il pannello era un francobollo. Ora «Prendi il controllo» porta a
`/app/<brand>/agents/computer`: schermo intero (il nome `+page@.svelte` azzera i
layout intermedi, altrimenti la sidebar si mangia 280px) e una barra in basso
con le tre cose che l'iframe non può dare, perché vive su un altro dominio e la
nostra pagina non lo può toccare:

- **Tastiera**, per il telefono: la tastiera di sistema si apre solo se un campo
  NOSTRO prende il fuoco, e quel campo non può spedire eventi dentro un iframe
  di terzi. Quindi il testo digitato passa da `/computer/input` e lo batte
  `xdotool`, con le stesse azioni di `act`. Passano solo `type` e una lista
  chiusa di tasti: non è un canale di comandi.
- **Copia dal desktop / Incolla nel desktop**: `xclip` sul display, dietro
  `/computer/clipboard`, e la clipboard nativa dalla parte del browser. Il
  pannello appunti di noVNC esiste ma è dentro l'iframe, cioè irraggiungibile.

**Il difetto che rendeva tutto inutile**: `provision` apriva la VM con
l'affitto di un turno (5 minuti). Chi prendeva il controllo se la vedeva
spegnere sotto — desktop congelato sull'ultimo fotogramma, appunti che non
rispondevano, e nessun messaggio che lo dicesse. Ora la rotta chiede
`SANDBOX_MAX_LEASE_MS` e la pagina ci ripassa ogni 3 minuti: lo stesso
passaggio alza la scadenza e rilancia i processi caduti.

E un'attesa dichiarata al posto dello stato di prima: mentre apre si vede un
caricamento, non «non è mai stata accesa» né «nessuno schermo attivo» — che
descrivevano un mondo che stavamo già cambiando.

### Il computer dell'agente è un desktop Ubuntu, e si può guidare

Il pannello mostrava uno screenshot ogni 2,5s e a cliccare era solo il modello
(`observe`/`act` via xdotool). Ora la VM porta un desktop XFCE con tema Yaru —
pannello, menu applicazioni, dock, icone, Thunar, terminale — `x11vnc` espone
lo stesso display `:1` e `websockify` serve noVNC sulla porta che la sandbox
pubblica. «Prendi il controllo» dà mouse e tastiera sulle stesse finestre e
sullo stesso profilo Chrome persistente che l'agente sta usando: un login fatto
a mano resta sul disco della VM senza passare dal contesto del modello.

**L'ambiente sta in un'immagine** (`sandbox-desktop/`, ricostruibile con
`node sandbox-desktop/build.mjs`), perché installarlo a runtime costava 209s di
apt più 68s di update su una VM fredda — più del lease con cui la macchina si
apre. Con l'immagine la VM è pronta in 7 secondi.

Tre cose imparate costruendola, tutte pagate:
- l'immagine deve stare in UNO strato. Con `--layers` il registry la accetta
  come «ready» e poi la sandbox muore appena nata con un 410 interno.
- quindi tutto deve stare sotto il tetto per blob (a 590 MB il push torna 413),
  e Chromium non ci sta: lo scarica `fetchChromium` al primo avvio (~60s), poi
  vive nello snapshot.
- la base non può essere `vercel/sandbox/ubuntu`: dal registry dei clienti non
  è scaricabile (404). Si riparte da `ubuntu:24.04` ricostruendo utente
  `ubuntu`, home in `/vercel`, sudo e node.

**La password è l'unico confine, e per questo è derivata e obbligatoria.**
`sandbox.domain(porta)` è un URL pubblico: niente cookie, niente sessione,
nessun nostro middleware davanti. `desktopPassword` la ricava con un HMAC di
`APP_SECRET` sul brand (8 caratteri, quelli che l'autenticazione VNC guarda
davvero), quindi non c'è niente da conservare, nessuna migration da applicare a
mano, e nessuna password a riposo nel database. Una password vuota è un
rifiuto, non un default. `x11vnc` sta su `-localhost`: da fuori si raggiunge
solo websockify.

`SANDBOX_GENERATION` passa a `g4`: nome unico per brand, più `ports` e immagine
che sono parametri di CREAZIONE — su un nome già esistente `getOrCreate` li
ignora in silenzio.

### Il window manager moriva appena nato, e la tastiera non scriveva

`ensureXvfb` aspettava che ESISTESSE il socket di X, non che il server
rispondesse: openbox partiva in quel buco, moriva con «Failed to open the
display», e nessuno lo rilanciava dentro la stessa chiamata. Il risultato era
un desktop senza window manager — il mouse si muove, la tastiera no, perché
senza WM nessuna finestra prende il fuoco. Ora si aspetta una risposta
(`xdotool getdisplaygeometry`), non un file.

### apt in chiaro non passava, e il modo grafico ci moriva sopra

Misurato su una VM vera con la policy della lane `agent`: `archive.ubuntu.com`
è nell'allowlist da sempre, ma apt lo chiama su HTTP, e senza SNI il filtro non
vede nessun nome — «Connection failed [IP: 185.125.190.83 80]», e poi «Unable to
locate package xvfb». Cioè `installPackages` di `graphical-bootstrap.ts`
falliva, e il modo grafico non poteva accendersi su nessuna macchina nata dopo
che la policy è stata stretta. L'allowlist per dominio funziona solo su TLS: le
sorgenti si riscrivono su HTTPS prima di `apt-get update`, e lo stesso comando
esce 0.

È lo stesso muro contro cui aveva sbattuto l'agente quando ha provato a
installarsi le librerie a mano e ha concluso «la VM non raggiunge i mirror».
Le raggiunge: non in chiaro.

### Il render Motion apriva una VM senza le librerie di Chromium

Remotion rende lanciando `chrome-headless-shell`. La lane `motion` apriva la
sandbox senza `needsBrowser`, quindi nessuno eseguiva `playwright install-deps`
sulla VM: il browser moriva all'avvio con
`libnspr4.so: cannot open shared object file`, insieme a `libnss3`, `libatk*`,
`libcups2`, `libdrm2`, `libxkbcommon0`, `libxcomposite1`, `libxdamage1`,
`libxfixes3`, `libxrandr2`, `libgbm1`, `libpango-1.0-0`, `libcairo2`,
`libasound2`, `libatspi2.0-0`. Ogni `render_stills` e ogni MP4 fallivano — e
l'errore arrivava all'agente travestito da «VM chiusa», quindi provava a
riparare il TSX, che non c'entrava niente.

Non serviva un'immagine nuova né un mirror apt: il provisioning che installa
esattamente quelle librerie esiste già ed è quello di `sandbox_browse`
(`ensureBrowser` → `playwright install-deps chromium`, immagine Ubuntu,
marcatore su file). Mancava solo di chiederlo: `needsBrowser: true` sulle due
aperture di `render-tools.ts`.

Non è servito per l'immagine: misurato su una VM vera, quella di default è già
Ubuntu 26.04 con apt e sudo, e senza `libnspr4`/`libnss3`. `ensureBrowser`
provvisiona anche le macchine `g2` già nate. (`SANDBOX_GENERATION` passa
comunque a `g3`, ma per il desktop remoto qui sotto.)

Costo noto e non risolto: la lane `motion` ora scarica ANCHE il Chromium di
Playwright, che Remotion non usa — si potrebbe passare a Remotion
`--browser-executable` puntando a quello, ma è un percorso non provato e il
render è rotto adesso.

## 2026-08-26

### Le skill del repo entrano nell'agente harness

Il meccanismo c'era, l'ingresso no.

- `HarnessAgent` accetta `skills` (contratto `HarnessV1Skill` di `@ai-sdk/harness`) ma nessuno
  gliene passava: le SKILL.md del repo (`.agents/skills`, `.claude/skills`) restavano materia
  morta per il turno di chat. Ora il loader (`src/lib/server/harness-skills.ts`) le legge, parsa
  il frontmatter minimo a mano (name, description — niente dipendenze nuove) e attacca i file
  testuali della cartella come `files`; binari e file sopra 64KB saltano. Cache su mtime+size.
- DEFAULT OFF: senza `HARNESS_SKILLS` non parte nulla. La selezione è una lista di nomi separati
  da virgola; `*` = tutte. Le skill del repo sono scritte per gli agenti di codice e iniettarle
  di default nel brand sarebbe rumore pagato in token.
- Scelto loader esplicito invece del materializzare directory native: gli adapter harness che
  scrivono file nella sandbox richiederebbero un albero pronto prima del turno; il contratto
  `files` inline è pensato esattamente per chi non ha skill directory.
- Nuova env `HARNESS_SKILLS_EXTRA_DIRS`: percorsi assoluti (separati da `:` o `;`) a cartelle di
  skill fuori dal repo, es. il pacchetto Superpowers (`~/.claude/plugins/superpowers/skills`).
  Stessa pipeline e stesso filtro di selezione delle radici del repo; cartella mancante ignorata.

## 2026-08-25

### La cornice della sidebar è una riga sola

Tre pezzi che non si incontravano.

- La sidebar non aveva un bordo destro: la separava solo la maniglia di resize,
  che si accende sull'hover, esiste da desktop in su e sparisce col rail a
  icone. Un bordo che c'è solo a volte non è un bordo. Ora sta sul guscio
  (`[data-slot='sidebar-container']`), sempre.
- «Assumi un agente» era la prima voce della lista, con un separatore sotto a
  un'altezza qualunque. Ora è un HEADER alto quanto la top bar delle pagine
  (`shell-top-header`, cioè `--shell-top-h`), quindi i due fili sono una riga
  sola che attraversa la finestra invece di due tratti sfalsati.
- Il filo dell'header va da lato a lato: il rientro appartiene al contenuto,
  mai al bordo. La riga dentro tiene il suo, e resta incolonnata con la nav —
  misurato: stesso left e stesso right della prima voce.

Il colore è `--sidebar-line`, che è già dichiarato come `--line` e si inverte
da solo in scuro: il token per la cornice della sidebar esisteva, mancava solo
di essere usato.

### La riga viva torna in fondo a tutto, e nasce e muore come un pallino

Stato e tempo erano appesi all'ULTIMA bolla di testo, quindi una tool call
arrivata dopo finiva sotto di loro: l'etichetta diceva «sta generando» sopra
cose già successe. È lo stato del TURNO, non di una frase — ora sta in fondo,
sotto le bolle, sotto le chip, sotto il ragionamento, con l'avatar vivo alla sua
sinistra: animato, che segue il puntatore, e lì per tutta la durata del turno.

Il volto non sta più nel gutter della prima bolla mentre il turno gira: ci si
siede a turno chiuso. `.chat-turn-face` è in posizione assoluta, quindi comparire
non sposta nulla — il salto di scroll resta risolto senza tenere aperto un
segnaposto.

La riga entra crescendo da un pallino e esce ritirandosi in un pallino 0×0,
`expoOut`, con origine il centro dell'avatar. L'altezza entra
nell'interpolazione insieme alla scala: `transform` non toglie spazio, quindi
senza quello lo spazio sarebbe rimasto aperto per tutta l'uscita e si sarebbe
chiuso di colpo alla fine — il salto di scroll, solo spostato di 420ms.

### I risultati dei tool entrano nella riga rispecchiata

`toolsWithoutPayloads` teneva i parametri e buttava i risultati: la riga è
riscritta di continuo e un risultato grasso la moltiplica. Ma è anche l'unica
riga da cui il turno si ricostruisce quando la scheda NON è attaccata all'SSE —
worker, tab riaperta, riconnessione, e adesso il checkpoint che diventa
messaggio. Una chip che si apre e non dice né con cosa è partita né cosa ha
risposto non serve, ed era il caso di ogni turno lungo: esattamente quelli per
cui la riga esiste.

Ora ci stanno entrambi, sotto lo stesso tetto di 2000 caratteri, troncati e
DICHIARATI invece di spariti. La funzione si chiama `toolsForMirror`: il nome
vecchio descriveva una scelta che non c'è più, e un nome che mente costa più di
una rinomina.

### Cambiare scheda non ferma più il turno

Il poll che segue un turno vivo si fermava con `document.hidden`. Il guard
serviva a non chiedere 50 volte al minuto per ricevere 204, ma valeva anche
quando un turno stava LAVORANDO: cambi scheda, torni, e la risposta è ferma a
dov'era — che è precisamente «lo stream si è perso». Ora il guard vale solo a
vuoto.

### Un fake che non sapeva cancellare teneva scoperta la seconda metà del checkpoint

`admin.from(...).delete is not a function`, alzato dentro `handleFinish`. Il
fake db di `live.test.ts` non implementava `delete`, quindi il ramo che rimuove
il checkpoint a turno chiuso non era mai stato eseguito da nessun test — e la
prima volta che è girato ha alzato.

Due riparazioni, e la seconda è quella che conta.

- **Il fake ora sa cancellare**, e c'è il test che lo pretende: a turno chiuso
  del checkpoint non resta niente, la riga definitiva è l'unica. Era la metà
  della feature che nessuno guardava. Nello stesso giro, `maybeSingle()` dopo un
  `insert()` tornava la PRIMA riga della tabella invece di quella appena creata:
  un id di un'altra riga spacciato per quello nuovo — che nel percorso del
  checkpoint voleva dire cancellare la riga sbagliata.
- **Il `delete` non può più portarsi via la chiusura.** Era scritto col solo
  ramo di rifiuto della promessa, ma una chiamata che alza PRIMA di diventare
  promessa lo scavalca: il throw usciva da `handleFinish` e si mangiava thread in
  cima, broadcast e verdetto. Ora è in try/catch e al massimo lascia un doppione.
  Un doppione costa una riga di troppo in chat; quello costava il turno.

### Il parziale diventa una riga vera mentre il turno gira

Il difetto come lo racconta chi lo subisce: turno da mezz'ora, ricarico la
pagina, il thread è quello di prima. Dieci minuti di lavoro sembrano cancellati
dall'agente.

Il lavoro c'era: in `agent_kit_runs.partial`, una colonna che il transcript non
legge. Visibile solo se il riaggancio allo stream riusciva — e un refresh lo
spezza, perché lo specchio che scrive quella colonna è un ramo del tee dell'SSE,
non un ciclo del server. Era già scritto in un commento nel codice, misurato
(25/8: 29 run su 61 senza un solo `partial`, uno da 674 secondi) e lasciato lì.
Un difetto misurato e non riparato è il difetto due volte.

Ora il BATTITO — un timer del server, che al refresh non muore — promuove il
parziale in una riga assistant vera in `chat_messages`, riscritta a ogni giro.
`partial_saved_msg_id` sul run è il legame: la prima volta inserisce, poi
aggiorna sempre quella. Il transcript diventa lui la vista viva: ricarichi e il
lavoro c'è perché viene dal database, prima ancora che il riaggancio parta.

- Una copia sola in ogni istante: finché la bolla viva disegna quella risposta,
  la riga di checkpoint è saltata nel transcript (`liveCheckpointId`).
- A turno chiuso la riga definitiva atterra e il checkpoint viene cancellato —
  DOPO la chiusura, non prima: se il processo muore in mezzo resta un doppione,
  visibile e riparabile, invece di cancellare l'unica copia del lavoro.
- Nessuna migration: `partial_saved_msg_id` (0219) esiste già, ed è lo stesso
  campo che `cancelKitRun` guarda per non scrivere un secondo parziale allo Stop.
- Il battito legge con `select('*')`: nominare `partial` o `partial_saved_msg_id`
  dove le migration non sono applicate prende un 42703 che azzera la lettura, e
  quella lettura è anche come il turno si accorge dello Stop.

### Accanto al volto, da quanto NON si vede niente

Il contatore accanto all'avatar mostrava il tempo del TURNO, che dice «lavora da
30 minuti» anche mentre il testo scorre: non è la domanda che uno si fa davanti
a un render lungo, che è *è fermo?*. Ora quello stesso contatore riparte a ogni
cosa che l'utente vede comparire — un pezzo di testo, una tool call — quindi se
cresce vuol dire che non sta arrivando niente.

Quello che c'era, non uno accanto: il primo tentativo ne aveva aggiunto un
secondo sotto il volto lasciando in piedi quello sull'hover. Due numeri per una
domanda sola sono peggio di uno sbagliato.

Ne esce anche del codice: il tempo del turno era calcolato in due componenti con
due `setInterval` propri, e la durata del turno finito sta già sulla riga delle
azioni. Prop `liveMs` e i due ticker via.

### Stop cercava uno stato che nessuno scriveva

Secondo motivo per cui Stop non chiudeva il turno, dopo quello del client che
non chiamava il server. `cancelKitRun` mette il run in `aborted`; `runKitTurn`
guardava `state === 'stopped'` — una stringa che nel vocabolario del run non
esiste e che nessuno ha mai scritto. Quindi `stoppedByUser` restava falso per
sempre.

Non era invisibile perché `runClosedBy` si popolava comunque e rifiutava il
tool successivo: il turno si fermava, ma solo al confine del tool DOPO — e
dentro un render motion sono minuti, che dallo schermo si leggono come «Stop
non fa niente». E il ramo di chiusura prendeva la strada del turno finito bene
invece di quella dello stop.

Il nome dello stato ora è dichiarato una volta (`KIT_RUN_STOPPED_BY_USER` in
`turn-limits.ts`, accanto a `KIT_RUN_WORKING_STATES`) e lo usano tutti e due i
lati. Era esattamente la regola scritta in due punti che diverge al primo
cambiamento — e diverge in silenzio.

Nota sul verde: `live.test.ts` aveva già il test giusto («Stop ferma davvero il
turno kit»), e su dev era ROSSO. Passava per un'altra strada finché il
`budgetMs: 1` chiudeva il turno prima che la differenza si vedesse.

### Stop non usciva dal browser dopo un reload

Segnalato dal vivo su un turno kit da 17 minuti: ricarica la pagina, la chat
dice che sta lavorando e mostra Stop, ma Stop non fa niente — il turno continua
a spendere, i messaggi restano in coda, e «Send now» rimbalza in coda.

`sessions` è una mappa in MEMORIA: dopo un reload è vuota, mentre il turno sul
server è vivissimo. `cancelChatSession` apriva con

```
const s = sessions.get(threadId);
if (!s) { clearStorage(threadId); return; }
```

cioè proprio nel caso in cui il gesto DEVE arrivare al server usciva senza
chiamarlo. Il commento tre righe sotto («SEMPRE, anche senza jobId») racconta
la stessa lezione imparata un livello più in basso: là mancava il job id, qui
manca l'intera sessione. La chiamata era condizionata a uno stato locale che
non è mai stato l'autorità su cosa sta girando.

Ora la POST parte comunque; `brandSlug` diventa un parametro perché senza
sessione l'URL non si può ricavare da nessun'altra parte. Stessa correzione per
«Send now», che passa da qui prima di chiedere l'invio: era per quello che il
messaggio tornava in coda.

Non è una perdita di dati: il turno scrive in `agent_kit_runs.partial` a ogni
battito, e il transcript si popola a fine turno. Quello che l'utente ha letto
come «l'AI ha cancellato dieci minuti di lavoro» era un turno ancora in corso
con niente in `chat_messages` — che resta una cosa da guardare: diciassette
minuti di lavoro che vivono in una sola colonna jsonb sono un rischio, non un
design.

### Il tempo e lo stato tornano sul turno vivo

Regressione della mia modifica precedente: spostando il volto nel gutter avevo
tolto l'etichetta («Thinking…», «Generating…») e messo il tempo sotto l'avatar.
Da fuori si legge come un avatar morto. Ora stato e tempo stanno nel posto che
la riga azioni occuperà a turno chiuso — stessa altezza, quindi il salto di
scroll resta risolto — e si scoprono passando sopra la risposta, volto o bolla.

### La delega esiste anche nel kit: gli specialisti tornano ad avere aiutanti

Il bug: in chat kit l'agente chiamava `run_subagent` e riceveva «tool
'run_subagent' non esiste» — con l'elenco dei tool disponibili che lo
NOMINAVA. Il modello vedeva un tool fantasma: dichiarato in `BUILTIN_TOOLS`
dal giorno in cui il kit è nato (81dcbc12), mai eseguito dall'executor di
nessun bridge. Non era una regressione — sul kit non ha MAI funzionato;
funzionava solo sul motore classico. Ma il modello non sa nulla dei motori:
gli era stato promesso uno strumento che non c'era, e ogni volta ci provava
ci bruciava un giro.

Due decisioni, una per metà del difetto:

- **Il fantasma sparisce.** `run_subagent` esce dal catalogo builtin
  (`DELEGATION_TOOL_NAMES` con lui): nessun tool dichiarato senza chi lo
  esegue. Il test che lo pretende ora è il guardiano del contrario.
- **La delega vera si monta dove serve.** Il plugin nuovo
  (`agent/plugins/delegation.ts`) espone al kit GLI STESSI tool del motore
  classico — `delegate_task`, `run_task_pipeline`, `run_parallel_tasks`,
  budget di 50 run a turno, ruoli research/execute/verify/sandbox/compose,
  tracce su `runs/<id>.md`, crediti su `ai_calls`. Nessun secondo motore di
  delega: il ponte traduce ToolSpec → tool AI SDK come fanno content/web/team.
  Senza modello configurato la delega non si monta (un orchestratore senza
  aiutanti batte un turno morto alla prima delega).

Le garanzie che contano, tutte preesistenti e ora valide anche sul kit:

- **Niente ricorsione**: i worker non ricevono mai i tool di delega
  (`NEVER_FOR_SUBAGENTS`) — profondità uno, e chi parla con l'utente resta
  l'orchestratore. Aggiunti al registro anche i terminali del kit
  (`reply`/`ask_user`/`plan`): un worker non chiude né parla per il capo.
- **Le letture del kit sono letture** anche per i ruoli read-only:
  `brand_ls`/`brand_read`/`brand_grep`/`query` entrano in `READ_ONLY_EXTRA`,
  altrimenti un `verify` sul kit restava senza occhi.
- **Il perimetro di scrittura usa i nomi veri del kit** (`content_create_post`
  via `hubToolKeys`), non quelli dell'hub di chat: un `execute` con il
  perimetro sbagliato sarebbe nato senza mani.
- **I fatti risalgono**: i worker girano sugli STESSI oggetti tool
  dell'orchestratore, quindi ogni loro chiamata passa dall'applyTool del
  bridge — battito, Stop, `succeededTools` e giudice di chiusura li vedono.
  Era l'avvertenza lasciata scritta nel CHANGELOG quando il tool fu tolto dal
  verdetto («quando lo sarà [montato], la delega andrà aggiunta»).

Nota di collaudo: i due test rossi su `computerCalls` in live.test.ts sono il
cantiere "stato del computer" ancora aperto (import senza call site) — non
toccati da questo lavoro.

### Il turno vivo ha la forma del turno finito, non una sua

Alla chiusura dello stream la risposta si riassestava: le bolle cambiavano
respiro, comparivano le icone delle azioni, e l'avatar saltava da sotto il
turno al gutter della prima bolla. Tre salti, una causa sola — lo stesso turno
è disegnato da due markup diversi, `ChatLiveStatus` mentre arriva e il ramo
`assistant` della pagina quando è salvato, e i due erano già stati fatti
convergere tre volte a colpi di compensazione (`max-width` sui figli del turno
vivo, `margin-left` sulle bolle vive, il cappello di misura). Ogni volta la
misura mancante è tornata da un'altra parte.

Ora la geometria è dichiarata in un punto solo e i due stati la condividono:

- Le bolle vive nascono dentro la stessa `.chat-turn-line` del turno finito,
  col volto nel gutter della PRIMA bolla — dove finirà. Niente più teletrasporto
  dell'avatar a fine risposta, e il `margin-left` di compensazione sparisce:
  il rientro lo dà la riga, come per il turno salvato.
- Il respiro fra i blocchi è `gap: inherit`: il turno vivo e quello finito
  stanno nello stesso contenitore, quindi non possono divergere. Erano 0.5rem
  contro 0.75rem, ed è per questo che «i messaggi si restylavano».
- Lo spazio della riga azioni resta libero mentre il turno gira (un segnaposto
  alto quanto la riga, non le azioni vere: copia e pollice su mezza risposta
  non vogliono dire niente). A turno chiuso la riga ci entra senza spingere giù
  nulla — è il salto di scroll che si vedeva.
- Il tempo del turno scende sotto il volto, dentro il gutter già libero, invece
  di stare su una riga propria che a fine stream spariva portandosi via
  l'altezza. `compact` resta solo per le workbench dei maker, che un turno
  finito con cui somigliarsi non ce l'hanno.

Misurato in Chrome su una pagina di prova che monta i due stati con lo stesso
contenuto: altezza totale 104 e 104, volto (24, 2) e (24, 2), bolla (62, 634,
70) e (62, 634, 70). Coincidono. Resta da unificare il RENDERER, non solo la
geometria: finché sono due template, la quarta divergenza è solo questione di
tempo.

### Editing mirato delle composizioni motion: `motion_edit`

Cambiare una riga di una composizione obbligava a rispedire l'intero source
(~19k caratteri) con `motion_write { id }` — costo di token e rischio di
riscritture involontarie. Ora esiste `motion_edit { id, op }`:

- op `grep`: legge la riga `source` della composizione (la stessa lettura che
  fa l'overwrite) e restituisce le righe col pattern come «NNN: riga» — match
  letterale case-insensitive, non regex;
- op `replace`: sostituisce `old_string` → `new_string` e salva passando dagli
  STESSI gate di `motion_write` (`compileMotionSource` + `staticGateViolation`
  sul sorgente RISULTANTE); zero occorrenze rifiuta rimandando a grep,
  occorrenze multiple rifiuta col conteggio se manca `replace_all`.

`motion_write { id }` senza `force: true` ora rifiuta, nominando `motion_edit`;
create senza id invariata. La descrizione di `motion_list` dice la verità nuova
(edit mirato via `motion_edit`, riscrittura totale via `motion_write`+force).

Scartato: riusare `applySourceEdit` di compile.ts — non ha `replace_all` e il
suo messaggio non guida a grep; la semantica richiesta vive nel plugin accanto
al gate condiviso `saveComposition` (estratto dal corpo di `motion_write`, che
prima duplicava gate+persistenza).

### «Nuovi messaggi» solo per ciò che ti sei perso davvero

Il divisore compariva sopra qualunque risposta arrivata dopo `last_read_at`,
e `last_read_at` è la foto scattata dal server all'apertura. Due conseguenze,
entrambe sbagliate: la risposta che arriva mentre hai il thread aperto davanti
si prende un «Nuovi messaggi» sopra — l'hai appena vista scrivere; e chi
ricarica la pagina un minuto dopo se lo ritrova sulla stessa risposta che
stava leggendo, perché il confine sul server non si era ancora spostato (il
`markThreadRead` in tempo reale non parte se il canale Realtime non è
connesso, e la 0137 in produzione va applicata a mano).

La causa strutturale è che il segnalibro sa *dopo cosa* è arrivato un
messaggio, non *se l'utente l'ha visto*. Ora la decisione ha un secondo
ingrediente: `openedAt`, il momento in cui si è entrati nel thread, congelato
e non riletto finché si resta lì. Da quel numero discendono tutti e due i
casi senza un ramo dedicato a ciascuno —

- una risposta arrivata DOPO l'apertura è per definizione più recente della
  soglia, quindi non può diventare il confine per quanto si resti sul thread;
- una arrivata poco PRIMA è stata vista, quindi ricaricare non fa comparire un
  divisore su ciò che si stava già leggendo.

`UNREAD_MIN_AGE_MS` (5 minuti) è l'unica soglia, dichiarata accanto alla
funzione. Senza apertura (`openedAt = 0`) non c'è confine: nessun divisore —
lo stesso degrado silenzioso di quando manca il segnalibro.

### Il morph dell'avatar non era mai partito: `from` era già `to`

Le espressioni cambiavano di scatto pur avendo tutta la macchina del morph
addosso (`avatar-morph.ts`, il rAF, il piano di accoppiamento). La causa è di
una riga: l'effect leggeva la spec di partenza da `drawn`, cioè da un
`$derived`. Quando un effect gira, i derived sono GIÀ aggiornati — quindi da
fermi `drawn` era la faccia d'arrivo, il piano era da X a X e i 420ms
interpolavano il nulla. Funzionava solo nel caso raro del cambio incatenato,
con un tween ancora in volo: l'unico che chi ha scritto il codice aveva
guardato.

- La sorgente ora è tenuta a mano (`shownSpec`): da fermi l'ultima spec
  approdata, a tween in corso il frame vivo. Nessuna lettura di derived
  dentro l'effect.
- L'easing passa da cubica a **expo in-out** (`easeInOutExpo`): quasi ferma
  agli estremi, tutta la corsa nel mezzo — è ciò che fa leggere il cambio
  come una faccia che si rimodella invece che come due pose incrociate.
- `MORPH_MS` 420 → 620. Con l'expo i due estremi sono regalati alla quiete: a
  420ms restavano ~170ms di movimento vero, di nuovo un taglio. Resta dentro
  la sosta più corta del ciclo (800ms).
- Le transizioni CSS di colore seguivano il morph su una durata scritta a
  mano in due punti; ora la durata arriva da `MORPH_MS` via variabile inline
  e la curva è la bezier equivalente all'expo.
- **Secondo difetto, trovato misurando e non leggendo**: `t0` era timbrato
  quando gira l'effect, non al primo frame. Fra i due può passare molto — una
  scheda in secondo piano non esegue rAF affatto, un avatar fuori schermo
  nemmeno, e durante il turno di un agente il thread è occupato: se il primo
  frame arriva oltre MORPH_MS, `t` vale già 1 e il morph collassa in un
  salto. È lo stesso sintomo del difetto sopra, per un'altra strada.

Verificato in Chrome su una pagina di prova usa e getta, con il rAF sostituito
da un orologio guidato a mano: la curva expo è stata campionata frame per
frame (occhi 8.80 → 6.80, archi da 0 alla misura piena, atterraggio esatto
sul target) e il primo frame in ritardo di 1200ms parte da t=0 invece che
da 1. Nessun harness DOM nel repo: i test coprono solo la curva, il resto è
misura.

### Export OSS verde: seam pigri, guard a due livelli, identità dietro env

La repo open non può contenere billing né riferimenti interni; l'export
(`scripts/export-oss.mjs`) ora esce 0 e la copia esportata compila e passa i
test publish. Tre filoni per arrivarci.

- **Identità configurabile**: email ops/supporto, dominio sender, domini
  interni, URL di fallback e UA crawler non sono più letterali ma env
  (`OPS_EMAIL`, `SUPPORT_EMAIL`, `SUPPORT_EMAIL_DOMAIN`,
  `INTERNAL_EMAIL_DOMAINS`, `PUBLIC_FALLBACK_APP_URL`,
  `CRAWLER_CONTACT_URL`) con default identici a prima — il cloud non cambia
  comportamento finché le env non sono impostate.
  ⚠️ **ATTENZIONE OPERATIVA**: il default di `INTERNAL_EMAIL_DOMAINS` è stato
  ristretto ad `anomalia.so` (la repo open non deve contenere il dominio
  interno). In produzione va impostata con entrambi i domini, o lo staff
  sull'altro perde i trattamenti interni.
- **Seam pigri al posto degli import statici** verso moduli esclusi
  dall'export: settings-actions e blog-settings seguono il pattern già usato
  da credits.ts (`await import(...)` con degradazione graceful); le superfici
  di monetizzazione pure (activate, upgrade, billing reconcile) sono escluse
  per path, non refattorate. Nessun file cancellato, nessun cambiamento di
  comportamento lato cloud.
- **Guard dell'export a due livelli**: HARD (chiavi private, segreti,
  service role key, dominio interno) fa fallire sempre; POLICY (link di prodotto in
  copy/i18n/docs — legittimi in una repo open come in Plausible CE — ed
  endpoint Zernio di default, sovrascrivibile) è ammesso per classi nominate
  con allowlist esplicite.

Verifica nella copia esportata (2858 file): guard strutturali/import/contenuto
ok, `stripe` rimosso dalle dipendenze, svelte-check a +4 errori ATTESI (i
TS2307 dei seam dinamici verso moduli volutamente assenti), 47/47 test
publish verdi. Non ancora fatto: `vite build` dentro l'export e
`docker compose up` dalla sola repo esportata (docker assente su questa
macchina). Restato fuori: link Calendly personale cablato in lifecycle/tick.

## 2026-08-25

### Self-host: build di produzione, sidecar cron e porta SocialPublisher

Tre buchi bloccavano il self-host annunciato in docs/SELF_HOSTING.md: l'app
girava solo con `npm run dev` (adapter-vercel pinned), i ~45 endpoint tick/work
non avevano nessuno che li chiamasse, e la pubblicazione social passava
soltanto da Zernio hosted senza via d'uscita.

- **adapter-node dietro `DEPLOY_TARGET=node`**: il default resta adapter-vercel,
  il deploy cloud non cambia una riga di configurazione. `npm run build:node &&
  npm run start` usa la stessa catena del build cloud (typecheck-runtime + vite).
  `infra/app/Dockerfile` (multi-stage, non-root) e il servizio `app` nel compose
  completano il percorso; serve heap generoso al build (~8GB, già in
  `build:node`), l'adapter ribundla tutto il server.
- **Sidecar cron** (`docker/cron/`): zero dipendenze, si sveglia al confine di
  minuto, valuta il manifest embedded speculare a vercel.json (43/43 endpoint)
  e chiama con `Authorization: Bearer $CRON_SECRET`. Il matcher implementa la
  regola Vixie per dom/dow ristretti (OR), `matchesCron` è pura e testata;
  `--selftest` incluso. Servizio `cron` nel compose, dipendente dalla healthcheck
  dell'app. In dev il server salta il controllo auth di proposito; nei build di
  produzione è fail-closed anche per il self-host.
- **Porta `SocialPublisher`** (`src/lib/server/publishing/`): Zernio diventa un'
  implementazione selezionabile, non l'unica. Selezione da env (`SOCIAL_PUBLISHER`,
  default zernio se c'è `ZERNIO_API_KEY`, altrimenti manuale); base URL
  sovrascrivibile con `ZERNIO_BASE_URL`. Il provider `manual` restituisce risultati
  strutturati `{ok:false,reason:'no_provider'}` così l'autopilot salta la
  pubblicazione invece di lanciare errori. Scelto lo shim compatibile su
  `zernio.ts` (12 file consumer e 2 suite con mock pinnato restano intatti)
  contro la cancellazione che avrebbe toccato ~16 file. I flussi DB
  (`ensureBrandProfile`, sync account/analytics) stanno FUORI dalla porta:
  nessun `SupabaseClient` oltre confine, solo DTO.

Test: 18 nuovi sul selettore (rossi prima, verdi dopo), 112 esistenti sui
flussi publish ancora verdi, 8+28 sul matcher cron. svelte-check: zero errori
nei file toccati (393 pre-esistenti altrove).

## 2026-08-25

### Onboarding: slug del brand mai più in conflitto (brands_slug_key)

Un utente con nome brand non latino («يونس بن عمارة») riceveva
`duplicate key value violates unique constraint "brands_slug_key"` al
momento della creazione: `slugify` svuota il nome e cade sul fallback
`brand`, e la produzione ha un indice unique GLOBALE su `brands.slug`
(`brands_slug_key`) che il repo non aveva mai registrato — mentre il codice
garantiva l'unicità solo dentro l'org. Due difetti sommati.

Fix: nuovo helper `insertBrandWithSlug` ($lib/server/brand-create) usato da
entrambe le creazioni dell'onboarding (`?/create` e `finish` legacy): al
primo conflitto sul vincolo riprova aggiungendo una coda random
(`brand-x7k2`, `slugWithRandomTail`), max 4 tentativi, e lascia passare
intatti tutti gli altri errori. Migration `0223_brands_slug_unique`
codifica l'indice come realtà, così il drift check smette di mentire;
corretto il commento scaduto in 0063 che diceva il contrario.

Nota di diagnosi: i 26 test rossi in suite sono del WIP pre-esistente nel
tree (agent bridge / svelte.config / package.json), riprodotti anche a
cambio staccato — non di questo fix.

## 2026-08-25

### HarnessAgent è l'UNICO motore del percorso chat kit

`runKitTurn` non chiama più `streamText` e non ha più il ramo `useHarness`:
l'unica strada è `startHarnessTurn` con la VM del brand
(`openBrandHarnessSession`) e il modello unico di `resolveHarnessModelRef` —
senza KIE configurata il turno muore con `harness_model_missing`, niente
fallback silenzioso. La chiusura turno esce dalle opzioni inline: diventa
`handleFinish`, invocata nel `.then` del consumo server-side con
`result.steps`/`result.text` (l'harness non invoca callback di fine), con
`turn.destroy()` in `finally`. Il loop guard si registra al confine tool
(dopo `succeededTools.push`), non più in `onStepFinish`; i tetti budget/deadline
si RILEGGONO alla chiusura, così la reason riflette il tempo davvero trascorso.

Cancellato l'albero alternativo: classe `AiRuntime` (con `AiRuntimeDeps`,
`stopReason`, mappa abort) — resta solo `buildTools` + `ExecToolCall`, che
harness-runtime e bridge condividono, coi suoi test. Via il flag plumbing
(`AGENT_KIT_HARNESS`, `harnessModelRef`) da `chat/+server.ts` e `queue.ts`.
Lo specchio SSE perde il rilevatore di sfratto via `select('state')`: senza
`abortSignal` nel nuovo motore non c'è nulla da interrompere; il reaper resta
l'unica autorità sulla chiusura.

**Perso saputo**: sul percorso kit sparisce `benchAwarePrepareStep` +
`midTurnMailbox` (lo stopWhen dell'harness non ha prepareStep) — un messaggio
scritto MENTRE uno specialista lavora torna ad aspettare il turno dopo,
come prima del 24/8. Il motore classico lo mantiene. Da rivalutare quando
l'harness espone un hook al confine di step.

Test: `live.test.ts` riscritto sull'harness finto (turni scripted, tee SSE che
aspetta il drain del turno, specchio con vantaggio sul client). LOC agenti:
71.963 → 71.720.

## 2026-08-25

### Un tenant solo, per chi installa da sé — e la porta che lo rende possibile

Anomalia è multi-tenant per costruzione: il brand è il tenant, 106 tabelle hanno `brand_id`, 173
policy RLS lo confrontano. Chi la installa per sé quel guscio non lo usa mai: uno switcher con una
voce, una griglia con una scheda, gli inviti per una squadra di uno.

**La misura, prima del piano.** Sembrava un lavoro su 432 punti (le letture di `params.brand`).
Non lo è: quelle letture in gran parte *passano lo slug* a una di **sei** funzioni, e ognuna era
già un contratto unico — `loadBrandForUser` (79 file), `brandBySlug` (13), `resolveSiteBrand` (9,
dai domini custom dei blog), `resolveSiteBrandByKey` (5), `brandIdFromSlug` (1, negli hooks) e la
risoluzione del layout, che ora si chiama `resolveTenant`. E i punti che leggono *più di un brand
insieme* sono **due**. L'app era già quasi a tenant singolo: era il guscio a essere multi.

**Cosa è stato fatto.** `resolveTenant` estratta dal layout (riordino puro: stessa cache, stesse
query, stesso 404), con `peers` separato apposta — è l'unico campo che esiste perché i brand sono
più di uno. Poi `TENANT_BRAND_ID`: quando c'è, `resolveTenant` non fa nemmeno la seconda query,
`/app` reindirizza al brand invece di offrire una lista, e Settings › Team risponde 404.

**Cosa NON è stato fatto, ed è deliberato.** Lo schema non cambia: `brand_id` resta su tutte e 106
le tabelle e nessuna delle 173 policy si tocca. Con un brand solo `auth_brand_ids()` restituisce
quell'id e ogni `where brand_id in (…)` è già corretto — zero migration, zero fermo, e tornare
indietro è togliere una riga da `.env`. E l'interfaccia non è stata toccata affatto:
`{#if switcherBrands.length}` in `DashboardSidebar` c'era già e si nasconde da sola.

**Solo lo UUID in ambiente**, non anche nome e slug: quelli vivono sulla riga `brands`, e una
copia in `.env` sarebbe una seconda fonte di verità che diverge in silenzio al primo rinomino. Se
il puntatore non trova la riga l'app si ferma e lo dice, invece di sembrare vuota.

**Un doppione scritto e tolto nello stesso giro:** avevo scritto `scripts/seed-tenant.mjs` prima di
guardare se esistesse già. `scripts/db-seed.mjs` c'era, e faceva di più (crea anche l'utente via
GoTrue). Ora stampa lui la riga `TENANT_BRAND_ID` da incollare.

Resta aperto: la build che *non contiene* il codice multi-brand invece di spegnerlo, e
l'onboarding (5237 righe), che oggi crea *un altro* brand e in self-host deve creare *il* brand.

## 2026-08-24

### La chat degli specialisti può girare su HarnessAgent

`runKitTurn` ha un ramo nuovo dietro `AGENT_KIT_HARNESS=on`: stessi handler
(persistenza, verdict, mailbox), motore diverso — `startHarnessTurn` monta Pi/KIE
Luna e restituisce uno `StreamTextResult`, quindi UI e mirror Realtime non cambiano.
Il modello dell'harness si decide in `resolveHarnessModelRef` (unico posto);
senza KIE configurata il ramo non si attiva. Default spento: l'eval comparativo
è il gate prima di accenderlo in produzione.

### Il banco di prova gira già sul nuovo harness

`agent-lab` non costruisce più `AiRuntime`: usa `createHarnessRuntime`, quindi il suo loop è
`HarnessAgent` (Pi in-process). Il modello smette di passare per il tier `auto`→KIE: senza id
esplicito Pi risolve col suo default via auth d'ambiente — scelta deliberata, il lab è dev-only
e l'identità del modello ora segue l'adapter, non il tier della chat. `createModelResolver`
resta montato solo per il runtime AI SDK; `createAiRuntime` resta finché `live.ts` migra
(fase 2 del ledger), poi si butta col suo loop.


### L'harness si compra, non si scrive: `HarnessRuntime` dietro `AgentRuntime`

> Decisione di prodotto prima che di codice: siamo un tool che produce contenuti con la memoria
> del brand, non un laboratorio di runtime agentici. I due motori che gestiscono gli agenti oggi
> (kit v2 bypassato dal bridge, motore classico nella coda) sono il debito misurato nel confronto
> con rakazo — 2,2× il codice a parità di dominio. La strada inversa: il loop lo possiede
> `HarnessAgent` (AI SDK 7, adattatori Pi/Claude Code), noi possediamo solo ciò che ci
> differenzia. Il registro feature-per-feature e le fasi di cancellazione con i loro gate stanno
> in `docs/HARNESS_MIGRATION.md`; nessuna riga vecchia muore finché
> la sua feature non è garantita nel sistema nuovo.

Primo mattone: `packages/agent-adapters/src/runtime/harness-runtime.ts`, un `AgentRuntime`
che monta `createPi` (in-process, sandbox just-bash) o `createClaudeCode` (sandbox Vercel) a
seconda del `ModelRef.provider`. Le decisioni prese e quelle rifiutate:

- **I tool restano nostri.** Passano all'harness host-executed tramite la STESSA traduzione
  `buildTools` del runtime AI SDK: una sola forma per i 47 tool di dominio, zero porting.
  Il contesto (`brandId`/`userId`/`runId`) arriva integro all'`execute` — testato, perché la
  prima versione passava un contesto vuoto dalla fabbrica.
- **Gli agenti NON si cachiano** fra i run: `HarnessAgent` porta chiusi dentro strumenti e
  istruzioni, e un oggetto condiviso fra brand diversi legava i tool al contesto del primo
  turno. Un'istanza per run costa un oggetto di configurazione.
- **Deadline iniettata come dipendenza**, non importata da `$lib` (un pacchetto non importa
  l'app): il loop si ferma da solo e esce con reason `deadline`, stessa semantica di
  `turn-limits`. Il token budget NON è ancora mappato: l'eval deve prima dire se la
  compaction dell'harness lo rende superfluo o se va riportato come policy.
- **Sessione distrutta nel `finally`**, anche su errore e su abort: senza, ogni spike lasciava
  sandbox vive. Il resume vero (`detach`/`continueFrom`) è fase 2 — qui il run è monolitico
  apposta, il contratto viene prima della durabilità.
- Scartato durante il lavoro: una variante con buffer degli eventi e stato sull'istanza
  (serviva per "semplificare" il drain) — rompeva lo streaming e i run concorrenti; il file è
  stato riscritto prima di committare.

Test: 6 scenari sul contratto (mappatura eventi, stop terminale, deadline, abort, distruzione
sessione, contesto nei tool) più i 82 esistenti del package, tutti verdi; gate typecheck ok.
Le fasi di cancellazione partono SOLO dopo l'eval comparativo: prima `live.ts` smette di
orchestrare (~800 righe), poi `runTurn`/executor (~900), poi la coda si assottiglia.### La squadra esiste anche nel kit: `message_agent` accanto a ogni mestiere

### La coda che non si svuotava, la chat che restava occupata, l'agente che si ripeteva

Quattro difetti visti in produzione lo stesso giorno, tre con la stessa radice a monte.

**«Elimina» non eliminava e «invia ora» duplicava** (`chat/+server.ts`, azioni `queue_delete` e
`queue_send_now`). La radice: `chat_jobs` aveva policy RLS di INSERT/SELECT/UPDATE ma NESSUNA di
DELETE — e con RLS una delete rifiutata non lancia: torna 0 righe con `error` null. Le due azioni
cancellavano nel vuoto senza leggere l'esito: la riga pending restava, la coda la ridisegnava
(«elimina» rotto) e il drain la rieseguiva dopo l'invio live («invia ora» che duplica). Rimedio in
tre pezzi: la policy mancante (`0221_chat_jobs_delete_policy.sql`, DA APPLICARE A MANO); l'esito
letto sempre (`deletePendingChatJobOrReportFailure`: `.select('id')` + controllo righe, 500 vero se
la riga non se n'è andata — in `queue_send_now` la delete viene PRIMA di cancellare il turno in
corso, così un fallimento non lascia mezzo lavoro); e l'errore mostrato in pagina invece del
silenzio. Scartato: cancellare con l'admin client — avrebbe aggirato il sintomo lasciando la
policy sbagliata.

**La UI restava occupata a turno finito** (`chat/[thread]/kit-run/+server.ts`). L'endpoint del
«segno di vita» contava come lavoro in corso anche `waiting_input` (che è una domanda già salvata
in chat: la risposta dell'utente deve PARTIRE, `runKitTurn` fa resume — non finire in coda dietro
se stessa) e i run `running` zombie senza battito. Il client (`+page.svelte`) accoda tutto finché
`orphanRun` è vivo, mentre il bottone di stop guarda solo `loading`: risultato, niente stop e
messaggi in coda a vuoto. Ora l'endpoint applica lo STESSO criterio di `threadHasActiveKitRun`
(stati `queued`/`running`, vita entro 10 minuti — `showedLifeWithin`), e i due flag tornano
d'accordo perché `orphanRun` si spegne appena il run non lavora più davvero.

**Il thread in loop** (`e61c5136`, agente motion): il modello riconsegnava PAROLA PER PAROLA la
stessa risposta («Fatto. Nuovo trailer Apple-style… 502 frame») turno dopo turno, senza chiamare
alcun tool — il giudice di chiusura rilanciava, il rilancio riproduceva lo stesso testo, e ogni
giro SALVAVA il doppione. Due contromisure in `agent/bridge/live.ts`: il guard anti-loop di step
(`createChatLoopGuard`, lo stesso dei motori classici, che al kit mancava) dentro `stopWhen`; e il
confronto fra la risposta finale e il messaggio assistant precedente (`isRepeatedReply`) quando il
turno si è chiuso da solo senza lavoro nuovo — il doppione NON si salva mai: finché c'è margine
(`MAX_VERDICT_LAPS`) parte un rilancio correttivo silenzioso che ordina di fare o chiedere
(`repeatedReplyContinuation`), a tetto raggiunto si salva la presa di coscienza
(`repeatedReplyNotice`) che chiede all'utente invece di girare. Scartato: un tetto più basso ai
rilanci — tronca e lascia senza risposta, che è il difetto con un'altra faccia.

**Il giudice di trascrizione** (`src/lib/server/eval/transcript-judge.ts`): a fine scenario la
trascrizione completa (messaggi, tool con argomenti ed esiti, stati dei run) va a un modello con
domande CHIUSE vero/falso e il verdetto è la congiunzione delle risposte; un verdetto malformato
LANCIA, mai un pass silenzioso. Riusabile da `scripts/eval/` via `$lib`. Lo scenario del thread
incastrato vive in `live.test.ts` («lo scenario del thread incastrato e61c5136»): parte dai
messaggi veri come fixture, fa girare il motore vero, e verifica che l'agente si sblocchi da solo
— guardato fallire col rilevatore spento (tre rossi, il doppione salvato identico alla
produzione), poi verde.
### Nove casi limite per la valutazione, e il banco di prova che serviva a metterli in scena

Il catalogo di scenari misurava la richiesta normale fatta bene. I difetti che costano, però,
non stanno lì: stanno dove il turno chiude `done`, nessun tool fallisce, la risposta sembra una
risposta — e il prodotto ha sbagliato lo stesso.

**Il banco di prova prima degli scenari.** Tre cose non si potevano nemmeno mettere in scena, e
sono state costruite:

- `FixtureOpts` in `scripts/eval/fixture.ts` — `bare` (il brand appena creato: nessun kit, nessun
  piano, nessuna rubrica, nessun post) e `drafts: n` (quante bozze). Il default resta il brand
  pieno di sempre: gli scenari esistenti non cambiano di un carattere.
- `RunTurnOpts.threadId` in `turn.ts` — un secondo messaggio sullo STESSO thread, con la storia
  passata da `loadHistory`, la stessa della route. Prima il banco di prova passava sempre
  `[userMsg]` a `runKitTurn`: un prodotto senza memoria per costruzione, e nessuno scenario che
  potesse accorgersene.
- Il confine del turno letto dall'**orologio del database** e non da quello della macchina che
  lancia. Su un thread al secondo turno i messaggi e i run del primo sono ancora lì: contarli
  avrebbe fatto leggere «due bolle» e «rilancio del giudice» a un turno impeccabile. Un
  `gte(created_at, startedAt)` col timestamp locale sarebbe stato lo stesso difetto con un
  ritardo di orologio al posto della svista.

**I nove scenari** (`scripts/eval/scenarios/`), ognuno con in testa il difetto che cerca:

| id | il difetto plausibile |
|---|---|
| `brand-nudo` | brand appena creato: l'agente inventa invece di dire «niente» — e un numero diverso da `0` è la lettura che attraversa i brand dell'utente, chiusa in main lo stesso giorno |
| `mucchio-di-bozze` | `read_posts` tronca a 20/50 e restituisce `count` della PAGINA: l'agente lo spaccia per il totale |
| `due-richieste` | due richieste in un messaggio, la seconda cade senza un segnale |
| `memoria-di-ieri` | al secondo turno il pronome non ha più referente: chiede di nuovo, o prende la rubrica sbagliata |
| `lingua-ospite` | `locale` non raggiunge il system prompt: una domanda inglese su dati italiani può tornare in italiano |
| `bozza-ambigua` | «quello nuovo» fra due bozze: indovina e programma il post sbagliato — e riesce, quindi nessun guardiano lo vede |
| `richiesta-impossibile` | vincoli che si contraddicono: ne sceglie uno in silenzio e conia un artefatto che l'utente rifiuterà |
| `tool-che-rifiuta` | il cancello `platform_not_connected` dice no e l'agente lo tace, o rientra da `allow_unconnected` senza dirlo |
| `fuori-mestiere` | un articolo chiesto al Motion: chiama un tool che non ha, o consegna un video al posto dell'articolo |

`mucchio-di-bozze` non è un'ipotesi: `read_posts` ha `limit` con massimo 50 e restituisce
`count: posts.length`, cioè il conto della pagina. Su 60 bozze la risposta comoda è coerente con
tutto ciò che l'agente ha visto e nessun guardiano la può smascherare — il tool non ha mentito,
ha risposto a una domanda diversa da quella dell'utente.

**Tre asserzioni nuove**, e una regola nel decidere quali:

- `answersInLanguage` — conta parole funzionali esclusive di una lingua. Scartato un rilevatore
  vero: una dipendenza nuova per una domanda che si risolve con due liste. Il ceiling è
  dichiarato e provato — su una risposta di due parole non decide, e resta rossa dicendo i due
  conteggi invece di tirare a indovinare.
- `finishedDoneOrAsking` — `ask_user` chiude il run su `waiting_input`, quindi `finishedDone`
  accendeva un rosso proprio sul comportamento che questi scenari vogliono premiare.
- `eitherHolds` — su una richiesta ambigua o impossibile ci sono DUE modi corretti (chiedere,
  oppure non fare niente) e uno solo di sbagliare. Il dettaglio riporta entrambe le strade,
  perché sapere quale ha preso è metà del rapporto.

**Nessuno dei nove è stato eseguito, e lo dichiarano tutti** con `unrun`: in questo worktree non
c'è `.env`, quindi il banco di prova non può nemmeno fare login. **Spesa: $0,00**, zero righe in
`ai_calls`, nessun brand di prova creato né distrutto, nessun residuo sotto `media/<userId>/`.
Nel giro di default (`npm run eval`) entrano i tre di sola lettura — `brand-nudo`,
`mucchio-di-bozze`, `due-richieste`; gli altri si chiedono per nome perché il loro rosso si paga.

Guardia gratis contro il peso morto: `scripts/eval/scenarios.test.ts` incrocia ogni file della
cartella con gli import di `run.ts` e pretende `pins`, `judge` e un tetto di spesa. Uno scenario
scritto e mai registrato sembra copertura e non esegue mai — i file si leggono come TESTO invece
di importarli, o `fixture.ts` tirerebbe dentro `$env` e il controllo sarebbe rosso per
l'ambiente invece che per il repo.

### Un cancello prima della spesa: produrre per una piattaforma che il brand non ha collegato

La valutazione ha misurato il difetto più caro di tutti. Alla richiesta «pubblica su TikTok» su un
brand **senza account TikTok**, l'agente ha chiamato `content_create_post` + `content_schedule`,
generato un'immagine AI con due giri di controllo qualità e renderizzato un video: **429 secondi e
$0,1873** per un post che nessuno può pubblicare. La risposta finale era onesta, quindi il guardiano
anti-bugia taceva. Il difetto non era la bugia: **nessun cancello chiedeva se la piattaforma fosse
collegata PRIMA di spendere.**

Il rimedio non è una raccomandazione nel prompt — è lo stesso errore che aveva fatto leggere l'agente
attraverso i brand. È codice, e sta nella funzione condivisa, non nel chiamante che il difetto
nominava:

- `connectedPlatforms(supabase, brandId, platforms)` in `publish.ts`, accanto a `publishApprovedPost`:
  stessa tabella (`social_accounts`) e stesso filtro (`status = 'active'`) del fan-out che pubblica
  davvero. Un cancello che leggesse altrove potrebbe dire sì dove il publisher dice no.
- `create_post` lo chiama **prima** di toccare il brand kit, il renderer o il video, e prima di
  qualunque credito: piattaforma chiesta esplicitamente e non collegata → `platform_not_connected`,
  zero rendering, zero righe scritte.

Due cose deliberate, perché un cancello troppo largo blocca lavoro vero:

1. **Solo la piattaforma esplicita.** Senza `platform` si sta sul default del brand, e preparare
   bozze prima di collegare gli account è esattamente cosa si fa in onboarding. Il ceiling è
   annotato dove sta (`ponytail:`): se un agente impara a omettere `platform` per aggirare il
   cancello, il passo dopo è gaterare anche il default, ma solo per i brand che almeno un account
   ce l'hanno.
2. **L'errore è correggibile, non è un muro.** Dice cosa dire all'utente («collegalo da
   Impostazioni > Connettori») e come procedere se l'utente vuole comunque la bozza:
   `allow_unconnected: true`, un booleano nuovo su `create_post`. Un JSON opaco avrebbe prodotto
   tentativi a caso.

### E `noAccount: true` accanto a `success: true`, che si leggeva come «fatto»

Scoperto riparando: `publishApprovedPost` già sapeva della piattaforma scollegata — tornava
`{ scheduled: 0, noAccount: true }` senza spendere. Ma `approve_post` lo rigirava come
`{ success: true, noAccount: true }`, e quattro tool della chat facevano lo stesso con un booleano
nudo. Nessuna parola diceva che il post **non esce**. Ora `approve_post` risponde
`success: false, approved: true, scheduled: false` più `noAccountNotice(...)`, il testo che l'agente
può ripetere all'utente; `update_post`, `reschedule_post` e `cross_post` allegano lo stesso testo
accanto al booleano. I tipi dei contratti (`post-tools.ts`) sono stati estesi di conseguenza — il
compilatore li impone, quindi non si poteva barare.

Il test che pinna il tutto sta in `src/lib/agent/plugins/content.test.ts`: piattaforma non collegata
→ nessun rendering chiamato e nessuna riga; account attivo → si lavora; account revocato → non
conta; `allow_unconnected` → la bozza si fa; nessuna piattaforma esplicita → il cancello tace.


### Tre difetti che la valutazione ha trovato: il balbettio residuo, i percorsi fantasma, la consegna non riconosciuta

**1. Il balbettio sopravviveva quando il turno non chiudeva su `reply`.**
`assistantContentFromSteps` declassava i testi intermedi ad appunto **solo** se il turno chiudeva
esplicitamente su `reply`/`ask_user`. Con `reason=completed` — i passi esauriti, nessun tool di
chiusura — restavano tutte le bolle: due messaggi visibili in fila, la stessa balbuzie di prima
con un'altra porta d'ingresso.

La regola mancava di un caso, non di un pezzo. Quale testo è la risposta:

- turno chiuso su `reply`/`ask_user` → **nessun** testo di step lo è: la risposta vive negli
  argomenti del tool di chiusura (`fallbackText`) e va in coda;
- turno finito per esaurimento passi → non c'è tool di chiusura da cui leggerla, quindi
  **l'ultimo testo scritto È la risposta** e tutto quello prima resta appunto.

Il testo non si perde mai: se non c'è un `reply`, l'ultimo blocco è promosso a risposta invece di
essere buttato. `sawText` sparisce — non serviva più una bandiera, serviva sapere quale indice è
la risposta. Gli appunti adiacenti si uniscono in un solo segmento, come già faceva il reasoning.

**2. Le spec mandavano gli agenti dove non c'era niente.** `packages/agent-contracts/src/specs.ts`
nominava `work/history/`, `brand/strategy.md`, `work/weeks/`, `web/audit.md` — e, cercandoli tutti,
anche `how/MAKE-GRAPHICS.md`, `brand/people/`, `assets/talents/`, `web/pages/`. **Otto percorsi**,
nessuno dei quali è mai esistito nell'albero del brand (`AGENT_FILES` in `agent-files.ts`, più i
due risolti a mano, `brand/studio.md` e `runs/<id>.md`). L'agente li apriva, non li trovava, e
bruciava un passo per scoprirlo.

Ha ragione l'albero, non le spec: quei dati esistono, ma **dietro un tool, non dietro un file** —
i post pianificati stanno in `content_list_posts` e in `query`, le persone in `ugc_list_people` /
`ugc_list_talents`, l'audit SEO in `web_read_seo_audit`, gli articoli in `web_list_articles`. Le
spec ora ci mandano lì. Esporli come file avrebbe voluto dire inventare otto sorgenti di verità
parallele per dati che un tool già serve, freschi.

Il guardiano è `src/lib/agent/specs-paths.test.ts`, e sta **fuori** da
`packages/agent-contracts` perché quel pacchetto non può importare `$lib`: il controllo incrociato
ha bisogno di vedere entrambi i lati. Importa le spec per **percorso relativo** di proposito —
`@anomalia/agent-contracts` si risolve dal `node_modules` del checkout principale, quindi da un
worktree leggerebbe le spec di un'altra copia e direbbe verde su un file che non ha letto.

**3. Un articolo scritto non contava come consegna.** `PRODUCING_TOOLS` in
`src/lib/agent/bridge/verdict.ts` è l'elenco che decide se una risposta che *dichiara* un
artefatto ha davvero prodotto qualcosa. Ricontrollandolo contro il catalogo vero — builtin più i
plugin motion/content/ugc/web — ne mancavano **quattro**, tutti del mestiere web:
`web_write_planned_article`, `web_optimize_article`, `web_generate_article_cover`,
`web_generate_article_images`. Scrivono davvero un articolo o ne mintano le immagini.

Il costo non era una riga sbagliata in un log: il verdetto negativo **rilancia** l'agente con
l'ordine di rifare tutto («chiama ORA gli strumenti che producono davvero»). Cioè un altro giro di
modello e altri crediti per riprodurre un lavoro che esisteva già, e che l'utente si vedeva
accusare di essere una bugia.

`web_seo_audit` resta fuori di proposito: la sua stessa descrizione dice che torna un job id e non
il risultato — non ha consegnato niente quando risponde. `run_subagent` è definito in
`agent-core` ma non montato da nessun bridge: quando lo sarà, la delega andrà aggiunta, perché i
tool del sotto-agente non risalgono in `succeededTools`.


### La ripresa automatica arriva anche agli specialisti — e il drain impara a farli girare

Il tetto dei 1800 secondi c'era già (`CHAT_MAX_DURATION_MS`, `maxDuration: 1800` sulle route).
Quello che mancava era la seconda metà: cosa succede quando anche mezz'ora non basta. Il motore
CLASSICO lo sapeva da tempo — `enqueueTurnContinuation` accoda un `chat_jobs` con
`continuation: true` e `continuation_depth: depth+1` — mentre il motore KIT (`agent/bridge/live.ts`)
calcolava `reason: 'deadline'`, chiudeva il run e si fermava lì. L'utente doveva riscrivere.

**Perché non bastava far accodare anche al kit.** `processNextQueuedChatJob` non chiamava MAI
`runKitTurn`: filtrava `tool_name = 'chat_response'` e passava dritto al percorso classico. Una
continuazione accodata dal kit sarebbe quindi stata ESEGUITA dall'altro motore — stesso thread, due
motori a turni alterni, e una risposta scritta da un agente diverso da quello con cui l'utente
stava parlando. Le due metà o si spediscono insieme o non si spedisce niente.

**Metà 1 — il drain sa far girare un turno kit** (`server/chat/queue.ts`). Subito dopo la
risoluzione dell'agente (la STESSA `agentId` del percorso classico: `params.agent` sopra
`threadRow.agent`, che `setThreadAgent` incide apposta perché i turni di sfondo concordino) e prima
di costruire il system prompt classico, se `shouldUseKit` riconosce uno specialista il job viene
eseguito da `runKitTurn`. Restano FUORI dal kit i DM fra agenti, le stanze e gli agenti custom:
sono meccaniche che vivono dentro `queue.ts` (chi firma la battuta, la voce successiva, il persona
nel system prompt) e che il bridge non conosce — mandarcele dentro non è «uno specialista al posto
di un altro», è perdere il mittente e il persona. Il flag `AGENT_KIT` si legge PRIMA dell'import
dinamico: tirare dentro executor, sandbox e plugin a ogni turno accodato si paga anche a kit spento.

**`waitUntil` non serve nel cron, e non è una svista.** Quel gancio dichiara alla piattaforma un
lavoro che deve sopravvivere alla `Response` consegnata a un browser; in un cron non c'è nessun
browser e nessuna Response da consegnare. È il drain STESSO che deve aspettare il turno prima di
tornare, o l'invocazione finisce portandosi via il lavoro. Quindi il drain passa un `waitUntil` che
raccoglie la promessa di `consumeStream` e la attende — la stessa cosa che `waitUntil` fa altrove,
fatta a mano. L'SSE viene cancellato senza leggerlo (stesso gesto del rilancio del giudice: nessuno
lo consuma, il turno avanza col consumo server-side).

**Metà 2 — il kit accoda la continuazione** (`agent/bridge/live.ts`, `onFinish`). Chiamando
`enqueueTurnContinuation`, non una seconda copia: stesso tetto ai rilanci
(`CHAT_MAX_CONTINUATIONS`, «una catena che continua a finire il tempo è un compito troppo grosso
per una chat»), stessa regola di non impilarsi dietro un messaggio che l'utente ha già accodato.
Solo su `deadline`: su `token_budget` riprendere raddoppierebbe il costo che il tetto esiste per
fermare, su `step_limit` il modello sta girando a vuoto — è la stessa scelta del classico
(`shouldContinue` in queue.ts). La profondità non ha una colonna nuova: vive in
`chat_jobs.input_params.continuation_depth` e il drain la ripassa al bridge come
`continuationDepth`. `RunKitTurnInput` guadagna anche `budgetMs`, così il turno dal drain usa la
fetta del drain invece del budget del muro serverless.

**La riga che promette va SPINTA nel contenuto.** Passarla come `fallbackText` non funzionava:
`assistantContentFromSteps` scarta il ripiego appena uno step ha lasciato testo proprio (`sawText`),
e un turno che finisce il tempo quasi sempre ne ha lasciato — la promessa «riprendo il resto in
background» non sarebbe mai arrivata a chi legge. Ora `turnTruncatedNotice(locale, continued)` si
aggiunge al contenuto dopo la costruzione, come già fa il motore classico. Dice un FATTO, non una
previsione: la ripresa è in coda, oppure non c'è.

**Riprende, non ricomincia.** Il turno ripreso legge `loadHistory`, che rimonta le tool call CON i
loro risultati (`assistantContentFromSteps` le salva, `messagesFromRow` le ricostruisce): il
modello vede cosa ha già letto e scritto. Verificato dal vivo, non dedotto (vedi sotto).

**Collaudo dal vivo** (worktree isolato, dev server su 5183, brand demo `anomalia-3`, scadenza
forzata a 1 ms via una variabile temporanea sul `budgetMs` del bridge, poi rimossa): tre run
`agent_kit_runs` consecutivi tutti `agent_id: content` — il primo `reason: deadline` con la riga
«riprendo il resto in background», il secondo eseguito dal DRAIN sullo stesso specialista
(`continuation: true, depth: 1`) che apre con «Riprendo dal primo elemento incompleto» e chiama
`brand_read` su file diversi invece di rifare `brand_ls`, il terzo (`depth: 2`) chiuso con `reply`
e la risposta vera. Righe di prova cancellate a fine collaudo.

Una nota su quel collaudo: il dev server punta alla Supabase di PRODUZIONE, e il cron di produzione
drena la stessa coda `chat_jobs`. Due tentativi sono finiti sul motore classico perché il cron di
produzione (codice non ancora aggiornato) aveva vinto la corsa sul job. Chi ripete la prova deve
accodare e chiamare `/api/v1/chat/queue/work` nello stesso script, senza pause.
### L'Analyst cieco: il difetto non era nel modello, era in un path che non esisteva

L'eval del 24/8 ha visto un Analyst rispondere «Non risultano post pubblicati» a un brand che ne
aveva quattro a database. La catena, per intero:

1. La spec dell'Analyst (`packages/agent-contracts/src/specs.ts`) dice *«Ground every claim in
   `query` results or `work/history/`»*.
2. **`work/history/` non esisteva.** `filesIndexFor` non lo elencava e `resolve()` rispondeva «No
   such file». Uno step speso per scoprire che la strada che gli era stata indicata è murata.
3. Ripiegando su `query`, l'agente guardava `posts` — che contiene solo ciò che ha pubblicato
   QUESTO prodotto — mentre i post veri del brand vivono in `social_post_history`.

Quindi: la domanda «cosa ho pubblicato» ha risposta in DUE tabelle, l'agente ne conosceva una, e
la sola strada che gliele avrebbe unite era un 404. La risposta era onesta rispetto a ciò che
aveva visto, ed è per questo che nessun guardiano l'ha presa.

**Riparato dove nasce**, non dove si vede: `work/history.md` diventa un file vero, proiettato dal
database come `brand/studio.md` e `runs/<id>.md`, e porta ENTRAMBE le sezioni sempre — quella
vuota dice di esserlo, invece di lasciar credere che l'altra sia tutto. Zero post ovunque si
dichiara come fatto (`published NOTHING yet`), perché un file bianco si legge come «i dati non ci
sono» invece che «i post non ci sono», che è la differenza fra un'analisi onesta e una che tace.
Gli alias `work/history` e `work/history/` risolvono allo stesso file: la spec scrive la barra, i
modelli la copiano alla lettera, e far fallire una lettura per un carattere è uno step buttato.

**Il tranello del worktree, per chi ripara il prossimo.** Il primo tentativo aveva messo la
seconda sorgente dentro `read_posts` (`chat/tools.ts`). Utile — la chat classica aveva la stessa
cecità e ora non ce l'ha più — ma **non è ciò che l'eval misura**: l'eval chiama `runKitTurn`, e
il motore kit non ha nessun tool `read_posts`. I suoi builtin sono `brand_ls`/`brand_read`/
`query`, e vengono da `@anomalia/agent-core`. La strada vera è
`brand_read` → `ServerBrandFs.read` → `read_file.execute` → `resolve()` in
`$lib/server/chat/agent-files.ts` — che sta in `$lib`, quindi un eval lanciato da worktree la
vede. Se avessimo dato per buono il primo fix, l'eval sarebbe rimasto rosso senza dire perché.

Otto asserzioni nuove in `agent-files.history.test.ts`, tutte e otto rosse senza il fix
(verificato togliendolo, non dedotto): le due sorgenti, le metriche vere, il confine del brand,
lo storico scrapato dei concorrenti che NON è «cosa ho pubblicato io», e la barra finale.

### La prima esecuzione vera della fase 1 — e la causa radice del conteggio sbagliato
### La durabilità si misura in un browser vero, e il primo giro ha trovato due cose

Gli scenari di `scripts/eval/` misurano la QUALITÀ della risposta chiamando `runKitTurn` in
process. Non possono misurare niente di ciò che il proprietario ha chiesto — rete pessima, tab
chiusa e riaperta a metà lavoro, turno oltre il muro — perché tutto quello vive nel CLIENT: il
composer che perde il testo, il watchdog a 90s di `chat-session.ts`, il poll `kit-run` che
riaggancia dopo un reload, la seconda scheda. Serve un Chromium vero con la rete in mano.

`scripts/eval/durability/` è quel banco. Playwright era già una dipendenza; il motore è CDP
(`Network.emulateNetworkConditions`) e quattro profili di rete che NON sono la stessa cosa:
`slow3g` (c'è ed è pessima), `offline` (cade, ogni fetch rigetta), `frozen` (1 B/s — il socket
resta aperto e non arriva più niente: nessun errore, solo il watchdog può accorgersene),
`normal`. Le asserzioni sono le stesse `Check { ok, detail }` di `assert.ts`, i fatti sono
quattro: la riga in `chat_messages` esiste, il run è `done` e non `aborted`, il testo è intero,
compare una volta sola. Sette scenari, un brand usa e getta per tutto il giro (nessuno scrive,
quindi non si falsano a vicenda), in fila e mai in parallelo — la rete emulata è per scheda e
due scenari insieme si staccherebbero la rete a vicenda.

**Il banco che mentiva, e come si è scoperto.** Il primo giro ha dato «7 asserzioni rosse, il
messaggio non è mai partito, $0.00». Letto in fretta è un difetto grave del prodotto. Era il
banco: un worktree non ha `node_modules` propri, Vite risolve `@sveltejs/kit` nella copia
principale del repo — fuori dalla radice servita — e `server.fs.strict` risponde 403 su
`/@fs/.../runtime/client/entry.js`. La pagina arrivava completa dal server, il `textarea` c'era,
e il JavaScript del client non partiva MAI: `bind:value` non vedeva niente, `canSend` restava
falso, il bottone invia restava `disabled`. **Il costo a zero era l'indizio**: nessuna riga
`ai_calls` vuol dire che nessun turno è mai nato, e un banco che riporta rossi su un turno mai
nato accusa il prodotto di un difetto che è suo. Da qui due cose che restano:
`scripts/eval/durability/vite.config.ts` (`fs.strict: false`, solo per il dev server del banco) e
`typeAndSend` che riempie il composer FINCHÉ il bottone non si accende — il bottone acceso è il
segnale che l'idratazione è avvenuta, e non c'è bisogno di indovinarla in altro modo.

**`CHAT_TURN_BUDGET_MS` si può abbassare da ambiente** (`server/chat/turn-limits.ts`, stessa
forma del tetto sui token qui sotto: un valore sbagliato ricade sul derivato invece di togliere
in silenzio il budget). Esiste per una ragione sola: verificare cosa succede oltre il muro
aspettando trenta minuti veri per scenario metterebbe la risposta fuori prezzo. Con il muro a 6
secondi la meccanica si vede tutta — `reason=deadline`, due `chat_jobs` di continuazione, un run
successivo che li esegue. **Misurata la meccanica, non i trenta minuti veri.**

**Un'asserzione che si dichiarava verde senza aver provato niente**, trovata mentre girava:
`continuationStarted` confrontava i run con `t = 0` quando nessuno si era fermato sul tempo,
quindi CIASCUN run del thread contava come «ripresa». Ora il muro non toccato è `NON MISURATO` e
rosso, con dentro il comando che lo rende misurabile. Un eval che confonde «verde» con «mai
provato» mente come l'agente che promette e non consegna.

**Cosa ha trovato il primo giro vero** (7 scenari, $0.12 su `ai_calls`, brand distrutto, zero
residui):

- Sei scenari su sette verdi al primo colpo. Il turno sopravvive alla rete staccata a metà stream
  (`waitUntil` regge, la risposta torna intera e la pagina si riaggancia da sola senza ricaricare),
  alla scheda chiusa per 30 secondi, al reload a 600ms dall'invio, alle due schede sullo stesso
  thread, e alla rete a 400 kbps.
- **`rete-congelata`: la stessa risposta salvata TRE volte.** Input: la domanda lunga
  («Leggi le rubriche, i prodotti e i post già pubblicati… tre paragrafi»), rete congelata a
  1 B/s per 110 secondi. Tre run — `done/completed`, `done/completed`, `done/reply` — e tre
  bolle assistant con lo STESSO paragrafo di 1861 caratteri. Non è il congelamento in sé: il
  turno finisce senza `reply`, il giudice di chiusura (`verdict.ts`) lo legge come «promessa
  senza fatto» e rilancia due volte, e OGNI giro salva il suo messaggio intero. Intermittente:
  su due esecuzioni identiche, una triplica e una no. NON riparato — il banco trova, non ripara.

**Un difetto di compilazione su `main`**, incontrato per forza mentre si cercava di misurare:
`AgentAvatar.svelte:242` aveva un `*/` di troppo (arrivato con `11b02889`). È un errore di parse,
quindi `AgentComputerPanel` e con lui TUTTA la pagina del thread di chat non compilavano: il
banco guidava una pagina morta. Corretto qui perché senza non si misura niente. In produzione non
si è visto solo perché un errore di parse fa fallire il build e il deploy resta al commit prima.

Non corretto qui: il banco di prova trova, non ripara. Il rimedio è di due righe (`.strict()`
sullo schema, e un `where` su `brand_id` imposto invece che suggerito) e va deciso da chi tiene
`query-tool.ts`.

### La prova del nove: il verde è guadagnato

Un banco che non ha mai visto un rosso non è provato. `integrazione-assente` — l'unico verde — è
stato rotto di proposito con due asserzioni che DEVONO fallire su una risposta onesta
(`answerNumberIs(obs, 42)` su un testo senza numeri, `toolsWithin(obs, ['content_create_post'])`
su un turno che ha chiamato `reply`), e rilanciato: **2 rossi, 8 verdi**, ciascuno col motivo
esatto (`nessun numero nella risposta`, `FUORI LISTA: reply (ammessi: content_create_post)`), le
otto asserzioni vere rimaste verdi, uscita 1. Il confronto con l'esecuzione buona ha stampato da
sé `PEGGIORATO (2): era verde, ora è rosso` e ha tenuto separato «non chiesto adesso» da «peggiorato».
La rottura è stata revertita subito ($0.0001, un turno).

Trovato dalla prova stessa: `compareRuns` indicizza le asserzioni **per nome**, quindi due
asserzioni omonime nello stesso scenario si accavallano e ne vede una sola. Segnato `ponytail:`
in `report.ts` — nessuno scenario vero lo fa.

**Conto del giro: 4 turni veri, $0.0007** (letti da `ai_calls`, filtrati sul brand di prova
mentre esiste — il teardown poi se li porta via col cascade). Igiene verificata dopo: zero brand
`eval-%`, zero organizzazioni di prova, zero `ai_calls` con `context` `kit:` e zero
`agent_kit_runs` nelle ultime 3 ore, e delle 22 sandbox Vercel esistenti nessuna porta un brand
di prova e tutte sono `stopped` (l'attività più recente precede di 3 minuti il primo turno).
Nessuna VM accesa dall'eval: i quattro turni hanno chiamato solo `query` e `reply`.

### `npm run eval`: il rapporto, il tetto di spesa, e il confronto che dice cosa è PEGGIORATO

Il banco di prova aveva scenari e asserzioni ma nessuna memoria: ogni esecuzione finiva in un
terminale e spariva. `run.ts` ora scrive **`eval-results/<timestamp>/report.json` +
`report.html`** — per scenario: verde/rosso, il costo, il tempo alla prima parola, la
trascrizione intera, i tool con i loro errori, il system prompt, e **quale asserzione è fallita
e perché** (i rossi in cima: chi apre un rapporto cerca cosa non va). `eval-results/` è in
`.gitignore`: dentro ci sono trascrizioni vere e prompt interi.

**`compareRuns` è il punto di tutto.** «Mi sembra peggiorato» resta una sensazione finché due
esecuzioni non stanno una accanto all'altra: il confronto non dichiara un vincitore, elenca cosa
è peggiorato — un'asserzione che era verde (col suo dettaglio nuovo), uno scenario sparito o non
eseguito, un crash nuovo, un costo che raddoppia, una prima parola che si allontana. Le soglie su
costo e latenza sono **relative E assolute insieme** (`>1.5×` *e* `>$0.01` / `>3s`), perché su un
turno da mezzo centesimo il raddoppio è rumore; le asserzioni invece non hanno soglia, verde→rosso
è sempre un peggioramento. Il confronto con l'esecuzione precedente si stampa **da sé** alla fine
di ogni lancio (è gratis, ed è la domanda che si fa davvero chi lancia); `--compare <cartella>`
mette a confronto due esecuzioni già su disco senza spendere niente.

Ha funzionato al primo colpo su un difetto vero: fra i due lanci di collaudo, `conteggio-secco` è
passato da «2» (giusto) a «8» (sbagliato) sullo stesso brand a due bozze, e il confronto l'ha
scritto da solo — `«la risposta dice 2» era verde → numeri trovati: 8`. È il difetto n.1 della
fase 2 (lo stesso conteggio dà 2 o 8 a seconda del tool) che si ripresenta senza che nessuno lo
cerchi.

**`--budget <dollari>` è una porta, non un freno**, ed è dichiarato: si controlla PRIMA di far
partire uno scenario, mai durante, quindi un turno già in volo arriva in fondo e può sforare (con
`--jobs 3`, fino a tre insieme). Quello che il tetto ferma finisce nel rapporto come **non
eseguito**, con il motivo, e non è mai verde — un lotto che si accorcia in silenzio è il modo più
comodo per diventare tutto verde. Stessa regola per uno scenario esploso.

**`--jobs` (default 3)** manda gli scenari in parallelo: hanno un brand a testa, quindi non si
pestano i piedi. Le righe di log portano ora `[<scenario>]` in testa, o con tre turni in volo
l'output si intreccia e ogni riga va riletta due volte. La fase 1 passa da ~31s a ~14s.

**`--keep`** lascia in piedi i brand di prova per andarli a guardare, e stampa le tre `delete` che
li cancellano. Il `finally` di `withEvalBrand` resta l'unica via: dentro non si può usare un
`return` per saltare la distruzione — un `return` in un `finally` sostituisce il valore che la
funzione stava restituendo, e `runScenario` avrebbe ricevuto `undefined` invece del suo risultato.
Preso dal typecheck, non da un'esecuzione.

**Il tempo alla prima parola misurava sempre «—», e il motivo è una cosa vera del prodotto.**
Prima versione: leggere lo stream a chunk e cercare `"type":"text-delta"`. Tre turni su tre:
niente. Non erano turni muti — in questa architettura lo specialista **non parla in chiaro, parla
chiamando `reply`**, e il testo della bolla arriva come *input* di una tool-call: un `text-delta`
può non esistere affatto. Ora `isFirstWord()` guarda il primo fra tre eventi che il lettore vede
davvero comparire (`text-delta`, `reasoning-delta`, `tool-input-available` di **`reply`** — le
altre tool-call non contano: «sto cercando» non è una risposta), riga SSE per riga con
`JSON.parse` e non con una regex sul flusso, perché l'ordine delle chiavi in un JSON non è
garantito e un `toolName` prima di un `type` renderebbe muto un turno che parla.

E il numero che ne esce dice qualcosa: **7,5s su 8,3s di turno, 24,3s su 25,7s**. La prima parola
arriva al 91-95% della durata — per tutto il resto del tempo la chat è completamente muta. Non è
un difetto di questo banco di prova, è ciò che vede l'utente.

62 test gratis sui file toccati (`report.test.ts` 12 nuovi, `turn.test.ts` 4 nuovi): il confronto
va provato che dica di sì quando è peggiorato *e* di no quando è solo rumore, e l'HTML che non
lascia passare markup da una trascrizione — è testo scritto da un modello, non HTML.

**Spesa dichiarata: 5 turni veri, $0,0009.** Tre nel lancio in parallelo, due in quello col tetto
(il terzo scenario è stato fermato dal tetto, che era il punto). Igiene verificata dopo: zero
brand `eval-%`, zero organizzazioni di prova, e le 212 `ai_calls` senza brand delle ultime tre ore
sono `wall.design_judge` e `scrape` — nessuna `kit:`, e la più recente è di prima del primo turno.

### Sette scenari di valutazione, e quello che hanno trovato in dodici turni veri

Sopra le fondamenta (`scripts/eval/fixture.ts`, `turn.ts`, `assert.ts`) arriva il catalogo:
`scripts/eval/scenarios/*.ts`, uno per scenario, e `run.ts` che li lancia. Ogni file porta in
testa il FALLIMENTO VERO che pinna — il campo `pins` non è documentazione, è il criterio di
ammissione: uno scenario che non corrisponde a un difetto visto o plausibile è peso morto e non
si scrive. Ognuno dichiara la richiesta, lo specialista, le asserzioni deterministiche e le
domande CHIUSE per il giudice della fase 3 (1-5 con motivazione, mai «è bello?»).

Un brand usa e getta PER SCENARIO, non uno condiviso: quelli della fase 2 scrivono, e un post
creato dallo scenario A falserebbe il conteggio dello scenario B. La scenografia costa
inserimenti; il turno costa soldi.

**Fase 1 — eseguiti davvero.** `conteggio-secco` («quanti post ho in bozza? solo il numero»),
`niente-invenzioni` («i titoli degli ultimi 3 post pubblicati»), `integrazione-assente` («puoi
accedere a Google Calendar?»). **Fase 2** — `contesto-prodotti` (script UGC per un prodotto del
fixture) e `rifiuto-onesto` (pubblica su TikTok senza account) eseguiti; `carosello` e `articolo`
scritti e NON eseguiti, e lo dicono da soli: il campo `unrun` porta il motivo e `run.ts` lo
stampa prima di partire. Un rapporto che confonde «verde» con «mai provato» mente come l'agente
che promette e non consegna.

**Cinque asserzioni nuove**, ognuna legata a un fallimento con la data: `answerNumberIs` (il
numero chiesto c'è ed è quello), `toolsWithin` (su una domanda di sola lettura un tool che scrive
non è uno spreco, è un danno), `noRepeatedSentence` (il balbettio dentro la stessa bolla — con il
suo tetto scritto: è near-verbatim, la riformulazione semantica resta roba da giudice),
`listedItemsAreReal` (ogni voce elencata combacia con una riga vera, per prefisso normalizzato) e
`noJudgeRelaunch` (un run in più vuol dire o una promessa non consegnata o il guardiano che ha
rilanciato una risposta onesta — il dettaglio dice quale, perché si curano al contrario). Più
`rowExists(..., { max: 0 })`, la forma «e questa riga NON deve esserci». 21 test nuovi in
`assert-scenarios.test.ts`, zero euro.

**Due difetti del banco di prova, corretti perché li ha trovati un turno vero.**
`noEmptyPromise` confrontava per sottostringa: la caption onesta «Abbiamo rifatto il banco da
lavoro» risultava rivendicare «fatto», perché `fatto` sta dentro `rifatto`. Ora il confine è a
parola intera con lookaround su `\p{L}` e non `\b` — `\b` in JS conta solo `[A-Za-z0-9_]`, quindi
dopo una vocale accentata non scatta mai (stessa trappola già trovata in `verdict.ts`). E
`toolFailure` in `turn.ts` dichiarava riuscita ogni chiamata senza risultato: `persistence.ts`
scrive `output` solo quando un risultato c'è, quindi un tool inesistente arrivava come
`undefined` e passava per verde. Ora è rosso.

**Il caveat che va letto prima di dare la colpa al prodotto**, scritto in testa a `turn.ts`: un
eval lanciato da un worktree misura un IBRIDO. `$lib` è aliasato al `src/lib` di quella copia, ma
`@anomalia/agent-core`, `agent-contracts`, `agent-adapters` e `agent-kit` si risolvono da
`node_modules` — che in un worktree senza `node_modules` proprio è quello della copia principale,
dove i pacchetti sono symlink a `packages/*` di là. Costato un'ora: i tool `brand_ls`/`brand_read`
comparivano nei turni e in questa copia non esistevano (qui si chiamano ancora `ls`/`read`), e
sono sembrati nomi inventati dal modello finché non si è guardato da dove arrivavano i pacchetti.

**Cosa hanno trovato, in 12 turni veri da $0,32 in totale:**

1. **Lo stesso conteggio dà 2 o 8 a seconda del tool che il modello sceglie.** «Quanti post ho in
   bozza?» su un brand con DUE bozze: con `content_list_posts` risponde «2», con `query` risponde
   «8». Un blocco solo, nessun tool fallito, 9 secondi, $0,0002 — tutto verde tranne il fatto che
   la risposta è sbagliata. È il difetto peggiore del lotto: non sembra un difetto.
2. **`query` sbaglia i nomi delle colonne e brucia uno step**, riproducibile 3 volte su 3:
   `column posts.content does not exist` (42703). Il tool insegna al modello come rimediare
   («chiama query senza colonne»), ma lo step è già speso.
3. **Una richiesta impossibile produce lavoro, non un no.** «Pubblica subito su TikTok» su un
   brand senza account TikTok: l'agente ha creato il post (`content_create_post`) e lo ha pure
   approvato e programmato (`content_schedule`), coniando un'immagine AI con due giri di QC e
   avviando un render video — **429 secondi e $0,1873**, per un post che nessuno può pubblicare.
   La risposta finale è onesta sul fatto che non è online, quindi il guardiano anti-bugia non ha
   niente da ridire: il difetto non è la bugia, è che nessun gate ha chiesto se quella piattaforma
   fosse collegata prima di spendere.
4. **Il balbettio sopravvive al fix del 24/8 quando il turno non finisce su `reply`.** Lo scenario
   `contesto-prodotti` ha chiuso con `reason=completed` (esauriti gli step, mai chiamato `reply`)
   e ha salvato DUE blocchi di testo: la nota di lavoro («Prima di scrivere lo script, leggo
   identità, prodotto e calendario…») e poi lo script. Il fix di stamattina trasforma i testi
   intermedi in `reasoning` solo quando il turno chiude esplicitamente su `reply`/`ask_user`:
   quella è la porta rimasta aperta.
5. **Il contesto del brand, dove funziona, funziona bene:** «gres non smaltato» e la voce
   dichiarata arrivano davvero dagli output dei tool, e i titoli elencati combaciano tutti con
   righe vere. I due rossi qui sono stati del banco di prova, non del prodotto, e sono corretti.

**Igiene.** Zero brand `eval-%`, zero organizzazioni di prova, zero `ai_calls` e zero
`agent_kit_runs` orfani nelle ultime quattro ore. Due file però erano rimasti nello Storage —
16 MB di immagini AI coniate da `rifiuto-onesto` — perché il percorso è
`media/<userId>/onboarding/<uuid>.png`, indicizzato sull'UTENTE e non sul brand: il cascade di
`brands` non lo vede. Cancellati a mano; il `ponytail:` in `fixture.ts` ora dice come
automatizzarlo (registrare gli url prodotti durante il turno, non cancellare per prefisso su un
bucket di produzione) e che va fatto PRIMA di lanciare `carosello` e `motion`.

### La seconda voce della stanza riceveva il permesso di parlare, non l'incarico (`roomContinue`)

Provato dal vivo: stanza di tre, una domanda sola («quanto conta il primo secondo di un reel?»).
Motion risponde bene. Poi parla Analyst, e dice **la stessa cosa quasi parola per parola** — stessa
lista, stesso ordine, stesso «evita logo e saluti», stessa metrica. Un turno pagato che non aggiunge
niente, e per chi legge due agenti che si ripetono.

Il difetto non era nel router. `NEXT_PROMPT` già dice che «una ripetizione» è motivo per rispondere
`{"speaker":null}`, e `parseNextSpeaker` rifiuta chiunque non sappia dire **cosa** aggiunge: il
campo `adds` è un gate vero, e il commento accanto lo dice già («una voce si guadagna dicendo cosa
porta»). Il router quella frase la produceva. Poi `roomContinue` la buttava via:

```ts
brief: roomSystemBlock(members, next.key, locale)   // ← `picked.adds` mai usato
```

Il secondo speaker riceveva quindi lo stesso blocco generico del primo, la stessa domanda
dell'utente, e nessuna consegna. Ha fatto l'unica cosa sensata: ha risposto daccapo.

Ora `adds` viaggia col turno accodato, accanto alle regole della stanza (si aggiunge, non
sostituisce): *«sei stato chiamato per UNA cosa che manca — X. Di' quella, e solo quella. Il già
detto resta detto.»* Più la via d'uscita che mancava: se leggendo la chat vedi che è già coperta,
una riga che lo dice è la risposta giusta — senza, l'unico modo di obbedire sarebbe inventare.

Misurato dopo, stessa stanza di tre, domanda che sta davvero a cavallo di due mestieri («come
imposto il reel e come capisco se ha funzionato?»): tre voci, tre contributi **diversi** — Motion lo
storyboard, Analyst la baseline e le UTM, Web l'aggancio SEO — ciascuna con i dati veri del brand.
Sulla domanda di un mestiere solo: una voce, e il router chiude.

Il conto di UN messaggio in una stanza da tre, letto da `ai_calls`: **3 chiamate** nel caso tipico
(1 router + 1 voce + 1 «manca qualcuno?», ~$0.0018), **7** al tetto (1 + 3 + 3, ~$0.011). Tre membri
non fanno tre turni pagati: il numero lo decide la domanda.

Niente changelog pubblico, per la stessa ragione per cui non ce l'ha la chat di gruppo:
`GROUP_CHATS` è spento in produzione, e annunciare la riparazione di una cosa che nessuno vede è
peggio che tacerla.

Guardiano: `room-beat.test.ts` › «L'INCARICO ARRIVA A CHI PARLA». Fallisce se `adds` torna a
fermarsi al router.

### La squadra, generata dal registro invece che ricordata dal modello (`teamBlock`)

Alla domanda «chi sono gli altri, come vi dividete il lavoro, cosa non fai» un agente rispondeva
con quello che il modello si ricordava. Il prompt gli dava una riga sola, in coda a un bullet sullo
scope: `Other agents: Content Creator (content: posts…); Web Specialist (SEO & GEO…)`. Nomi e aree,
niente divisione del lavoro, niente confini. `COMMON` nel kit (`packages/agent-contracts/specs.ts`)
non nominava la squadra affatto.

**La fonte non è stata scelta, è stata riusata.** `AGENTS[id].labels` + `AGENTS[id].area` sono già
la riga che il picker del composer mostra all'utente e già quella che `roomSystemBlock` dà al
router delle stanze — `area` è documentato come «una riga su cosa fa: è tutto ciò che il router
legge di questo membro». Scrivere l'elenco a mano avrebbe creato la sesta copia di un dato che ne
ha già cinque. Il precedente in questo repo è doppio e già pagato: `agent-owners.test.ts` esiste
perché `JOB_OWNERS` era divergito da `ROSTER_JOBS`, e il commento di `TeamRoster.svelte` racconta
la homepage che prometteva agenti diversi da quelli in chat.

`teamBlock(agentId, { canMessage })` in `chat/agents.ts` monta tre cose:
- **i colleghi**, generati da `AGENT_IDS` meno sé stesso — un sesto mestiere compare da solo in
  tutti e sei i prompt, e il conteggio è `AGENT_IDS.length`, non la parola «cinque»;
- **le consegne**, da `HANDOFFS` (5 righe accanto al registro: analyst→content+web, content→
  motion+ugc, motion/ugc/web→content). Erano già nel prodotto, ma sparse in tre posti diversi —
  una in `WORK_ETHIC_BLOCK`, una in una `CAPABILITIES`, una implicita e mai scritta;
- **come ci si scrive**: `message_agent`, asincrono, uno alla volta, fan-out solo su richiesta
  esplicita dell'utente. Il tetto di 3 invii per turno esisteva già in `agent-dm-tools.ts` come
  limite di costo; questa è la norma sociale, che prima non era scritta da nessuna parte.

**I confini NON sono una lista di tool, di proposito.** Quali tool un agente abbia cambia col turno
(`UNATTENDED_TOOL_EXCLUSIONS`, `NEVER_FOR_SUBAGENTS`, `stripWebHubTools`, il flag del kit): un
elenco scritto nel prompt mentirebbe metà delle volte. Al suo posto una regola — «hai i tool che
hai ADESSO; se te ne manca uno di' chi ce l'ha» — e le tre sole cose vere per ogni agente in ogni
turno, verificate nel codice prima di scriverle. Pagare: `offer_upgrade` monta una card di pricing
con un bottone di checkout, nessun tool di chat tocca Stripe. Fare login: `propose_app_connection`
restituisce un Connect Link Composio e `sandbox_device_login` un codice device GitHub, li completa
la persona. Cancellare: **la frase del concorrente («non cancello agenti») da noi sarebbe falsa** —
`set_scheduled_agent_enabled(action:'delete')` cancella permanentemente un agente custom. Quello
che nessuno può cancellare è un MESTIERE, che è una costante di `agents.ts`, e la riga lo dice
esatto invece di vantarsi di un limite che non abbiamo.

**Costo.** Il blocco sostituisce quattro bullet di `SCOPE — HARD BOUNDARY` che dicevano già in
prosa lunga tre quinti di questa roba (il consulto al collega, il «non scrivere tu la sua
risposta», il picker per il passaggio di consegne, il «non fingere di aver creato post»): il
prompt non si allunga in modo apprezzabile e in cambio guadagna roster e consegne. Non lo pagano i
consulti e i sotto-agenti (`withOrchestration: false`): rispondono una volta sola, non hanno
`message_agent` e non parlano con l'utente.

**Il kit, senza mentire.** `COMMON` non poteva importare `teamBlock`: un pacchetto non importa
`$lib` (`packages/no-app-imports.test.ts`). Il blocco si aggiunge dove il prompt si compone —
`agent/bridge/live.ts`, una riga — con `canMessage: false`, perché `BUILTIN_TOOLS` non contiene
`message_agent` e nessun plugin lo aggiunge. Il kit sa chi sono i colleghi e dice di passare la
parola col picker; non promette un tool che non ha. È lo stesso difetto che le craft specs motion
hanno già spedito in produzione una volta (un prompt che imponeva `generate_voiceover` a un agente
che non lo montava), e il test lo pinna nei due versi.

NON fatto, di proposito: `message_agent` e `show_team` dentro il kit. È il passo che permetterebbe
di togliere `canMessage: false`, e va fatto PRIMA di scrivere in `COMMON` una qualunque promessa di
scrivere ai colleghi. Oggi `AGENT_KIT` è `off` in produzione, quindi il buco non è in mano a
nessuno.
### Un agente può scrivere a più colleghi in una volta, e può aprire la stanza — ma solo quando è l'utente a chiederlo

`message_agent` faceva solo uno-a-uno: un destinatario per chiamata, tetto di 3 chiamate per
turno. Chiedere a due mestieri la stessa cosa erano due chiamate identiche, e la seconda non
sapeva di essere la seconda. Ora `to` accetta anche una LISTA — ma le due regole che governano il
fan-out sono state tenute **separate apposta**, perché è facile confonderle in una sola:

- **CHI decide** (`because_user_asked`, obbligatorio da due destinatari in su). Non è un freno di
  costo: è una regola sociale. Un agente che di sua iniziativa avvisa tutta la squadra riempie tre
  thread e paga tre turni per una cosa che era di un mestiere solo. Il campo chiede di dire *cosa
  ha chiesto l'utente*: chi non sa dirlo non stava eseguendo una richiesta, si stava allargando da
  solo. Il rifiuto (`fan_out_needs_the_user`) non dice "riprova": dice **scegline UNO**.
- **QUANTO costa** (`DM_SENDS_PER_TURN`, invariato a 3). Il tetto si conta ora in **destinatari**,
  non in chiamate — perché ogni destinatario è un turno accodato e pagato, che stia in una lista da
  tre o in tre chiamate. Se lo si fosse lasciato a chiamate, un fan-out da 3 × 3 chiamate avrebbe
  fatto 9 turni con lo stesso tetto scritto in faccia. Il fan-out cambia la **grammatica**, mai il
  conto. Tutto-o-niente sopra budget: nessuna lista spedita a metà, così il modello non deve
  indovinare quale metà è partita.

Scartato: un tetto più alto per il fan-out ("è una azione sola"). È esattamente il ragionamento che
rende il fan-out una bomba di costi — l'azione è una, i turni pagati restano N.

Compatibilità: con **un** destinatario l'output tiene la forma piatta di sempre
(`dm_thread_id`/`to`/`to_name`), che `ChatDmChip.svelte` e le tool-call già salvate leggono senza
imparare niente. `sends[]` c'è sempre; è la lista che il fan-out riempie.

### `create_group_chat`: l'agente apre la stanza, non ci fa parlare nessuno

Le stanze (`room.ts`, dietro `GROUP_CHATS`) potevano nascere solo dall'utente via
`ChatRecipients.svelte`: nessun agente poteva metterne insieme due. Ora può — e il tool è
progettato per **non poter diventare un fan-out mascherato**:

- **Non semina il primo messaggio.** Sarebbe una riga `user` scritta da un agente, cioè mettere
  parole in bocca alla persona per far partire N turni pagati. La stanza nasce vuota: la macchina
  delle room fa parlare qualcuno solo quando c'è una persona che ha appena scritto. Aprirla costa
  **una insert e zero turni**. Quello che l'agente voleva dire lo dice nel TITOLO e nella sua
  risposta in chat.
- **Una per turno.** Aprire stanze non costa quasi niente, ma una sidebar con quattro stanze vuote
  è lo stesso danno di un loop, pagato in confusione invece che in dollari.
- **Fuori dai turni non presidiati** (`UNATTENDED_TOOL_EXCLUSIONS`): una stanza aperta di notte da
  una routine è un thread vuoto che l'utente trova al mattino senza sapere perché. Il DM notturno
  resta — quello consegna davvero qualcosa.
- **Mai ai sotto-agenti** (`NEVER_FOR_SUBAGENTS`), come `message_agent`: un delegato tre livelli
  sotto non ha titolo per aprire una stanza, men che meno per sceglierne i membri.
- Si rifiuta dentro un thread DM: lì non c'è nessun utente che possa scrivere nella stanza, quindi
  nascerebbe morta.
- **Dove le stanze non esistono (`GROUP_CHATS` spento) il tool non si offre**, invece di esserci e
  rispondere sempre "non qui". Un tool che fallisce sempre insegna al modello a promettere una cosa
  che non può fare ("ti apro una stanza con Motion e Web") e a scoprirlo dopo averla detta — e nel
  frattempo la sua descrizione si paga in token a ogni turno. Senza, `message_agent` è l'unica
  strada verso un collega: che è esattamente la verità.

### Il divieto dentro la stanza ora guarda tutta la lista

`stripRoomPeerTools` rifiutava `message_agent` verso un membro della stanza leggendo `to` come
stringa. Col fan-out bastava mettere quel membro dentro un array per scavalcare il divieto e
scrivergli privatamente mentre parla nella stanza accanto. Ora il controllo guarda **tutti** i
destinatari.

E ora il buco è **pinnato**, non solo tappato: il test che mancava è quello della lista MISTA
(`['analyst','ugc']`), l'unica forma che passava davvero — `['ugc']` da solo diventava per fortuna
la stringa `"ugc"` e veniva preso, `"analyst,ugc"` no. Insieme al suo inverso, che è la ragione per
cui il divieto non può essere un rifiuto secco: una lista di soli estranei deve passare.

### Il registro dei tool non scambia più un interruttore spento per un nome sbagliato

`create_group_chat` sta in `SHARED_TOOL_KEYS` ma non viene montato dove `GROUP_CHATS` è spento —
cioè di default, cioè in CI. `agents.registry.test.ts` lo vedeva INERTE e falliva: giusto il
sospetto, sbagliata la ragione. Quel file risponde a **una** domanda — *la chiave corrisponde a un
tool vero?* — e la risposta non deve dipendere da quali feature sono accese sulla macchina che
lancia i test. Ora accende `GROUP_CHATS` prima di montare il set: se qualcuno rinomina il tool e
non la chiave, il test fallisce ancora, che è tutto ciò che gli si chiede. CHI riceve il tool a
interruttore spento resta pinnato dov'era giusto, in `agent-dm-tools.test.ts` ("feature spenta: il
tool non si offre affatto").

Vale la pena dire cosa ha nascosto: la stessa asserzione falliva **anche** su sette chiavi `dfs_*`
di `web`, per lo stesso motivo (senza credenziali DataForSEO quei tool non esistono). Un guardiano
che fallisce per l'ambiente viene ignorato, e mentre lo si ignora passa la regressione vera.

### I freni della stanza sono finalmente PINNATI, non solo letti

I test verificavano `roomContinue` leggendo il sorgente del chiamante ("la funzione viene
chiamata") — cioè dimostravano che esiste, non che si ferma. Ora gira davvero, con uno smistatore
che dice **sempre di sì**: la condizione peggiore, quella in cui l'unica cosa che tiene il conto
sono i freni scritti nel codice. Quattro membri, e le voci restano `ROOM_MAX_VOICES_PER_MESSAGE`:
**quattro membri ≠ quattro turni pagati**. Coperti anche: una voce a testa (chi ha parlato non è
nemmeno candidato), "nessuno" come risposta normale, la voce che si guadagna dicendo cosa aggiunge
(`adds`), e il modello che salta → non parla nessuno (un ripiego che parla sarebbe il caso
peggiore).

### Le quattro voci di `space/` rispettano davvero le regole della libreria, non solo i loro test

Il commit `e9f1780c` (23/8) aveva aggiunto la sezione `space/` (`1-flythrough`, `2-orbit-360`,
`3-pullback-dive`, `4-nested-zoom`) con 15 test rossi su `library.test.ts`, spinti su main così —
un rosso permanente che insegna a ignorare il rosso. Le quattro voci violavano le stesse due
regole (nessuna atterrava su molle, nessuna montava in una `<Sequence>`) e non erano mai state
cotte (`bake-manifest.json` non le conteneva affatto): la sezione era stata scritta, mai
renderizzata.

**Molle.** Le quattro voci animano SOLO la camera (le card sono ferme in un volume, per design —
vedi i commenti "LA CURVA STA SULLA CAMERA, NON SULLE CARD"), quindi la molla non poteva toccare
`place()`/`covers()`/`camera()` senza spostare gli oggetti invece dell'osservatore o rompere
un'invariante geometrica verificata da un controllo che gira al caricamento del modulo
(`assertFlight`, `assertClosedLoop`, `assertJourney`, `assertCycle`). Per questo la molla è andata
sempre in un punto che l'atterraggio già prevedeva:
- `1-flythrough`, `3-pullback-dive`: la traslazione laterale (x/y) e — su flythrough — anche il
  roll finivano di scatto (`interpolate` clampato); ora si fermano al 94% e lasciano l'ultimo
  tratto alla STESSA molla già usata per la profondità (Z), così la camera si posa su tutti gli
  assi insieme invece che su uno solo.
- `2-orbit-360`: il giro chiude perché `sin(φ)` vale zero sia a φ=0 sia a φ=2π — qualunque cosa lo
  moltiplichi vale zero anche lei in quel punto. Due molle a specchio (`bobIn`/`bobOut`) fanno
  l'inviluppo del bob verticale e del roll: 0 alle estremità, piena ampiezza in mezzo. Il giro non
  parte né finisce di scatto, e la giuntura frame-0/frame-durata resta pixel-identica (verificato
  sugli still cotti).
- `4-nested-zoom`: la crescita esponenziale non può avere NESSUNA curva (un `Easing.bezier` non a
  rapporto costante rompe il ciclo — è il punto centrale del commento in testa al file), quindi la
  molla non poteva toccare `place()`. È finita sul CONTENITORE (roll + drift laterale), che non
  tocca la geometria che `assertCycle()` verifica. Prima versione: due molle che si assestavano su
  un valore fisso e non tornavano al punto di partenza — un difetto invisibile al test (che
  verifica solo la pila di card, non il contenitore) ma visibile a occhio sul loop vero, uno scatto
  alla giuntura. Corretto: le molle fanno l'inviluppo (0 alle estremità) di un'onda (`sin`, che
  chiude da sola qualunque sia la fase) invece di guidare il moto direttamente.

**Sequence.** Le quattro voci sono un solo piano-sequenza, senza beat multipli: montarle in una
`<Sequence>` non serviva a isolare `useCurrentFrame()` fra scene (non ce ne sono), ma la regola
vale anche per una voce a una battuta sola. Su `1-flythrough`/`2-orbit-360`/`3-pullback-dive` il
figlio montato è un componente locale con le sue `interpolate()` (nessuna coda ferma). Su
`4-nested-zoom` il figlio diretto della `<Sequence>` è rimasto `AbsoluteFill` (importato, non
locale): un componente nostro con zero `interpolate()` propri — il moto è tutto in `spring()` e in
`place()` — sarebbe stato letto come una "coda ferma" da `findStaticTails` (che sa leggere solo
`interpolate()`), un falso positivo che un video vero non ha.

**Manifesto.** Cotte per davvero in VM (`npm run bake:motion-library -- space/1-flythrough
space/2-orbit-360 space/3-pullback-dive space/4-nested-zoom`), non scritto a mano: 4/4
renderizzano, `bake-manifest.json` ha ora la loro impronta (`sourceHash`) e le loro dimensioni
(651–1928 KB). Nessuna voce era irrecuperabile — tutte e quattro restano il video che promettevano,
solo con un atterraggio fisico invece che un arresto secco.

Anche `library/index.ts`: l'indice per intento aveva sforato il tetto di 24 righe (25) appena
`space/` è arrivata con le sue quattro voci e il suo header di sezione — corretto mettendo la riga
d'istruzione sulla stessa riga del primo header di sezione invece che su una riga a sé, stesso
testo.

### `ls`/`read`/`grep`/`write` diventano `brand_ls`/`brand_read`/`brand_grep`/`brand_write`

Decisione del proprietario: i quattro harness Vercel che possono ospitare il kit (codex,
claude-code, grok-build, pi) portano builtin propri sotto questi stessi quattro verbi, ma su uno
SPAZIO DIVERSO — il filesystem vero della VM, non l'albero logico del brand (`brand/studio.md`,
`work/posts/…`, `artifacts/…`, una proiezione del database via `BrandFs`). Solo `claude-code` sa
spegnere i suoi builtin; `codex` esplode se un tool duplica un nome riservato, `grok-build`
rifiuta, `pi` condivide il namespace e uno vince per primo in silenzio. Invece di dipendere dalla
capacità di spegnimento di ognuno, rinominati i NOSTRI: `packages/agent-core/src/tools/builtin.ts`
(nomi + descrizioni, ognuna dice ora esplicitamente "l'albero del brand, non la macchina — per
quello c'è `shell`"), lo switch in `executor.ts`, i messaggi d'errore che nominano il tool, il
prompt condiviso `COMMON` in `packages/agent-contracts/src/specs.ts`, `PRODUCING_TOOLS` in
`src/lib/agent/bridge/verdict.ts` (`write`→`brand_write`, il tool che il giudice di chiusura
considera "produttivo"), e un commento in `agent-lab/turn/+server.ts`. Non toccati: i metodi TS
dell'interfaccia `BrandFs` (`.list/.read/.grep/.write`, mai esposti come nome-tool a un modello) e
il sistema di chat multi-agente PIÙ VECCHIO (`chat/agent-files.ts`/`chat/tools.ts`, tool
`ls`/`grep`/`read_file`/`glob`) — namespace indipendente, mai passato da `agent-core`, fuori scope.

**La verifica del "zero righe storiche" era sbagliata.** SELECT reale su
`chat_messages.tool_calls` in produzione: 407 messaggi con tool, di cui **63 righe usano i nomi
vecchi** (`read`×37, `ls`×18, `grep`×8, `write`×0), tutte del 22-23/8/2026 — turni recenti del kit,
non fossili di un motore spento. Aggiunto quindi `LEGACY_TOOL_ALIASES` in `executor.ts`: un alias
di SOLA LETTURA (`ls`/`read`/`grep`/`write` → gestiti come i nomi nuovi se un `tool_call` con
quel nome torna in gioco — rilancio, retry, cache di un client vecchio) che non rientra mai nel
catalogo (`BUILTIN_TOOLS` offre solo i nomi nuovi a un turno nuovo).
### Aprire il repo senza mentire: README dei pacchetti, CONTRIBUTING, SECURITY, e tre bugie corrette

Preparazione alla pubblicazione. Niente riscritture di storia, niente rimozioni di dati, niente
cambi di licenza: quelle restano decisioni del proprietario e sono elencate in fondo. Qui c'è solo
il lavoro che si poteva fare adesso.

**Cinque README, uno per pacchetto** (`packages/agent-{kit,contracts,core,adapters,client}`). Cosa
fa, il posto nel grafo (kit → contracts → core → adapters/client), l'API pubblica con un esempio
preso dal codice vero (il `Registry` che nomina le chiavi disponibili, `assertTransition`,
`createApplyTool` cablato sul testkit, la dep-injection di `PostgresMemoryStore`), e una sezione
«cosa NON fa» — perché la domanda che arriva davvero da fuori è quella. Nessuno di questi pacchetti
è pubblicabile su npm (`private: true`, `exports` che puntano al sorgente `.ts`) e i README lo
dicono, invece di lasciarlo indovinare.

**CONTRIBUTING.md e SECURITY.md**, in inglese come tutto ciò che legge uno sconosciuto. Il
CONTRIBUTING è quello vero, non quello di cortesia: le migration si applicano a mano e i deploy non
le eseguono, `--wait` sul compose non è decorazione, `npm run test:unit` oggi NON è verde
(`src/lib/motion-video/library.test.ts`, 15 rossi) e `npm run check` ha qualche centinaio di errori
preesistenti — meglio dirlo che far scoprire a un estraneo che ha rotto lui qualcosa. Più i due
changelog obbligatori, l'identità del commit (con il perché: Vercel rifiuta un autore che GitHub
non risolve), e il divieto `$lib`/`$env` dentro `packages/`. Il SECURITY punta al Private
Vulnerability Reporting di GitHub — un toggle nelle impostazioni, **da attivare**, non un indirizzo
email nuovo da presidiare — e delimita lo scope: il cross-tenant è la classe che conta, la chiave
anon nel bundle non è un finding, un modo per aggirare la RLS lo è.

**Bugia 1 — il billing.** Il README diceva «this repo ships the open provider by default — nothing
metered, nothing gated». Il codice fa l'opposto: `billingProvider()` (`src/lib/server/billing/index.ts`)
ritorna il provider a crediti a meno di `BILLING_PROVIDER=open`. Corretta la prosa in README e
SELF_HOSTING; il default NON è stato invertito, perché in produzione quella variabile non è
impostata e invertirla spegnerebbe il freno di spesa dell'incidente 2026-07-13. Aggiunto anche il
pezzo che mancava ovunque: `open` toglie crediti e quota, non i gate che leggono `brands.plan`
direttamente.

**Bugia 2 — «No telemetry defaults to us».** Era falso. `src/lib/server/seline.ts` aveva il NOSTRO
token Seline cablato come fallback e `src/lib/analytics.ts` il NOSTRO pixel Meta: un'istanza
self-hosted servita da un hostname reale caricava il nostro pixel e identificava i propri utenti
loggati — email e nome — dentro il nostro progetto Seline. Tolti entrambi i default: senza
`PUBLIC_SELINE_TOKEN` il modulo server no-op e lo script non si carica, senza `PUBLIC_META_PIXEL_ID`
il pixel non si inietta e `metaCapiEvent` esce subito. **Prima del merge vanno impostate
`PUBLIC_SELINE_TOKEN` e `PUBLIC_META_PIXEL_ID` nell'env di produzione Vercel**, o la produzione
perde analytics in silenzio — è esattamente il tipo di regressione muta che questo repo ha già
visto con le migration. Non ruotato niente: sono identificatori pubblici, non credenziali.

**Bugia 3 — l'installazione self-hosted schiantava al primo `up`.** `infra/compose/.env.example`
diceva di generare `JWT_SECRET` con `openssl`, ma `ANON_KEY` e `SERVICE_ROLE_KEY` shippano
pre-riempite e sono JWT firmati con il secret demo: chi seguiva la guida alla lettera otteneva
`401 JWSInvalidSignature` da ogni servizio. Ora `JWT_SECRET` è pre-riempito col valore coerente e
il commento spiega che i tre sono UN set solo. Aggiunto `--wait` al `docker compose up` in README e
SELF_HOSTING (0004 vuole `storage.buckets`, 0137 vuole `realtime.messages`: le creano i container
al proprio avvio) più la riga di troubleshooting con l'errore testuale e il rimedio (rilanciare
`db:migrate`, riprende dal file non applicato).

**Il seed nasceva senza piano.** `scripts/db-seed.mjs` creava il brand con `status='trial'` e
`plan=null`: `accountLimit()` ritorna 0 e collegare un account social rimbalzava al checkout Stripe
su un'istanza che non ha Stripe. Ora `plan='pro', status='active'`, sovrascrivibili con
`SEED_BRAND_PLAN`/`SEED_BRAND_STATUS`; il ramo `do update` resta invariato apposta, un'istanza già
in uso non deve vedersi riscrivere piano e stato a ogni `db:seed`. Test in `db-seed.test.ts`.

**Altre correzioni di onestà nei documenti.** Zernio non era nominato da nessuna parte come vincolo:
è la dipendenza hosted senza alternativa che rende «pubblicare» impossibile senza chiave (i post
approvati restano approvati e non escono mai) — ora è il terzo punto in entrambi i documenti,
accanto a Vercel Sandbox. Il claim «every cron/worker endpoint is fail-closed» valeva solo in build
di produzione: sotto `npm run dev`, cioè il modo che la guida stessa prescrive, 48 handler fanno
`if (dev) return true`. Detto, con il quando-è-sicuro e il quando-non-lo-è. E il badge Apache-2.0
non copre le dipendenze: Remotion è source-available (company license sopra i 3 dipendenti) e
`ffmpeg-static` scarica un binario GPL-3.0 — due righe sotto `## License`, senza inventare un
NOTICE che nessuno aggiornerebbe.

**Restano al proprietario** (nessuno di questi è stato toccato qui): i dossier di lead con dati
personali nelle PR aperte e nella storia, la musica di terzi nei render, i documenti interni in
`docs/archive/`, e la scelta se pubblicare da un repository nuovo invece di aprire questo.

### Il balbettio in chat, e il guardiano anti-bugia che sbagliava in entrambi i sensi

Autopsia sui thread veri del proprietario: due difetti di qualità percepita, entrambi confermati
sui dati reali.

**CAUSA B — ogni appunto di lavoro diventava una bolla in chat.** `assistantContentFromSteps`
(`src/lib/server/chat/persistence.ts`, usata da entrambi i motori: `chat/+server.ts` legacy e
`agent/bridge/live.ts` kit) spingeva il testo di OGNI step come blocco `text` — l'annuncio che il
modello scrive prima di chiamare un tool («Controllo se è collegato…») finiva bolla a sé accanto
alla risposta vera. Osservato: la stessa informazione ripetuta tre volte di fila nello stesso
turno. Secondo difetto, peggiore, nella stessa funzione: il testo del `reply` finale entrava
`solo if (!sawText)` — se il modello aveva scritto un appunto prima, la risposta VERA veniva
buttata, e la UI nasconde la chip di `reply`/`ask_user` (sono in `MESSAGE_TOOLS`), quindi non
compariva da nessuna parte. Fix: quando il turno chiude esplicitamente su `reply`/`ask_user` (il
contratto del tool: "il turno finisce SOLO qui o con ask_user — mai in silenzio dopo un tool"),
ogni testo di step diventa `reasoning` (la UI lo colassa già sotto "Ho pensato" — verificato, e il
campo `reasoning` viene letto in `+page.svelte:1514`), e il testo di chiusura si aggiunge SEMPRE,
non come fallback. Un motore SENZA quei tool (il legacy) non è toccato: lì il testo dell'ultimo
step È la risposta, da sempre. Test con le frasi reali del thread in `persistence.test.ts`.

**CAUSA C — il giudice di chiusura (`verdict.ts`) sbagliava in entrambi i sensi.** (1) `PROMISE_RE`
elencava solo presenti indicativi: sul testo reale del fallimento («poi ti dico come farei il
parlato») non matchava né `ti dico`, né il condizionale `farei`, né i futuri (`farò`, `creerò`,
`manderò`…) — il turno chiudeva "finito" avendo promesso e non consegnato. Allargata a futuri e
condizionali italiani (e ai corrispettivi inglesi): la nuova regex usa lookaround su `\p{L}` invece
di `\b`, perché `\b` in JS conta solo `[A-Za-z0-9_]` come carattere di parola — dopo una vocale
accentata (farò, creerò) il confine finale non scattava MAI, un bug silenzioso scoperto scrivendo
il test. (2) `CLAIM_RE` matchava il participio nudo (`pubblicat[oa]`), quindi «Nessun post
pubblicato al momento» — frase onesta, testuale nel thread — veniva accusata di dichiarare un
lavoro consegnato e rilanciata con l'ordine di chiamare ORA gli strumenti che producono davvero,
cioè creare contenuto mai richiesto su un brand di produzione. Fix: `NEGATION_RE` controlla una
finestra di 30 caratteri prima del participio (nessun/non/zero/niente/nulla) — un participio negato
non è un fatto compiuto. (3) Verificato e confermato vero il sospetto sulla ricostruzione del
contesto: il rilancio silenzioso in `live.ts` (dentro `onFinish`) ricostruiva la storia come
`[...messages, {role:'assistant', content: visibleText}, {role:'user', content: continuation}]` —
una stringa piatta, senza nessuna delle tool-call/tool-result del turno appena chiuso. Il modello
ripartiva senza sapere di aver già letto/scritto/chiamato niente, e RIFACEVA da capo invece di
completare: un rilancio diventava una ripetizione. Fix: la stessa ricostruzione tool-call/
tool-result di un vero reload di thread (`messagesFromRow`, sullo stesso `content` già passato a
`saveMessages`). Test con le frasi reali in `verdict.test.ts` e un test di integrazione in
`live.test.ts` che pinna il `tool` role nel prompt del rilancio.
### Il secondo giro dell'audit: il lavoro di sfondo dichiarato, il recupero che non era mai partito

Nove finding confermati da una verifica avversaria, tutti della stessa famiglia: codice che
*sembrava* fare una cosa e non la faceva, senza un errore da nessuna parte.

**Il recupero del parziale era un no-op in produzione.** `recoverDeadPartial` (sweep) selezionava
`agent_kit_runs.partial_saved_msg_id` — colonna della 0219, migration **scritta e mai applicata**
(i deploy non le eseguono). PostgREST rispondeva 42703, supabase-js non lancia, `data` tornava
`null` e la funzione usciva ai primi guard: nessun run reaped ha mai promosso il suo `partial` a
messaggio, e nemmeno un log lo diceva. Prima di d0523db3 il recupero funzionava (selezionava solo
colonne esistenti): l'estrazione della funzione l'aveva spento. Fix: `select('*')` — si legge ciò
che la tabella HA, prima e dopo la migration — e l'`error` viene **letto e loggato** invece di
essere scartato. Scartata l'alternativa «togli la colonna dalla select»: la 0219 va comunque
applicata, e con `*` il codice è corretto in entrambi gli schemi. **La 0219 resta da applicare a
mano in produzione** (`alter table public.agent_kit_runs add column if not exists
partial_saved_msg_id uuid null;`): senza, il marcatore anti-doppione non viene mai scritto e resta
solo il palliativo `ilike`.

**Il dedupe del recupero non poteva scattare.** Il palliativo cercava un messaggio assistant nato
negli ultimi 5 minuti, ma il reaper agisce *per definizione* ≥10' dopo l'ultimo battito — e
l'ultimo `writePartial` precede di un istante il `saveMessages` di `onFinish`. La finestra era
quindi sempre già scaduta: dead code proprio nel caso che il commento dichiarava di coprire, con
doppione garantito. Ora l'ancora è `run.created_at`: i messaggi nati dopo l'avvio di QUESTO run.
Il test è stato corretto (il doppione ha un `created_at` vecchio di 11', com'è nella realtà: prima
passava verde su uno stato impossibile).

**`resume()` non rimetteva il cuore a battere.** `transition()` scrive stato e `updated_at`, mai
`heartbeat_at`: un run rimasto in `waiting_input` per ore tornava `running` col battito del
segmento precedente, cioè già stantio. Nella finestra fino al primo chunk era insieme (a) preda del
reaper, che lo abortiva DA VIVO — e il `finish` successivo esplodeva su una transizione da
`aborted`, saltando marcatore e giudice di chiusura — e (b) invisibile ai guard anti-concorrenza,
che lasciavano partire un secondo run sullo stesso thread. Una riga in `run-store.ts`, e vale per
entrambi i chiamanti (bridge e agent-lab).

**Il turno classico non dichiarava il lavoro di sfondo.** Il postmortem del 23/8 (run morto a 107s)
aveva provato che Vercel considera finita l'invocazione appena la Response è consegnata; il fix
(`consumeStream` + `waitUntil`) era stato applicato SOLO al ramo kit. Il classico aveva il solo tee
`consumeSseStream`, che è uno *specchio*, non un driver: un reload a metà turno e `onFinish` non
girava mai — risposta mai salvata, continuazione mai accodata, il reaper chiudeva come `failed`
lasciando solo il parziale. Stesso identico pattern del kit, ora anche qui. Non era una regressione
recente: era il buco preesistente che l'incidente del kit aveva dimostrato e curato a metà.

**Il 409 busy post-save duplicava il messaggio.** La guardia anti-doppio-run vive in due punti non
atomici: prima di `saveMessages` nel POST, e dentro `runKitTurn` DOPO. Nella finestra fra i due
(roomBeat + history + attachments + saveMessages: secondi) un secondo invio passava il primo guard,
salvava il suo messaggio e prendeva il 409 dal secondo; il client accodava, e il drain — che
riconosce «già salvato» solo confrontando il TAIL della history, ormai la risposta del run vincente
— lo salvava una seconda volta. Ora il busy del bridge dichiara `user_message_saved: true`,
`startChatSession` lo distingue (`'busy_saved'`) e l'enqueue lo propaga in `input_params`, dove il
drain lo onora già. Il flag NON va su tutti i busy: quello a monte è pre-save, e metterlo lì
perderebbe il messaggio.

**Fine di un run kit: nessuno svegliava la coda.** Ogni uscita del turno classico chiama
`scheduleQueueKick`; `live.ts` non lo faceva. Un follow-up accodato (che il drain salta finché il
run kit è vivo) restava fermo fino al cron `*/2`: due minuti di attesa morta dopo un turno già
concluso. Ora `runKitTurn` riceve l'`origin` e kicka su ogni uscita, sempre **dopo** `finish`, o il
drain vedrebbe il run ancora vivo e riscarterebbe il job. Resta aperta l'asimmetria più grande e
già dichiarata: il drain esegue il follow-up col motore legacy, non con i tool dello specialista.

**Le immagini sparivano nella coda.** `enqueueChatMessage` non ha alcun parametro `attachments` e
il ramo `action:'enqueue'` gestisce solo i documenti: ogni invio dirottato in coda (nuovo: anche
per il 409 busy) partiva senza le immagini che l'utente aveva appena visto in anteprima nella
bolla. Scelta: **non** accodare un invio con allegati — il messaggio torna nel composer con un
errore visibile. Scartato il giro grosso (portare gli attachments fino al drain via
`persistChatAttachments` + `input_params`): è la strada giusta se un giorno si vuole che l'invio
sopravviva davvero, ma è molto più codice per un caso che si risolve con «riprova fra un attimo».
Il guard sta su ENTRAMBI i rami (`loading`/`orphanRun` e `busy`), perché la perdita era la stessa.

**Il follow-up nascondeva il run kit orfano.** Accodare durante un run orfano attaccava subito
`beginJobPolling` sul job: sessione a `loading:true`, `orphanRun` azzerato, poll kit-run spento —
il parziale che l'utente stava guardando spariva dietro uno spinner vuoto, mentre il job non poteva
nemmeno partire (il drain salta i thread con run kit vivo). Ora l'enqueue accetta
`attachPolling: false` e la pagina lo passa quando c'è un run orfano; il riaggancio (`reattach` +
`refreshQueue`) avviene in `finalizeOrphanRun`, cioè quando il run finisce davvero.

**Il poll kit-run girava sempre.** L'effect era gated solo su `!loading`: ogni thread aperto — anche
classico, anche con `AGENT_KIT` spento, che il client non può nemmeno sapere — chiedeva 50 volte al
minuto per ricevere 204, per ore. Due guard dentro `poll` (`document.hidden`, e un giro ogni 8 se
non c'è un run vivo): ritmo pieno solo quando serve, zero a scheda nascosta. Il commento che
prometteva già quel comportamento è stato reso vero invece che cancellato.

**Bozza di recovery distrutta senza poterla ripristinare.** Il ramo senza `?message=` cancellava
sempre la bozza brand-level ma la rimetteva nel composer solo `if (!already && !input)`: con un
composer occupato (la bozza per-thread appena ripristinata) il testo veniva distrutto senza rete.
Ora si cancella **dopo** aver deciso, come fa già `ChatColumn`. L'altra metà del finding — il
deep-link `?message=` che vince sulla bozza per-thread — è precedenza voluta e documentata: non
toccata.

### Un run vivo blocca il secondo turno ovunque, e il reload di un turno kit non congela più

Cinque bug confermati della stessa classe (audit 24/8, chat kit): non davano errori, davano
silenzio. Radice comune: i turni kit non scrivono righe `chat_jobs` e non mandano `X-Chat-Job-Id`,
quindi tutto ciò che si fidava di quei due segnali (guard di concorrenza, riaggancio al reload,
recovery di rete) era cieco proprio sui turni nuovi.

**Reinvio/retry sopra un run vivo → due run concorrenti (bug 1).** Il POST interattivo non aveva
ALCUN check di concorrenza (threadHasActiveChatResponse era usato solo da clear_context ed
enqueue), e comunque `chat_jobs` non vede i run kit. Fix: `threadHasActiveKitRun` in `queue.ts`
(run 'running' con battito — o nascita — dentro la stessa soglia 10' del reaper dello sweep: uno
zombie non blocca) usato in DUE punti: nel POST (`chat/+server.ts`, dopo il rate-limit e PRIMA di
`saveMessages`, così il retry non lascia doppioni) insieme al check legacy → **409 {error:'busy'}**;
e nel claim-loop del drain (`processNextQueuedChatJob`), che poteva far partire un turno LEGACY
sotto un run kit vivo. 409 e non enqueue automatico: il drain non sa far girare turni kit. Lato
client `startChatSession` riconosce il 409-busy e ritorna 'busy' → i chiamanti accodano già da
soli (il ramo esistente `enqueueChatMessage`), niente barra rossa né placeholder orfano. Il guard
gemello dentro `runKitTurn` (409 prima di `createRun`) era già arrivato con 563640c0: questo copre
il buco a monte e il drain. Test: `kit-run-guard.test.ts` (vitalità + il drain che NON claima).

**Doppia sessione dalla stessa tab (bug 2).** Il busy-check di `startChatSession` richiedeva
jobId o buffer: una sessione vera ma pre-header (finestra `setThreadCustomAgent` in ChatColumn)
non era 'busy', il secondo Enter apriva un secondo POST e l'abort del gemello orfanava la UI del
superstite. Fix: flag `primed` su InternalSession — solo il placeholder di `primeChatSession` è
upgradabile; una sessione loading non-primed è sempre busy. Nessun deadlock: su errore fetch
loading torna false, su AbortError senza job la sessione si cancella.

**Reload durante/subito prima dello stream kit → spinner infinito (bug 3+4, una riga).** In
`hydrateSessionFromStorage`, `loading: persisted.loading || !!jobId` risuscitava un loading che
nessun poll poteva completare (i turni kit non hanno jobId): quel loading spegneva SIA il poll
kit-run della pagina (gated su !loading) SIA il reload Realtime — parziale congelato fino al TTL
di 30'. Fix: `willPoll = !!jobId && (persisted.loading || !!opts.jobId)` governa sia `loading`
sia l'avvio del poll: senza un job da pollare la sessione idrata spenta, il poll kit-run parte al
mount e la bolla orfana rende il `partial` del server. I buffer restano (continuità visiva).

**Rete che cade a metà stream, senza reload (bug 5).** (a) Un 'failed to fetch' su un turno kit
(jobId null) cadeva su `markSessionError`: chat_error finto, il finalize foldava il parziale come
bolla e il poll kit-run faceva ricrescere lo STESSO testo accanto — doppione con barra rossa su
un turno vivo. Ora una disconnessione benigna CON stream già ricevuto si dimette in silenzio (il
poll riaggancia entro ~1.2s); con zero byte ricevuti resta il percorso errore — è il caso «POST
mai atterrato» di a2b5971d, che ha la sua recovery, e scavalcarla avrebbe perso il messaggio.
(b) Un socket APPESO (proxy che non chiude il TCP) non rigetta mai `reader.read()`: watchdog di
90s sul read (timer cancellato a ogni chunk — un tool lungo può tacere decine di secondi); allo
scatto, stesso routing del catch: con jobId → pollUntilDone, senza → dismiss. Un falso positivo
degrada con grazia. Test: `chat-session.test.ts`, 8 casi nuovi che pinnano ciascun ramo.

### L'invio che fallisce non sparisce più in silenzio

Quattro bug della stessa classe (audit 24/8, chat thread): quando l'invio falliva, niente
errore — solo silenzio, e in tre casi su quattro il testo dell'utente andava perso.

**POST mai arrivato mostrato come inviato.** Rete giù nel momento del POST: `markSessionError`
settava errore E `completedAt` insieme, il finalize dismissava la sessione e la bolla ottimistica
restava in `messages` come «inviata» (spariva al reload). Fix: una guardia in
`finalizeCompletedSession` — errore senza `jobId` né buffer streamato (`isPreStreamFailure`,
nuovo `src/lib/chat-send-recovery.ts`) = il server non ha mai visto il messaggio, quindi non si
finalizza e non si dismissa: la sessione resta viva col banner e il Riprova funzionante. Copre
anche gli errori HTTP pre-stream (402/429/500), che lampeggiavano allo stesso modo.

**Banner d'errore auto-dismesso.** Ogni esito 'error' finiva comunque in `dismissSession`, e il
banner (derivato da `session.error`) viveva solo la durata della fetch dentro il finalize: un
lampo, Riprova impremibile. Fix: copia locale `staleError` nella pagina, catturata prima del
dismiss e mostrata dal derived; la azzerano Riprova (inizio `send()`), la × e il cambio thread.
Scartata la variante «salta il dismiss quando c'è errore»: lasciava il lampo nel caso sse_error
con partial già streamato, che va comunque foldato.

**Enqueue perso in silenzio.** `enqueueChatMessage` ritorna già `{ok:false}`, ma i due chiamanti
in `+page.svelte` lo ignoravano (ramo loading e ramo 'busy'): il follow-up spariva, e nel ramo
busy restava pure la bolla fantasma. Fix nei chiamanti, non nel contratto: su `!ok` il testo
torna in `input`, banner acceso, e nel ramo busy `reloadMessages()` toglie la bolla; su ok il
ramo busy ora fa anche `refreshQueue()` come il gemello.

**`?message=` cancellato prima dell'accettazione.** La pagina thread cancellava il param subito
e spediva 100ms dopo: refresh (o POST fallito) in quella finestra = testo perso per sempre. Ora
il param resta finché il server non ha accettato: al ricarico, se la bolla è già in transcript si
pulisce e basta, altrimenti si rigioca. Il gemello VIVO in `ChatColumn` (deep-link → il `goto` di
`ensureThread` distrugge l'URL prima che il POST atterri) è coperto da una bozza in
sessionStorage (`sendDraftKey` + lo storage già esistente `chat-draft.ts`, riusato): scritta
prima dell'invio, cancellata ad accettazione, ripescata nel composer da Overview o dalla pagina
thread. Test: `chat-send-recovery.test.ts` (predicato, un caso per congiunto) + pin in
`shell.test.ts` su ogni guardia.

### Un turno kit alla volta per thread, e il draft che sopravvive al refresh

Due bug figli dello stesso momento — il refresh a metà turno — trovati dall'audit del 24/8.

**Run doppi dopo un refresh.** Dopo un reload la session store client è vuota (`loading=false`)
e la riga «sta ancora lavorando» (`orphanRun`, poll su `kit-run`) non bloccava il composer:
`send()` passava dal percorso interattivo pieno, `runKitTurn` cercava solo run `waiting_input`
e apriva un SECONDO run `running` concorrente sullo stesso thread. Fix in due tocchi: (a) radice,
`bridge/live.ts` — prima di `createRun` si controlla anche `state='running'` sul thread e si
risponde **409** invece di creare il doppio; «vivo» usa la stessa soglia di 10' del reaper dello
sweep (battito, o nascita se mai battuto), così uno zombie non blocca mai — lo chiude il reaper.
Copre OGNI chiamante, non solo il refresh. (b) client, `chat/[thread]/+page.svelte` — il ramo di
accodamento di `send()` ora scatta anche con `orphanRun`, quindi il messaggio va in coda
(`enqueueChatMessage`) come quando lo stream è vivo. Nota assunta e accettata: il drain della
coda guarda solo `chat_jobs`, quindi un messaggio accodato può ripartire mentre il run gira —
col guard (a) il peggio è un 409 ritentabile, non un run doppio. Scartato: un vincolo unique su
DB (0216) — più giusto in teoria, ma le migration non si applicano da sole ai deploy e il guard
applicativo basta per la classe di bug vista. Test: `live.test.ts`, 3 casi (fresco→409 senza
seconda riga, mai battuto ma giovane→409, zombie oltre 10'→il turno parte).

**Il testo scritto moriva col refresh.** Nessun composer persisteva il draft: `input` era
`$state('')` sia in `chat/[thread]/+page.svelte` sia in `ChatColumn.svelte`, e `ChatPrompt`
salvava solo la modalità (`MODE_KEY`). Fix nel componente condiviso, non nei caller: prop
opzionale `draftKey` su `ChatPrompt` + modulo `src/lib/chat-draft.ts` (sessionStorage, ripristino
solo a casella vuota — l'hand-off `?message=` vince — e rimozione quando i caller azzerano
`value` all'invio, cosa che già fanno). Due call site: pagina thread (chiave per thread) e
ChatColumn (chiave per brand+thread). Scartato: l'$effect direttamente in `+page.svelte` —
avrebbe lasciato rotto il secondo composer. Test: `chat-draft.test.ts` (write→read, invio che
RIMUOVE la chiave — non `setItem('')` —, storage rotto che non lancia mai).

## 2026-08-23

### Il riaggancio dello stream al reload: tee + Realtime + parziale persistito

Mandato: un reload a metà turno kit lasciava solo la riga «sta ancora lavorando» — il turno
continuava sul server (`consumeStream`) ma il client non rivedeva più un token fino al refresh
automatico di fine turno. Serviva il riaggancio VERO: parziale visibile subito + coda viva.

`bridge/live.ts` — verificato cosa `ai` v6 offre DAVVERO prima di scrivere: non un `tee()`
manuale sull'UI message stream (quello che il mandato ipotizzava), ma `consumeSseStream`, l'opzione
che `toUIMessageStreamResponse` già inoltra a `createUIMessageStreamResponse` e che questo stesso
repo usa già per lo stesso identico scopo su `chat_jobs` (`surface-turn.ts` `collectSurfaceReply`,
`routes/app/[brand]/chat/+server.ts`) — una copia tee'd dell'SSE, letta senza competere col
client. Il DRIVER resta `consumeStream` (invariato): il ramo `consumeSseStream` è SOLO uno
specchio, mai il motore del turno. Ogni chunk parsato va, così com'è, sul canale Realtime
esistente (`brand:<uuid>`, `src/lib/server/realtime.ts`, eventi nuovi `kit_stream`/
`kit_stream_done`) — un tool-output più grande di ~8KB perde il payload (`output`/`input`),
mai l'identità dell'evento. Lo stesso reducer di `chat-stream-events.ts` (`applyChatStreamEvent`,
già condiviso client/server per `chat_jobs`) accumula il testo e lo scrive throttled (~1/s, più
un'ultima scrittura incondizionata a fine turno — un turno più corto di 1s non avrebbe mai scritto
altrimenti) sulla riga del run: `agent_kit_runs.partial` (migration `0218`, **DA APPLICARE A
MANO PRIMA/insieme a questo deploy** — `kit-run/+server.ts` ora seleziona quella colonna, e senza
la migration il select fallisce e la banner "sta lavorando" sparisce silenziosamente, lo stesso
bug già visto su `EDITOR_POST_COLS` il 3/8).

`kit-run/+server.ts` ora ritorna anche `partial`. Client (`chat/[thread]/+page.svelte`,
`realtime/brand-channel.svelte.ts` con `onKitStream`/`onKitStreamDone`): la riga "sta lavorando"
resta come testata, e sotto cresce la bolla live (`ChatLiveStatus` riusato as-is) — se il canale
Realtime non è connesso il poll da 4s esistente porta comunque `partial`, fuso col locale
prendendo sempre il più lungo dei due: testo a scatti invece che fluido, degradazione dichiarata.

Test: `bridge/live.test.ts` — 3 mutazioni contro un `MockLanguageModelV3` che streamma testo a
pezzi (come `token-budget.test.ts`): il ramo cliente e il ramo specchio ricostruiscono lo STESSO
testo (il tee non perde chunk), lo specchio scrive `partial` ≤2 volte anche con 12 chunk (throttle
vero, non un update a token), e la riga del run porta `partial.text`/`toolNames` dopo il turno.

### I tre mestieri senza mestiere prendono i plugin: Content, UGC, Web

Mandato: sul sistema nuovo (`src/lib/agent/`) Content Creator, UGC Specialist e Web Specialist
avevano solo i 14 primitivi comuni — analizzano ma non producono. Stesso pattern collaudato di
`plugins/motion.ts`: un `ToolPlugin` per mestiere, montato solo per chi lo usa, che avvolge le
funzioni server ESISTENTI invece di riscriverle.

La scoperta che ha deciso la forma: `create_post`, `design_graphic`, `generate_image` e gli
articoli del blog non sono funzioni server isolate — vivono come `tool()` dell'AI SDK dentro
`createChatTools` (`src/lib/server/chat/tools.ts`), lo stesso identico oggetto che la chat usa
oggi. `tool()` è un'identità (`@ai-sdk/provider-utils`): il suo `.inputSchema` È lo schema Zod
passato a `tool({...})`, quindi si traduce in JSON Schema con `z.toJSONSchema` invece di essere
ridigitato a mano (`src/lib/agent/plugins/chat-bridge.ts` — `jsonSchemaOf`, `pickJsonSchema` per
i tool con un contratto più stretto del reale, `execChatTool` per chiamare la `.execute` vera e
propagarne il risultato). Avvolgere il tool intero invece delle funzioni interne significa
ereditare i gate SENZA duplicarli: crediti/quota (`remaining`), consenso AI-Act sulle persone
reali (`resolvePeopleVisualRefs`/`…Detailed` — la prima droppa in silenzio, la seconda rifiuta,
la differenza vive nel codice vero e resta anche nel plugin), il prepublish gate ("un post senza
media non si approva" — `publish.ts`), e "solo 'approved' pubblica un articolo" (mai riscritto).

`plugins/content.ts` (`content_*`): `create_post`, `design_graphic`, `generate_image` as-is,
`content_schedule` → `approve_post` (il gate di prepublish reale), `content_list_posts` →
`read_posts`. `plugins/ugc.ts` (`ugc_*`): non esiste un `create_video` separato in chat — il ramo
video vive dentro `create_post` (content_type "video"), quindi `ugc_generate_video` lo avvolge con
`content_type` FORZATO e uno schema ridotto ai soli campi video (presi di peso dallo schema
derivato, mai duplicati — l'enum dei modelli video resta sincronizzato da solo). Async onesto:
`ugc_check_video` (nuovo, non esiste in chat — il mestiere ugc non monta `content_list_posts`)
dice se il render è ancora `rendering` o è atterrato, mai un "video pronto" bugiardo.
`ugc_list_people`/`ugc_list_talents` → `read_people`/`read_talents`. `plugins/web.ts` (`web_*`):
gli articoli (`list/read/update/schedule_article`, `optimize_article`,
`generate_article_cover/images`, `write_planned_article`), `web_seo_audit`/`web_read_seo_audit` →
`run_seo_geo_audit` (job in BACKGROUND, il tool torna un job id, non l'audit), e i 7 `dfs_*`
esposti come `web_dfs_*` iterando `DATAFORSEO_CHAT_TOOL_KEYS` invece di ridichiararli uno per uno.

Un'edit puntuale in `bridge/live.ts`: la riga `plugins` monta `content`/`ugc`/`web` per
`spec.id`, stesso schema di `motion`.

Test: `plugins/{content,ugc,web}.test.ts` — mock su `usage.ts`/`content-preview.ts` (isolarsi dal
terreno billing in conflitto e dal rendering AI vero), gate reali (consenso, prepublish, "solo
approved pubblica") verificati SENZA mock. Trovato e corretto in corsa: senza mockare
`$lib/server/video`'s `submitVideoRender`, il primo test di `ugc_generate_video` chiamava DAVVERO
l'API a pagamento di kie (KIE_API_KEY è impostata in questo ambiente) — misurato nello stderr del
run, non ipotizzato.

### Il billing diventa un plugin: un contratto, un provider open, uno che è il prodotto

Mandato: prima dell'open source, il codice open non deve decidere più niente sul billing —
l'estrazione fisica del provider chiuso in un pacchetto npm privato resta per il lotto dopo
(split 2b), ma da qui in avanti tutto il gating sta dietro un'interfaccia con default aperto.

`src/lib/billing/contract.ts` (client-safe, guardato da `contract.test.ts` come
`agent-lab/shell.test.ts` guarda una pagina — legge il file come testo, niente import
server-only): tipi (`QuotaKind`, `BillingContext`, `BillingUsage`, `UpgradeOption`) + l'interfaccia
`BillingProvider` (`gate`, `quota`, `upgradeUrl`, `plansAbove`, `isTopPlan`) + `QuotaExceededError`/
`PlanRequiredError`. `CreditsExhaustedError` (`src/lib/server/credits.ts`) resta dov'è e non viene
duplicata: è server-only (importa `supabase-admin`), quindi non può entrare in un file
client-safe, e i ~20 punti che già la beccano per `.name`/`instanceof` continuano a funzionare
senza toccarli. `src/lib/billing/open-provider.ts`: il default per un fork self-hosted — `gate()`
non lancia mai, `quota()` è sempre `Infinity`, `upgradeUrl()`/`plansAbove()` non hanno niente da
vendere. `src/lib/server/billing/anomalia-provider.ts`: il prodotto di oggi, invariato — chiama
`gateCreditsCore`, `creditQuota`, `postQuota`, `plansAbove`, `isTopPlan` esistenti, non li
riscrive. `src/lib/server/billing/index.ts`: `billingProvider()` sceglie in base a
`BILLING_PROVIDER=open`, o cade su open se il modulo anomalia non si carica (il futuro pacchetto
privato assente).

Le due strozzature: **`gateCredits`** (`src/lib/server/credits.ts`) — chiamata da tutti i 29 punti
di gate crediti (17 diretti + 12 via `gateAiAction`, che la chiama a sua volta e quindi eredita il
comportamento senza essere toccata) — ora delega a `billingProvider().gate('credits', ...)`; la
vecchia logica (cache 60s, fail-open, `isCreditExempt`) è invariata, solo rinominata
`gateCreditsCore` e chiamata dal provider anomalia. **`remaining()`** (`src/lib/server/usage.ts`) —
la lettura da cui passano gli ~11 gate `budget.posts <= 0` — ora prende `postsQuota` da
`billingProvider().quota('posts', ...)`; `videosCap` resta `round(postsQuota × VIDEO_SHARE)`, la
stessa formula di sempre, quindi eredita `Infinity` senza un secondo `QuotaKind` per i video.
`src/routes/app/[brand]/upgrade/+server.ts` ora legge `plansAbove` dal provider: sotto `open`
ritorna `[]`, quindi la rotta rimbalza su `settings/billing` invece di chiamare Stripe senza
chiavi. Le altre superfici upsell (pricing, activate, settings/billing, i CTA statici) restano
Stripe dirette — vanno dietro il contratto solo nel lotto di estrazione fisica, quando serve anche
uno stato "billing non disponibile" nella UI, non solo un URL vuoto.

Test: `src/lib/billing/{contract,open-provider}.test.ts`,
`src/lib/server/billing/{index,anomalia-provider}.test.ts`,
`src/lib/server/credits-billing-gate.test.ts` — 18 nuovi test, tutti i test esistenti di
credits/usage/gate restano verdi senza modifiche.

### npm workspaces, secondo lotto: `agent-core`, `agent-adapters`, `agent-client`

Split fase 2b — il resto di `src/lib/agent/` in pacchetti, stesso pattern del lotto 1 (`exports`
diretti sui `.ts` sorgente, niente build step, shim di una riga sui vecchi percorsi, `git mv`).

- **`packages/agent-core`** ← `executor.ts`, `turn.ts`, `run-store.ts`, `computer.ts`,
  `memory-context.ts`, `tools/builtin.ts` (+ test). Zero `$lib`/`$env` — riscontrato di nuovo con
  un grep dedicato prima di spostare, come richiesto dal lotto precedente.
- **`packages/agent-adapters`** ← `adapters/*` + `runtime/*`. Qui c'era il lavoro di dependency
  injection: `brand-fs.ts`, `memory-postgres.ts`, `vercel-sandbox.ts`, `graphical-bootstrap.ts`
  (nuovo dal cantiere desktop, non censito dalla mappa originale), `runtime/ai-runtime.ts`,
  `runtime/models.ts` — sei file, non cinque — importavano `$lib/server/*`/`$env` direttamente.
  Ognuno ora dichiara un'interfaccia minima locale per ciò che gli serve (`BrandFsDeps`,
  `MemoryPostgresDeps`, `VercelSandboxDeps`, `GraphicalBootstrapDeps`, `AiRuntimeDeps`,
  `ModelResolverDeps`) e la riceve come parametro di costruttore/factory — la logica di
  `$lib/server/*` non si è spostata di una riga, solo la freccia della dipendenza si è invertita.
  `src/lib/agent/bridge/adapters.ts` (nuovo, resta nell'APP) è l'unico punto che monta insieme il
  pacchetto e le implementazioni vere da `$lib/server/*`.
- **`packages/agent-client`** ← `client/service.ts` + `client/store.svelte.ts` (lo store Svelte 5
  a rune) + test. Vitest/Svelte li compila da `packages/` senza configurazione aggiuntiva (la
  pipeline `sveltekit()` di `vite.config.ts` non è legata a `src/`).
- `plugins/` e `bridge/` restano nell'app (cablaggio di questo repo, non del kit).

`packages/no-app-imports.test.ts` (nuovo): scansiona ogni `.ts` di `packages/*/src` e fallisce se
trova un `import ... from '$lib/...'` o `'$env/...'` — la regola sopra, verificata a ogni commit,
non solo raccontata. `vite.config.ts` aggiunge `packages/*.{test,spec}.{js,ts}` a `test.include`
per farlo raccogliere (il pattern precedente copriva solo `packages/*/src/**`).

Due test esistenti (`agents/computer/{screen,status}/server.test.ts`) mockavano
`$lib/agent/adapters/vercel-sandbox` — il percorso che le route non importano più direttamente
(ora passano da `bridge/adapters.ts`): aggiornati a mockare quel modulo.

Verificato: `npx vitest run src/lib/agent/ packages/` → 21 file, 227 test verdi. `npx tsc --noEmit`
→ 270 errori, stesso numero e stessa lista del baseline pre-lotto (zero nuovi — i tre che questo
lotto ha introdotto e poi risolto sono nel dettaglio nel report della sessione, non in questo
changelog). Suite intera: 7 file falliscono, nessuno tocca `agent/`/`packages/` (motion-video/
library, oauth, agents.registry, chat-markdown, chat-media, persistence, tool-job-background —
env locali mancanti o lavoro di altri cantieri sullo stesso branch).

### npm workspaces, primo lotto: `packages/agent-kit` e `packages/agent-contracts`

Split fase 2a — inizio della conversione di `src/lib/agent/` in pacchetti separati (progetto
verificato su un lotto precedente, mappato file per file prima di toccare nulla). Il repo resta
npm, non pnpm: `package.json` radice aggiunge solo `"workspaces": ["packages/*"]`, script esistenti
(dev/build/check/test:unit) invariati.

Estratti i DUE pacchetti a zero dipendenze esterne misurate (nessun `$lib`/`$env`, nessuna
dipendenza da billing):

- **`packages/agent-kit`** (`@anomalia/agent-kit`) — `kit/{index,types,interfaces,registry}.ts` +
  `testkit.ts` (gli emulatori in-memory usati dai test). Zero import.
- **`packages/agent-contracts`** (`@anomalia/agent-contracts`) — `contracts.ts` (schema Zod
  dell'agente e macchina a stati del run), `specs.ts` (i cinque specialisti), `notice.ts` (il
  ripiego onesto quando il turno finisce muto). Dipende solo da `@anomalia/agent-kit` (type-only,
  `RunStopReason`) e da `zod`.

**Nessun import esistente si rompe**: i vecchi percorsi in `src/lib/agent/` (`kit/index.ts`,
`kit/types.ts`, `kit/interfaces.ts`, `kit/registry.ts`, `testkit.ts`, `contracts.ts`, `specs.ts`,
`notice.ts`) diventano shim di una riga (`export * from '@anomalia/agent-kit/...'` o
`'@anomalia/agent-contracts/...'`). Il resto del modulo — `executor.ts`, `turn.ts`, `run-store.ts`,
`computer.ts`, `memory-context.ts`, `tools/builtin.ts`, `adapters/*`, `runtime/*`, `client/*`,
`bridge/live.ts`, `plugins/*` — non si tocca: sono il motore del turno e gli adapter, terreno di
un altro cantiere attivo in parallelo su questo stesso branch. Arrivano nel lotto 2b, quando
`agent-adapters` avrà bisogno di dependency injection per i suoi 5 punti `$lib`/`$env` prima dello
spostamento.

Nessun build step: gli `exports` dei due `package.json` puntano direttamente ai `.ts` sorgente
(`"./types": "./src/types.ts"`, ecc.) — npm workspaces crea i symlink in `node_modules/@anomalia/*`
e Vite/tsc (moduleResolution "bundler") li risolvono al volo, come fanno oggi con qualunque altra
dipendenza. `vite.config.ts` aggiunge `packages/*/src/**/*.{test,spec}.{js,ts}` a `test.include`
(era solo `src/**`, quindi `specs.test.ts` spostato in `packages/agent-contracts` non veniva più
raccolto da vitest finché non l'ho aggiunto).

Verificato: `npx vitest run src/lib/agent/ packages/` → 19 file, 169 test verdi (stesso numero di
prima dello split). `npx tsc --noEmit` → 270 errori, identici uno a uno al baseline pre-split
(diff riga per riga: zero errori nuovi, zero risolti). Suite intera: 6 file falliscono, tutti
preesistenti e fuori da questo terreno (motion-video/library.test.ts, oauth.test.ts,
agents.registry.test.ts, chat-markdown/chat-media, persistence.test.ts — env mancanti o lavoro di
altri agenti in corso sullo stesso branch, non toccati da questo commit).

Non fuso in `main`: resta sul branch del worktree, in attesa che il proprietario fermi il suo dev
server, faccia il merge e rilanci `npm install` (i nuovi symlink in `node_modules/@anomalia/*` non
esistono finché non gira l'install).
### Self-hosting: il compose Supabase, l'applicatore di migration, e il DSN Sentry che era nostro di default

Mandato: «l'auto-hosting sia fattibile, che non esponiamo rischi noi, e sia buona DX per loro».
Due lotti.

**Lotto A — il pacchetto.** `infra/compose/docker-compose.yml`: db (immagine ufficiale
`supabase/postgres` — una `postgres:16` vanilla non ha i ruoli `supabase_auth_admin` /
`authenticator` / `supabase_storage_admin` né le estensioni che auth/rest/storage danno per
scontate), kong (gateway dichiarativo, `kong.yml` + `kong-entrypoint.sh` vendorizzati verbatim da
supabase/supabase tag v1.26.08, Apache-2.0 — non è più il default upstream, che è passato a un
gateway Envoy con 4 file di config; Kong resta un solo file dichiarativo, più adatto a un repo che
deve restare leggibile in una seduta), auth/rest/storage/realtime, meta+studio dietro
`--profile studio` ("studio opzionale"). Fuori apposta: imgproxy (niente nel prodotto chiama le
trasformazioni immagine di Storage), supavisor, edge functions, lo stack analytics/vector — ognuno
commentato nell'header del compose col perché.

`scripts/db-migrate.mjs`: applica `supabase/migrations/*.sql` in ordine, una transazione per file,
tracciate in `schema_migrations`. Niente ORM: il protocollo "simple query" di `pg` esegue un intero
file (più statement, separati da `;`) in una `client.query(sql)`, quindi non c'è nulla da parsare
oltre "quali file, in che ordine" — quella parte resta pure e testabile senza Postgres reale.
Docker non è installato in questo ambiente: testato con vitest e un client finto (ordinamento,
filtro dei già applicati, rollback + `file:riga` sull'errore da `pg`'s `.position`), non contro un
Postgres effimero — dichiarato, non nascosto. `scripts/db-seed.mjs`: un utente demo via l'admin API
di GoTrue (non un insert diretto in `auth.users` — l'admin API lascia lo stesso `auth.identities` e
lo stesso trigger `handle_new_user` di una signup vera), un'org, un brand; idempotente (trova
invece di duplicare). `pg` è nuovo in `package.json` — **non** installato in questa sessione (`npm
install` è fuori mandato qui), quindi `package-lock.json` non è aggiornato: il primo `npm install`
di chi clona lo prende normalmente. `docs/SELF_HOSTING.md`: la sequenza di 7 comandi, le env
obbligatorie una riga ciascuna, cosa si spegne dichiaratamente senza chiavi esterne (provider AI,
sandbox Vercel per shell/render motion — niente equivalente self-hostabile, non finto), e chi
chiama i cron fuori da Vercel (nessuno, di default: va cablato un proprio scheduler).

**Lotto B — lo sweep.** Un DSN Sentry hardcoded — il nostro, in `hooks.client.ts` e
`instrumentation.server.ts` — mandava gli errori di QUALSIASI fork al nostro progetto Sentry.
Spostato dietro `PUBLIC_SENTRY_DSN` (no-op se assente, stesso guard del resto). L'anon key di
produzione era hardcoded in `.env.example` come "default" (non un placeholder) e ripetuta in un
doc storico (`docs/04-status-roadmap.md`): tolte entrambe. `.env.example` completato — ~85 env
lette dal codice e mai documentate (le tre nuove `INTERNAL_EMAILS`/`ADS_PREVIEW_EMAILS`/
`UNLIMITED_SLOT_EMAILS` incluse), raggruppate per famiglia. Verificati tutti e 45 i cron di
`vercel.json`: ogni handler è già fail-closed su `CRON_SECRET` (nessuno "scoperto" trovato).
PostHog (`eu.i.posthog.com`, non nostro) e il project ref Supabase in `.mcp.json` (strumento
interno per Claude Code, non l'app) lasciati: gated da env o non un default che sposta traffico di
un self-host verso di noi.

### Pulizia pre-open-source: file estemporanei fuori dal repo, non nel disco

Mandato: «pulire la repo dai file di log, estemporanei, pensieri, copy passati». Regola della
sessione: una cosa dichiarata morta e invece viva è il danno peggiore — ogni rimozione verificata
con grep multi-strada prima di toccarla.

**Trovato vivo, non rimosso**: `videos/log-ai-call.mjs` risultava cancellato dal disco (deletion
non committata di qualcun altro) ma è ancora importato da `scripts/gen-why-images.mjs` — ripristinato
da HEAD, non eliminato.

**Traslocati, non cancellati** (materiale di marketing non rigenerabile — integrazione a mandato
in corso: copiati e verificati in `~/Desktop/021-archivio/` PRIMA di toccare il repo, poi tolti):
`ads-assets/` (15 file, 11 MB), `trailer/` (progetto Remotion completo — 80 file tracciati, 165 MB,
`node_modules` escluso perché rigenerabile), e le due cartelle già cancellate da disco ma ancora in
HEAD, recuperate con `git show HEAD:<path>` prima di committarne la cancellazione: `videos/emotional/`
(23 file, 27 MB) e `videos/product/` (2 file).

**Cancellati per davvero** (bug di uno script, path letterale `"undefined"`, zero riferimenti nel
codice): `undefined/*.png` (12 screenshot). **Untracked, non cancellati** (output di
`scripts/run-*-agent.ts`/`.mjs`, rigenerabile a ogni run): `strategy-runs/` — tolto dall'indice,
aggiunto a `.gitignore`, resta sul disco locale.

**Root spostata in `docs/archive/`** (nuovo, con un README di una riga): i quattro file one-off che
`docs/README.md` già segnalava come "asset/analisi puntuali in root repo" (`analisi-meta-ads.md`,
`ads-autonome-copy.md`, `lindaria-email.md`, `PIANO-INCIDENTE-SCHEDULING.md`) più il dossier di
chiusura sessione `docs/SESSION-2026-08-21.md` — riferimenti in `docs/README.md` e
`docs/27-goal-effectiveness.md` aggiornati ai nuovi path. **Non toccata** `docs/` numerata (00-43):
`docs/README.md` la cura già con uno status esplicito (LIVE/DESIGN/HISTORICAL) invece di spostarla —
schema esistente, non da duplicare con un secondo criterio.

**`.gitignore`**: pattern per gli export di sessione AI lasciati in root (`session-ses_*.md`,
`YYYY-MM-DD-HHMMSS-*.txt`) — non cancellati dal disco, solo ignorati, il proprietario potrebbe
volerli leggere — più `undefined/`, `strategy-runs/`, `/ads-assets/`, `/trailer/`.

### Lo schermo dell'agente nel pannello, e due tool nuovi (`observe`/`act`) per un desktop vero

Due richieste del proprietario: vedere nel pannello agente cosa fa la VM del brand, e — fase due —
farci controllare un OS vero (screenshot + azioni su coordinate, il paradigma "computer-use"
classico). Nessuna VM nuova: Xvfb + Chromium + xdotool + ImageMagick dentro la STESSA sandbox
`compute` che `shell` già usa (`src/lib/agent/computer.ts`), non una seconda macchina.

**La sorpresa, verificata su una VM vera prima di scrivere una riga**: l'immagine di default di
`Sandbox.getOrCreate` (`@vercel/sandbox` 3.1.0, nessun `image` esplicito) oggi è **Ubuntu 26.04, non
più Amazon Linux** — `dnf` non esiste (`sh: 1: dnf: not found`). Il piano originale ("verifica i
pacchetti dnf per Amazon Linux 2023") partiva da un presupposto che l'host ha smesso di essere
vero. Con `apt`: `xvfb`/`xdotool`/`imagemagick` si installano puliti; `chromium` è un pacchetto
transitorio SPARITO dai repo Ubuntu, e `chromium-browser` è uno stub snap che senza `snapd` non
parte — lo stesso vicolo cieco container che Ubuntu ha reso famoso. Il browser vero è lo stesso
binario che `src/lib/server/sandbox.ts` scarica già per la navigazione headless (Playwright →
`cdn.playwright.dev`, già in `BROWSER_DOMAINS`): qui si lancia SENZA `--headless`, sotto Xvfb — e
serviva anche `resolvePlaywrightEnv`/`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` (già in
quel file, per lo stesso motivo: Playwright 1.60 non conosce ancora Ubuntu 26.04), importato, non
riscritto una seconda volta. Con l'override: chromium reale avviato sotto Xvfb, screenshot via
`import -window root` — pagina "Sign in to Chromium" catturata per davvero.

**`src/lib/agent/adapters/graphical-bootstrap.ts`** (nuovo): `ensureGraphicalMode` separa due
velocità — i PACCHETTI (apt + il download di Chromium, minuti, dietro un marcatore su file dentro
la VM, `.anomalia/graphical-ready`: niente colonna nuova, niente migration) e i PROCESSI (Xvfb,
Chromium: verificati con `pgrep` e rilanciati se morti, ad ogni chiamata — economico quando già
vivi). Se Chromium non installa, `ok:true, browser:false`: Xvfb+xdotool+import restano usabili,
il ripiego dichiarato che il compito chiedeva, non un errore muto. `captureScreenshot` legge i
byte con `readFile`, MAI dallo stdout di `execute()` (clampato a 20.000 caratteri — lo stesso
rischio già evitato in `checkpoint-storage.ts`: un PNG base64 lo sfonda al primo screenshot).

**Due tool nuovi nel catalogo** (`src/lib/agent/tools/builtin.ts`, 14/14, il tetto dichiarato):
`observe` (screenshot, accende il modo grafico da solo se serve) e `act` (fino a 24 azioni
click/move/type/key/scroll/wait via `xdotool`, quoting POSIX sicuro, poi uno screenshot di
ritorno). Le immagini arrivano al modello senza cablaggio nuovo: `ToolResultContent` aveva già la
variante `image`, e `ai-runtime.ts` la traduce già in `media`/`data`/`mediaType` per l'SDK — la
verifica chiesta dal compito era già vera, non serviva toccare quel file.

**Rete**: la VM `compute` di `computer.ts` aveva un'allowlist deny-all + registry pacchetti; senza
i mirror apt di Ubuntu (`archive.ubuntu.com`, `security.ubuntu.com` — gli UNICI host che
`apt-get update` ha davvero contattato nella prova) l'installazione non parte. Aggiunti a
`DESKTOP_DOMAINS` in `src/lib/server/sandbox.ts`, sempre attivi (non dietro un flag): una VM sola
per brand, non due (il profilo `research` avrebbe cambiato nome sandbox — vedi `sandboxName` — e
`agent_computers.provider_ref` è UNA riga per brand, non due macchine da tracciare).

**Il pannello** (`AgentComputerPanel.svelte`): sezione "Computer" con lo stato macchina (mai
accesa/dorme/accesa, ultimo tocco relativo via `Intl.RelativeTimeFormat`) e, quando accesa+grafica,
lo schermo con polling ~2.5s — SOLO mentre la card è nel viewport e la scheda è in primo piano
(stesso pattern IntersectionObserver+visibilitychange di `AgentAvatar.svelte`). Headless: nessuno
schermo, solo l'ultimo comando `shell` visto nello streaming live del turno corrente (se c'è —
niente fonte nuova inventata). Due endpoint nuovi, entrambi sola lettura sulla sessione
dell'utente (RLS di `agent_computers` già copre i membri del brand, migration 0217):
`GET .../agents/computer/status` (stato + un `cat` del marcatore SOLO se `running`, mai il ramo
lento) e `GET .../agents/computer/screen` (PNG o 204, cache in-memory best-effort ~2s — dichiarata
tale: un modulo serverless non ha stato affidabile fra invocazioni).

Test: `graphical-bootstrap.test.ts` (7, emulatore con supporto minimo per `import`/marcatore),
`executor.test.ts` (+7 su observe/act: rifiuto senza sandbox, tetto 24 azioni, content immagine),
`vercel-sandbox.test.ts` aggiornato (`graphical:true`), contratto degli endpoint (404/204/200,
11 casi). Tre mutazioni provate a mano (tetto 24 disattivato, errore apt-get ingoiato, quoting
xdotool disattivato) — ciascuna ha fatto morire il test giusto, poi revert pulito (`diff` vuoto).
`npx vitest run src/lib/agent/`: 181/181 verdi. `tsc --noEmit`: zero nuovi. `svelte-check`: zero
nuovi sul pannello (baseline pre-esistente invariata). Verifica live: screenshot del pannello vero
(stato "Never turned on", provato in produzione dev con `test@anomalia.so`/`anomalia-3`) — la
sonda del bootstrap grafico è girata 6 volte su VM reali usa-e-getta (create direttamente via
`Sandbox.create`, mai toccando `agent_computers`), ~3 minuti totali di VM, tutte fermate con `.stop()`.

### `artifacts/` — gli agenti vedono i propri motion video, immagini e grafiche come file

Il proprietario voleva che l'AI potesse "vedere i suoi artifact precedenti", con metadata e —
per il motion — il sorgente TSX intero da riprendere fedelmente. Gli artifact esistono già in
produzione (`motion_videos`, `brand_media`, `graphic_designs`); questo lotto è solo la
PROIEZIONE A FILE nell'albero che `read_file`/`ls`/`grep` già navigano — nessuna tabella nuova,
nessuna UI (arriva con un lotto separato).

`artifacts/<tipo>/<uuid>.md` (`tipo` = `motion` | `media` | `graphic`) si risolve dentro
`resolve()` in `agent-files.ts`, con lo stesso schema di `runs/<id>.md` e `brand/studio.md`: una
lettura dal database del brand che sta parlando, non una costante di codice, quindi fuori dal
registro `AGENT_FILES`. Visibile a TUTTI i mestieri (nessun cancello `visibleTo`).

- **`ls('artifacts/')`** elenca per `created_at` desc, una riga per artifact:
  `artifacts/<tipo>/<uuid>.md — <tipo> · <titolo/brief troncato a 60> · <stato> · <data>`.
  `ls('artifacts/motion/')` filtra a un solo sottotipo. Non sta nel registro statico `all`, quindi
  ha un ramo suo in `ls`, prima di quello generico.
- **`read_file`** rende il file composto: intestazione (stato, url, collegamento), `## Meta` (le
  colonne vere), `## Source` (il TSX/HTML intero) quando c'è.
- **`grep`** trova testo dentro un artifact solo per PATH ESATTO (stesso trucco di `runs/<id>.md`):
  un `grep` in blocco sotto `artifacts/` non ci arriva — `createFileTools` resta sincrono per i
  suoi tanti chiamanti fuori da questo file, e renderlo async per un `grep` cieco non valeva la
  rottura. Il limite si dichiara nel risultato (`blind`), non tace.

**Colonne vere, verificate sulle migration** (non sulla memoria):
`motion_videos` NON ha una colonna `status` — è derivato da `preview_url` (reso o no) più il verdetto
più recente in `motion_craft_scores` (`ship` | altro | nessuno), la stessa lettura che
`motion-video/unfinished.ts` già fa. Nessun link a un post: è una galleria a sé, e l'header lo dice
onestamente invece di inventare un collegamento. `brand_media` NON ha una colonna "prompt di
generazione" — `insertBrandMedia` non ne salva una; il file mostra `description`/`suggested_use`
(il catalogo AI scritto DAI pixel) e lo dichiara esplicitamente: "Generation prompt: not recorded".
`url`/`storage_path` sono il path di un bucket PRIVATO (`brand-knowledge`) — niente firma live per
non spargere un signed URL temporaneo nel contesto della chat; si mostra il path e si spiega che
l'app firma un link quando serve. `graphic_designs` non ha `status`: append-only per
`(target_kind, target_id, slide_index)` — lo stato si calcola con una query in più solo nella
lettura di UN artifact ("current version (vN)" / "superseded by vM").

**Budget dichiarato**: `ARTIFACT_SOURCE_MAX_CHARS = 60_000` sul sorgente TSX/HTML — oltre, si
taglia con lo stesso messaggio di `renderRunTrace` ("…[troncato: N caratteri in più...]") e
`read_file(offset:60000)` rilegge il resto (il `full:true` passato da `grep`/`offset` disattiva il
taglio, come per le tracce).

Test: `agent-files.artifacts.test.ts` (10 casi) con un fake Supabase che FILTRA e ORDINA
davvero (non solo canned data) — ordine desc su tre tabelle miste, formato riga, motion reso
(url + source), motion mai reso (stato onesto, zero url inventati), sorgente oltre budget
(taglio dichiarato), id inesistente (l'errore-che-insegna con `ls("artifacts/motion/")` come
prossimo passo), versioning grafica (superseded/current), grep per path esatto vs grep in blocco
dichiaratamente cieco. Tre mutazioni provate a mano (tolta la sezione Source, url inventato per
un non-reso, versione sempre "current") — ciascuna ha fatto morire il test giusto.
`npx vitest run src/lib/server/chat/agent-files*.test.ts src/lib/agent/`: 233/234 verdi (il fallito,
`vercel-sandbox.test.ts`, è un altro agente in corso su un file fuori dal mio terreno — riproduce
identico isolato, prima di questa modifica). `tsc --noEmit`: zero nuovi.

### Il Motion Specialist sul kit nuovo sa renderizzare, non solo promettere

Il sistema nuovo (`src/lib/agent/`) montava dodici tool builtin e nient'altro: il Motion Specialist
ci girava sopra senza un modo di produrre un MP4, quindi un trailer "pronto" era una promessa senza
file dietro. `src/lib/agent/plugins/motion.ts` è il primo `ToolPlugin` (interfaccia già definita in
`kit/interfaces.ts`, mai implementata) e avvolge — non duplica — il percorso di produzione
esistente:

- **`motion_write`** compila con `compileMotionSource` (`motion-video/compile.ts`) e fa girare GLI
  STESSI 5 controlli statici che `finish` impone in `motion-video/agent.ts` (entrata morta,
  movimento lineare, aritmetica della durata, fondale congelato, stasi) — un solo tool invece di un
  `finish` separato, quindi il punto di applicazione è il salvataggio stesso, non un passo finale.
  Un gate che blocca torna `isError` col messaggio che insegna, e non scrive niente. Se passa,
  salva con `persistCompiled` (`chat/motion-video-tools.ts`, ora esportata) — la stessa funzione
  dietro `create_motion_video`/`write_motion_source` in chat — e risponde con `status:
  'source_saved_not_rendered'`, mai `ok:true` con un'anteprima che non esiste.
- **`motion_render`** chiama `renderMotionMp4` per davvero, nella VM di produzione, e aggancia
  l'MP4 in galleria (`updateMotionPreviewUrl`). Il risultato porta l'url vero e i secondi di
  render; un fallimento torna l'errore intero del renderer (incluso il gate sulla voce), mai una
  sintesi.
- **`motion_stills`** e **`motion_list`** completano il mestiere: fotogrammi economici prima di
  spendere un render (`renderMotionStills`), e la lista delle composizioni esistenti del brand per
  riprendere a modificarne una.

Cablato in `bridge/live.ts`: il plugin si monta SOLO quando `spec.id === 'motion'` — gli altri
mestieri del kit non lo vedono. Non toccato: `executor.ts`/`builtin.ts` (il meccanismo di
risoluzione per nome dei plugin esiste già in `createApplyTool`) e le coreografie della chat
(storyboard-first, QC di craft asincrona, budget per turno) restano dove sono, in
`output-tools.ts` — il plugin è il render vero, non quella coreografia.

Test: `src/lib/agent/plugins/motion.test.ts` (9 casi) — import sbagliato di `@remotion/transitions`
rifiutato col messaggio del gate senza scrivere riga, sorgente valido salvato con lo status corretto
(mai `'ready'`), overwrite per id che mantiene il titolo esistente, id inesistente su
`motion_render` senza toccare il renderer, il renderer VERO mockato (`vi.mock` su
`render-tools.ts`) chiamato con l'id giusto e il risultato che propaga `preview_url`, un
fallimento del renderer che torna intero, e la risoluzione per nome dal vero `createApplyTool`
dell'executor. `npx vitest run src/lib/agent/ --reporter=basic`: 19 file, 168 test, verde.
`tsc --noEmit`: zero nuovi (stesso elenco preesistente).

### Il ragionamento diventa segmenti ordinati, non più un blocco unico in cima

Prima: `streamReasoning` era UN accumulatore (stringa unica nel client; colonna `chat_messages.
reasoning` concatenata al salvataggio), renderizzato UNA volta in testa al turno — sia in
`ChatLiveStatus` (dal vivo) sia in `assistantContentFromSteps` (`persistence.ts`, che pescava
`reasoningText` da OGNI step e li incollava tutti insieme prima di qualsiasi testo/tool). Un turno
che pensa → scrive → agisce → pensa → scrive perdeva l'ordine: entrambe le tranche di pensiero
finivano fuse in un solo blocco davanti a tutto.

Ora un segmento CHIUDE quando dopo i suoi delta arriva qualcos'altro (testo o tool call) e il
prossimo delta di reasoning ne apre uno NUOVO:

- **Live** — `chat-session.ts` aggiunge `foldReasoningEvent`, un fold puro che processa gli eventi
  SSE grezzi (stessi di `applyChatStreamEvent`, non toccato — resta la stringa piatta per gli altri
  chiamanti: `AgentComputerPanel`, i maker workbench) e produce `ChatReasoningSegment[]` posizionati
  come i tool call: non su `textLen` ma su `toolsBefore` (quanti tool esistevano quando il segmento
  si è aperto) — evita l'ambiguità quando un segmento si apre alla stessa lunghezza di testo di un
  tool call. `streamBlocks` (`chat-parts.ts`) fa il merge a due puntatori fra tool call e segmenti.
- **Persistenza** — `assistantContentFromSteps` non pesca più `reasoningText` da tutti gli step in
  testa: lo processa NELLO stesso passaggio ordinato di testo/tool-call, per step, unendo segmenti
  di reasoning adiacenti (niente altro atterrato fra loro) in un solo part. La colonna `reasoning`
  resta (letture altrove), ma i nuovi messaggi portano anche i part `{type:'reasoning'}` in `tool_
  calls`, in posizione.
- **Rendering** — `ChatBlock` ha un terzo tipo (`'reasoning'`), `messageBlocks` lo riconosce.
  `ChatLiveStatus`/`ChatColumn`/il thread `+page.svelte` montano `<ChatThought>` per ogni blocco
  reasoning nella sequenza (l'ultimo `live` solo se è davvero l'ultimo blocco e il turno gira).
  Fallback legacy invariato: righe vecchie con solo la colonna piatta mostrano UN blocco in testa
  (`msg.reasoning && !hasPositionedReasoning` — mai i due insieme).
- Non toccato: `applyChatStreamEvent`/`ChatStreamState` in `chat-stream-events.ts` (reducer
  condiviso con superfici fuori scope) e la coda in background (`queue.ts`, che non stream-a mai
  reasoning nel suo `livePartial` — già inerte prima di questa modifica).

Test: `chat-parts.test.ts` (+3, ordinamento `streamBlocks`/`messageBlocks`), `persistence.test.ts`
(+2, posizione e merge in `assistantContentFromSteps`), `chat-session.test.ts` (+5, `foldReasoning
Event` isolato + un turno SSE end-to-end pensa→scrive→agisce→pensa→scrive). Due mutazioni provate a
mano (chiusura del segmento disattivata, merge disattivato) — entrambe uccise. `tsc --noEmit`:
stessi 251 preesistenti, zero nuovi. `vitest` sui file toccati: verde.

### I test finti nei 422 file di `src/lib`/`src/routes`: due trovati, provati per mutazione

Il sospetto era che il parco test (422 file, ~61.000 righe) fosse pieno di specchi del mock. 9
sub-agent hanno triagiato l'intero parco in parallelo (spezzato per cartella), ognuno con l'ordine
di NON fidarsi di un sospetto senza prova di mutazione: mutare il codice di produzione dichiarato
sotto test, far girare il singolo file, e se resta verde è finto — sempre col revert immediato via
`git show HEAD:<path> > <path>`, mai `git checkout`. La resa è stata bassa — il parco è quasi tutto
vero — ma i due trovati erano genuinamente ciechi:

- `src/lib/server/market-rotation.test.ts` (48 righe, **cancellato intero**) — specchio del mock:
  `hashtagsForTick` era copiata verbatim nel test invece che importata (`+server.ts` non può
  esportare altro che handler HTTP, da cui la copia). Prova: mutato `src/routes/api/v1/market/
  trends/+server.ts:82` (`(hour * n) % all.length` → `0`, congelando la rotazione sempre sulla
  stessa fetta) — 6/6 test del file restavano verdi. Trovato e riprodotto indipendentemente da due
  sub-agent diversi. **Buco di copertura vero**: quella funzione ora non ha alcun test reale;
  andrebbe estratta in un modulo importabile per essere testata sul serio.
- `src/lib/server/custom-agents-split.test.ts` — **una sola `it()` rimossa** (31 righe, insieme
  all'helper `migrate()` diventato morto): un modello JS scritto a mano dei passi 2-3 della
  migration 0210, con un commento che lo ammetteva esplicitamente ("LA TRANSIZIONE, SIMULATA").
  Il test gemello nello stesso `describe` — che legge davvero `0210_custom_agents.sql` da disco e
  grep-a le clausole SQL — resta: è un test-contratto vero, non uno specchio.

Non cancellato ma segnalato come buco di copertura reale: `src/lib/agent/runtime/models.test.ts`
righe 59/73/85, tre `expect(model).toBeTruthy()` (deepseek/gemini/xiaomi) che sopravvivono alla
mutazione del model id reale (`DEEPSEEK_PRO_MODEL`, `GEMINI_FLASH`, `XIAOMI_MODEL` tutti mutati a
un valore sbagliato, 14/14 test comunque verdi) — un valore esatto era ottenibile, lo dimostra il
test gemello `kie` nello stesso file che controlla `.modelId`. Non cancellato perché il resto del
blocco esercita davvero il codice reale (percorsi d'errore compresi); è un'asserzione debole dentro
un test vero, non un test finto — fuori dal mandato di questa pulizia (che cancella, non ripara).

Nessun altro sospetto sopravvissuto al contraddittorio dei 9 sub-agent su tutte le altre 420
combinazioni file/cartella (server/, server/chat 56 file, server/motion-video + lib/motion-video
37 file esclusi i 15 rossi noti di `library.test.ts`, lib/agent 18 file con gli emulatori
sandbox/memory/brand-fs — pattern deliberato del modulo, non specchio —, lib/server/media-generator,
lib/server/harness, i 68 file sciolti in `src/lib/`, design/stores/realtime/i18n/data/models/
contracts/routes/remotion): tutti esercitano codice reale con valori esatti, o sono test-contratto
a grep incrociato fra file (wiring), non lo stesso file che rilegge sé stesso.

Bilancio: 2 file toccati, 79 righe tolte (48 cancellate intere + 31 da un file altrimenti vero).
`vitest run src/lib/` prima/dopo: stesso identico set di 15 rossi noti in `library.test.ts`,
nessuno nuovo, nessuno guarito. `tsc --noEmit`: stessi 251 errori preesistenti del censimento di
oggi, zero nuovi nei file toccati.

### Fase cancellazioni del censimento doppio-verificato: ~2.750 righe morte in meno

Un censimento passato ognuno da un avversario col compito di dimostrarlo vivo, poi tolto solo se
sopravviveva al contraddittorio. Tolti (con riverifica fresca di ogni voce, grep alla mano, prima
di cancellare — il tree si muove sotto un censimento fatto "stamattina"):

- 6 preset di stile mai importati da `presets/index.ts` né da altro: `ancora.ts`, `atelier.ts`,
  `neon.ts`, `passerella.ts`, `trama.ts`, `vetro.ts` (2.559 righe).
- `motion-video/title-block.ts` + test (zero importatori — la logica di stagger vive altrove).
- `knowledge-connectors/live.ts` + test (ricerca/lettura live di Drive e Notion, mai cablata).
- Il grafo della conoscenza intero: `KnowledgeGraph.svelte`, `knowledge-graph-layout.ts` (+ test),
  la route `app/[brand]/knowledge/graph/+server.ts` — nessuna pagina lo montava — e le 6 chiavi
  i18n (+ l'oggetto `graphKind`) che usava lui solo, in tutte e 4 le lingue.
- 10 componenti Svelte orfani: `SetupDialog`, `PainLanding`, `DashboardMobileNav`, `IconRow`,
  `StrategyTabs`, `PixelPattern`, `PageTipsBubble`, `PlanStatNum`, `GuidedTour`, `studio/StudioNav`.
- `chat/finish-guard.ts` + test (0 chiamanti).
- `server/onboarding-generate.ts` (1.058 righe, si autodichiarava LEGACY/retired nel proprio
  commento — nessun importatore vero, solo un commento che ne citava il nome).
- `design-compose.ts`: la vecchia `reviseGraphic` (righe ~274-304), soppiantata da
  `reviseGraphicSource` e senza altri chiamanti.
- `knowledge.ts`: `expandKnowledge`, `labelNeighbors`, `NODE_LABEL_SOURCES` (~115 righe) — il tool
  `expand_knowledge` era già stato smontato dal registro della chat il 23/8 con una lapide in
  `chat/tools.ts` che diceva "la funzione resta intera per un eventuale ritorno"; aggiornata quella
  lapide per dire che ora è sparita anche lei.
- La copia annidata `remotion-markup/remotion-maps/` (32 file, verbatim tranne la profondità dei
  link relativi) — già esclusa a runtime da `agent-files.ts`, il glob non si rompe sulla cartella
  assente perché matcha `**` su tutto l'albero.
- `@ai-sdk/anthropic` da `package.json` (mai importato in tutta la storia del repo).
- 2 file `vite.config.ts.timestamp-*.mjs` residui in root.

Rimandato: i 5 shim tiptap (richiedono `npm install`, e il dev server dell'owner è vivo — si tocca
al prossimo giro con l'installazione libera).

`tsc --noEmit` e `vitest run src/lib/` confrontati riga per riga prima/dopo: stesso set di 252→251
errori preesistenti (uno era dentro un file cancellato) e stesso identico set di 26 test rossi
preesistenti in 4 file, nessuno nuovo.

### Il thinking della chat non invade più il transcript

Il reasoning arrivava già separato dal testo dell'assistente e veniva persistito in `reasoning`,
ma la superficie live lo stampava ancora integralmente sopra la risposta. Questo rendeva visibile
un log interno e faceva spostare la conversazione mentre il modello pensava. Ora streaming e
replay usano la stessa riga di servizio compatta: stato `Thinking...` durante il turno, `Thought
about it` dopo, centrata come le azioni e apribile in dialog desktop o bottom sheet mobile. Il
contenuto continua ad aggiornarsi mentre il dialog resta aperto, ma non viene più mostrato in chiaro
nella chat. Nessun reasoning è stato eliminato o escluso dal salvataggio.

### Gli agenti ricostruiti sulla struttura di Rakazo: `src/lib/agent/`

Il proprietario, dopo il confronto col codice vero di `elie222/rakazo` (Apache-2.0): «facciamo un
hard reset del codice degli agents… architettura pulita, modulare, a plugin e swappabile». Il
confronto aveva misurato il divario: la nostra cartella chat (1,28 MB) pesa quanto TUTTA la loro
applicazione; il loro catalogo strumenti completo è 208 righe, il nostro `tools.ts` 249 KB.

Il modulo nuovo replica la loro forma, non il loro stack (Hono/Prisma/Graphile restano loro: noi
siamo SvelteKit su Vercel serverless):

- **`kit/`** — il contratto: tipi puri senza un solo import, interfacce (`AgentRuntime`,
  `ModelAdapter`, `SandboxProvider`, `MemoryStore`, `BrandFs`, `ToolPlugin`), registro tipato che
  rifiuta chiavi ignote nominando le disponibili.
- **`contracts.ts`** — un agente è UNA riga: `instructions` ≤ 20.000 caratteri (il loro numero),
  niente toolKeys nel dominio. E la macchina a stati del run con `waiting_input`/`waiting_takeover`
  PERSISTITI: un turno che aspetta l'umano resta vivo nel db e sopravvive al reload — il pezzo che
  la chat non ha mai avuto ed è il «non so se c'è qualcosa in bg» del 22/8.
- **`specs.ts`** — i cinque specialisti riscritti come righe di dominio, istruzioni ≤ 3.000
  caratteri per test di disciplina: il mestiere sta nei file `how/`, non nel prompt.
- **`tools/builtin.ts`** — 12 strumenti in 146 righe, dichiarativi, zero handler. `reply` e
  `ask_user` sono TERMINALI: parlare all'utente è un atto esplicito, non il default.
- **`executor.ts`** — un solo `applyTool` che smista su interfacce e plugin; ogni taglio dichiarato,
  ogni nome ignoto insegna i nomi giusti; il prompt fisso ha un tetto in caratteri che esplode in
  test (`SYSTEM_PROMPT_MAX_CHARS`), non in produzione.
- **`runtime/`** — il ciclo sopra `ai` v6 coi tetti riusati da `turn-limits.ts`; kie/deepseek/
  gemini/xiaomi come `ModelAdapter` registrati e swappabili per-agente.
- **`adapters/`** — la mossa che li rende testabili, presa di peso: OGNI adapter porta il suo
  emulatore (`sandbox-emulator`, `memory-emulator`, `brand-fs-emulator`) e i test girano lì, mai
  sulla rete. Gli adapter veri avvolgono i moduli esistenti (`sandbox.ts`, `brand-memory.ts`,
  `agent-files.ts`) senza duplicarne la logica.
- **`run-store.ts`** + migration `0216_agent_runs.sql` (tabella `agent_kit_runs`: `agent_runs` era
  già occupato dalla telemetria della 0106 — collisione trovata e schivata). Transizioni validate
  PRIMA di scrivere, UPDATE compare-and-swap sullo stato atteso, lease rinnovabile e `claimStale`
  per il reaper. **Da applicare a mano.**
- **`turn.ts`** — l'orchestratore: le tre uscite di un turno (reply → done col messaggio come
  payload; ask_user → waiting_input persistito; tutto il resto → la reason vera, e chi sta sopra sa
  che l'utente NON ha ricevuto un messaggio esplicito).

119 test, zero errori tsc, ~5.000 righe test compresi. Mutazioni provate su ogni pezzo (cap dei
tool, CAS del run-store, tetto del prompt, budget token: ognuna toglieva qualcosa e un test moriva).
NON ancora cablato nei motori di chat: convive con `src/lib/server/chat/` finché il collaudo non
pareggia, poi flag. Scartato: portare il loro stack; usare `pi-agent-core` come runtime oggi (il
nostro ciclo `ai` v6 coi tetti già collaudati resta; il contratto `AgentRuntime` lo rende
sostituibile domani in un file).

### «Conciso» non è misurabile: il contratto di consegna al posto dell'aggettivo

Il proprietario: «vorrei che scrivesse all'utente davvero il meno possibile, più concreto e solo
quando necessario fargli sapere qualcosa». L'istruzione **esisteva già**, in due file — `agents.ts`
(«Final replies: concise and actionable») e `system-prompt.ts` («Final replies to the user: concise
and actionable») — e non ha retto. Un aggettivo invita il modello al completamento statisticamente
probabile, e per un modello addestrato a essere utile quello è **spiegare**.

**Cosa dicono i numeri veri** (`chat_messages`, 30 giorni, 365 turni assistant, letti il 23/8):
mediana **137 parole** per turno, p75 269, p90 464, massimo 1.541 — non i «mille di mediana» che la
lettura in token suggeriva (mediana 1.481 token in uscita, ma quel numero conta anche gli argomenti
dei tool e il ragionamento, non solo ciò che la persona legge). Il resto della distribuzione dice
perché un tetto unico sarebbe stato lo strumento sbagliato:

- i turni fatti soprattutto di righe puntate stanno a **mediana 213 parole**, quelli in prosa a
  **84**: un tetto solo taglierebbe l'elenco di dieci post prima della prosa che lo circonda;
- le parole di **sola prosa** (righe puntate escluse) stanno a mediana **78**, p90 233 — cioè la
  prosa è già corta nella metà buona dei casi, e il problema è la coda;
- il **40,7%** delle parole di un turno non sta nel messaggio finale ma nei **segmenti di testo
  intermedi** (la narrazione fra un tool e l'altro), e il 42% dei turni ne ha più di uno.

Quindi niente numero: una **forma**, in `src/lib/server/chat/reply-contract.ts`, in **un posto solo**
letto da entrambe le teste. Cosa esiste adesso (con l'id, il formato, dove sta) → cosa non è andato
a buon fine (mai tagliato per brevità: chi non capisce perché sta peggio di chi legge tre righe in
più) → cosa serve dalla persona (solo se esiste solo nella sua testa, e allora con
`ask_user_questions`). Vietati: il riassunto di ciò che sta per fare, la spiegazione di come l'ha
fatto, l'elenco delle scelte creative, il riepilogo dei tool (l'utente li vede già come chip) e la
domanda di cortesia finale — con il **sostituto dichiarato**, perché un divieto senza sostituto è un
vuoto che il modello riempie: al posto della domanda non c'è niente, il turno finisce.

**La ragione vera non è il risparmio, è l'integrità.** «MP4 render: pronto, allegato al gallery» è
una frase che esiste solo perché c'era spazio per scriverla, ed era falsa (`production-claim.ts` la
intercetta *a posteriori*). `f5d3d281 · 8s · 1080×1080` non si può inventare: non c'è la sintassi.

**E la cosa da non rompere.** Il difetto misurato di questo prodotto è che si ferma troppo presto —
nove passi su settantacinque. Un modello a cui si chiede di scrivere meno può capire «lavorare
meno», e sarebbe il baratto peggiore possibile: l'ultimo paragrafo del blocco separa le due cose a
voce alta, con i numeri veri del budget, e `reply-contract.test.ts` **pinna quella separazione**
insieme al divieto di una seconda copia della regola.

Tolte anche le due righe `- When you change something, briefly explain what and why.`: erano
l'invito esplicito alla spiegazione di *come*, cioè la contraddizione che avrebbe fatto divergere il
blocco al primo turno.

**Non fatto, e sta al proprietario decidere**: `withOutputCeiling` (chat/model.ts) risulta applicato
a **ogni** modello che `resolveChatModel` restituisce, non a uno solo — ma vale il massimo
*pubblicato* del modello (128k su Luna, 384k su DeepSeek, 64k su Grok/Gemini): è una difesa contro
il troncamento silenzioso, non un budget, e abbassarlo taglierebbe a metà frase.

### La traccia di un turno che si svuotava da sola

`harness/persist.ts` serializzava tutti gli eventi in una stringa sola, ci passava la redazione e
riparsava; se il round-trip falliva, `?? []` scriveva una traccia **vuota** senza un log. Sul
database di produzione, ultimi 14 giorni: **19 sessioni su 146 della superficie `chat`** hanno
`event_count > 0` ed `events: []` (batch 0/123, room 0/23, consult 0/2 — è la chat perché ha gli
eventi più grossi, mediana 55 KB con punte da 1 MB). Adesso il tentativo intero resta il percorso
normale e, quando fallisce, si redige **evento per evento**: quelli buoni si salvano, quello che
rompe la serializzazione lascia `{ type: 'redaction_failed', index }`. Un buco dichiarato è
recuperabile; un array vuoto no, perché nessuno va a cercare la traccia di un turno che sembra non
averne prodotta.

### `query`: l'agente legge il database da sé, con i permessi dell'utente e di nessun altro

Il proprietario: «all'AI agent gli darei la possibilità di fetchare dati autonomamente da supabase,
ovviamente con la anon key, mai con la service key» — e poi «solo lettura». Nuovo tool `query`
(`src/lib/server/chat/query-tool.ts`), montato in `SHARED_TOOL_KEYS`, cioè in mano a ogni mestiere.

**Il fatto che ha deciso il disegno: la sola chiave anon vede ZERO righe.** Tutte e 141 le tabelle
di `public` hanno RLS attivo (verificato su `pg_tables`, 141/141) e nessuna policy di dati-di-brand
è aperta ad `anon`: una GET con la sola publishable key torna `42501 permission denied for function
auth_brand_ids`. Serve la chiave anon **più il JWT dell'utente**, che è esattamente ciò che manda
il browser. E allora la proprietà di sicurezza diventa esatta invece che approssimata: *l'agente
non può leggere niente che l'utente non potrebbe leggere aprendo l'app*. Non un permesso ridotto:
lo stesso permesso, imposto da Postgres e non da noi.

**La sola lettura non è controllata, è inesprimibile.** Un tool che accetta SQL deve rifiutare
tutto ciò che non è una SELECT, e non basta cercare `insert`: si scrive con
`with x as (insert …) select *`, con `select … into`, e chiamando una funzione `security definer`.
Quell'analisi non la so rendere sicura in modo *dimostrabile*, quindi non è stata scritta. `query`
parla PostgREST: `.from(t).select(cols)` è una `GET /rest/v1/<t>?select=…`, e non esiste la stringa
che diventa SQL. Le tre forme mascherate non vengono rifiutate da un parser — **non hanno dove
andare**, e il test lo verifica per la proprietà che conta: *nessuna richiesta parte*.

**`.rpc()` è escluso di proposito, e questa è la scoperta che l'ha reso obbligatorio.**
`get_advisors` segnala 35 funzioni `SECURITY DEFINER` eseguibili dal ruolo `authenticated`, fra cui
`notify_admin_email(subject, html)`. Montare `.rpc()` avrebbe rimesso in mano al modello una
scrittura — e una spedizione — coi privilegi del creatore. Sola lettura = solo `.from().select()`.

**Il timeout esisteva già ed è del database.** `pg_roles`: il ruolo `authenticated` porta addosso
`statement_timeout=8s` (`anon` 3s). Non è stato costruito nessun tetto sul tempo perché c'è già, a
livello di ruolo, e vale anche se questo file sparisse. È stato **dichiarato** — nella descrizione
del tool e nel rimedio dell'errore `57014` — e aggiunto solo il pezzo che il database non copre:
`AbortSignal.timeout(12s)` sulla connessione HTTP, volutamente più lungo di 8s così il 57014 arriva
al modello come un errore che insegna invece che come un abort muto.

**LA COSA PIÙ IMPORTANTE CHE È SALTATA FUORI: la coda costruisce i tool con la service role.**
`queue.ts:618` passa `admin` a `createChatTools`, e `cli-auth.ts` fa lo stesso sulla superficie
CLI. Un `query` che usasse il client d'ambiente lì avrebbe letto **ogni brand del database**, cioè
precisamente la cosa esclusa. Quindi `query` non si fida del client che riceve: chiede
`supabase.auth.getSession()` (locale, nessun giro di rete — `hooks.server.ts`) e senza sessione
**rifiuta**, spiegando perché. `createAdminClient()` nasce `persistSession:false`, quindi la
service role non ha mai una sessione: la coda cade lì per costruzione, non per convenzione.
Conseguenza dichiarata e non nascosta: **`query` funziona solo sui due turni interattivi**
(`app/[brand]/chat/+server.ts:495` e `api/v1/chat/respond/run/+server.ts:35`, che passano
`locals.supabase`). Un tool che «a volte legge tutto» sarebbe molto peggio di un tool che a volte
non c'è.

**Lo schema, e il conto in token.** Senza sapere cosa esiste, `query` è inutilizzabile. Non è stato
fatto un secondo tool né una sezione `schema/`: 141 nomi sono ~450 token, e nella descrizione si
pagherebbero a **ogni passo di ogni turno di ogni agente** per una lista che serve una volta a
conversazione. `query` senza `table` restituisce l'elenco; `query` con la sola `table` restituisce
righe vere, e **le chiavi di una riga SONO le colonne**. Costo pagato solo quando è chiesto, e un
test verifica che la lista NON sia nella descrizione.

**Gli errori insegnano.** `PGRST205` → il suggerimento di PostgREST («Perhaps you meant the table
'public.posts'», che è meglio di qualunque cosa possiamo scrivere noi) più come si elencano le
tabelle; `42703` → «chiedi la tabella senza colonne, le chiavi sono lo schema»; `42501` → «la RLS
nega, non c'è niente da riprovare»; `57014` → nomina gli 8s veri; `PGRST200` → «una tabella per
volta, gli id incrociali a mano».

**Il registro, che è l'errore che ha reso invisibile `sandbox_exec`.** Ogni chiamata scrive in
`ai_calls` con `label: 'db_query'`, `provider: 'internal'` — la stessa forma di `read_file`, quindi
`cost_usd` resta null e non tocca né crediti né rate limit — con tabella, numero di filtri, righe
rese su totale e durata. **Anche i rifiuti si registrano**: un tool sempre respinto deve risultare
*usato e respinto*, o la conclusione sbagliata è «non lo chiama nessuno».

**L'audit di sicurezza, prima di consegnare.** `get_advisors` security: zero lint di livello ERROR,
nessuna vista `SECURITY DEFINER`, nessuna tabella con RLS disattivo. Le uniche policy SELECT che
non richiedono l'utente sono intenzionali e non contengono dati di brand: il catalogo pubblico
`agent_templates` (solo `status='published'`), la tassonomia dei blog (`blog_authors`,
`blog_categories`, `blog_tags`, `brand_article_tags` — i blog sono siti pubblici), `talents` /
`talent_views` (solo `status='active'`), e `incidents` / `mcp_logs` che sono `service_role`, cioè
zero righe per un utente. **Nessuna tabella dove un utente autenticato veda righe di un altro
brand.** `brands` passa da `member_brand_ids()`. Resta aperto e NON introdotto da qui: 35 funzioni
`SECURITY DEFINER` eseguibili da `authenticated` via `/rest/v1/rpc/*` — raggiungibili già oggi dal
browser di qualunque utente loggato, e per questo `query` non monta `.rpc()`.

Caps dichiarati nel risultato, mai silenziosi: 20 righe di default, 100 massimo, 20.000 caratteri
per risultato e **2.000 per singolo valore**. Il taglio è **per riga intera** (mezza riga di JSON
non è un dato più piccolo, è un dato rotto) — ma il tetto per riga da solo non bastava: la prima
riga si prende sempre, o `select *` su `brand_documents` non tornerebbe mai niente e la scoperta
delle colonne morirebbe lì, quindi una riga con una colonna da 726.007 caratteri sarebbe entrata
intera. Da qui il tetto per valore, che **dichiara il nome delle colonne troncate**: un modello che
non sa di aver visto un testo monco costruisce la risposta come se fosse completo. E il totale è
dichiarato come stima del planner quando lo è. Formato: `120 rows of ~1043 — narrow with a where
filter or raise limit (max 100)`.

**IL COSTO, DICHIARATO — e la decisione è del proprietario.** `query` è in `SHARED_TOOL_KEYS`,
quindi la sua descrizione (~1.629 caratteri, **~407 token**) si paga a ogni passo di ogni turno di
ogni agente. Nell'entry qui sopra si sono tolti 6.215 token per passo: questa ne rimette dentro
407, cioè il 6,5% di quel taglio, in cambio di togliere il «non ho modo di saperlo» da ogni
mestiere. Se il conto non regge, la mossa è una riga: togliere `'query'` da `SHARED_TOOL_KEYS` e
metterlo nei `toolKeys` dei soli mestieri che analizzano (stratega, analista). Non è stato deciso
qui perché è una scelta di prodotto, non di codice.

Test: `src/lib/server/chat/query-tool.test.ts`, 22 casi. Undici mutazioni provate una per una
(guardia sugli identificatori aperta, cancello della sessione rimosso, tetto righe, tetto per riga,
tetto per valore, i due tagli non dichiarati, errore che non insegna, registro spento, stima non
dichiarata, mount rimosso): tutte e undici fanno diventare rossi i test, e il mount è guardato da
`agents.registry.test.ts`, che già rifiuta una chiave in `SHARED_TOOL_KEYS` che non corrisponde a
nessun tool.

### Un turno poteva costare 1.201.249 token: il tetto sui token, su tutti e quattro i motori

L'unico tetto di un turno di chat era `stepCountIs(75)` — settantacinque chiamate al modello, e
**nessun limite su quanto ognuna costa**. Il turno misurato: 1.201.249 token in ingresso, 582
secondi, finito senza che nulla dicesse perché.

`StopCondition` nell'`ai` v6 che abbiamo già riceve `{ steps }`, e ogni `StepResult` porta il suo
`usage`: un predicato che somma i token su tutti gli step e ferma sopra una soglia si scrive in
venti righe e si aggiunge all'array `stopWhen` che c'era già. È `chatTokenBudget()` in
`src/lib/server/chat/turn-limits.ts`, accanto a `chatTurnDeadline` di cui è il fratello mancante.

**La soglia esce dai dati, non dal pollice.** Su `ai_calls` (label `chat`, 21 giorni, 275 turni,
letto il 23/8): mediana **124.513** token in ingresso, p90 **478.534**, p95 **741.882**, p99
**1.776.626**, massimo **3.104.235**. I 6 turni sopra 1M sono il **2,2% dei turni e il 14% della
spesa** ($3,09 su $21,79). Il default è **1.000.000**, cioè sopra il ~97° percentile del traffico
vero: chi lo supera non sta lavorando di più, sta girando a vuoto. `CHAT_TURN_TOKEN_BUDGET` in
ambiente lo cambia; `0` lo spegne, ed è **l'unico** interruttore. Una variabile scritta male
(`Infinity`, `un milione`) ricade sul default e non toglie il tetto in silenzio — un budget infinito
non è un budget grande, è nessun budget, e nessuna riga di log lo direbbe.

**Si sommano ingresso E uscita di ogni step**, cioè i token *fatturati*: ogni step rimanda l'intera
conversazione, quindi lo stesso testo si paga a ogni giro. È esattamente ciò che misurava il turno
da 1,2M.

**Quattro motori, non due.** `queue.ts`, la chat viva (`app/[brand]/chat/+server.ts`), il percorso
CLI/MCP (`api/v1/chat/respond/run/+server.ts`) e la chat del post-editor
(`app/[brand]/content/[id]/chat/+server.ts`). Un tetto su una superficie sola è mezzo tetto.

**Quando scatta, si dice** — nei log (`token budget stop`, con usati/budget/step) e in chat, con una
riga che porta i numeri. Ed è il **primo** ramo della catena, sopra `deadline.expired`: un turno
lungo abbastanza da bruciare un milione di token ha quasi sempre finito anche il tempo, quindi messo
sotto non uscirebbe mai e l'utente leggerebbe «ho finito il tempo» per un turno fermato dal costo.

**Niente ripresa automatica**, come per lo stallo: riprendere un turno fermato per costo è il modo
più diretto di raddoppiare quel costo. Su queue.ts e sulla chat viva `shouldContinue` porta
`!tokenBudget.exceeded`, che batte anche il ramo degli obiettivi.

**Il caveat, scritto nel codice**: `stopWhen` è consultato **fra** gli step, mai dentro uno — non
tappa un singolo step impazzito. Per quello serve `maxOutputTokens`, e la direttiva sospettava fosse
applicato «solo a un modello»: **non è così**. `withOutputCeiling` (`chat/model.ts:161`) è applicato
a *ogni* modello che `resolveChatModel` restituisce, vision fallback compreso. Ma vale il **massimo
pubblicato del modello** — 128k su Luna/GPT 5.6, 384k su DeepSeek, 64k su Grok e Gemini — quindi è
una difesa contro il **troncamento silenzioso**, non un budget: un solo step può ancora produrre
384k token di uscita, e il predicato se ne accorge solo allo step dopo. Un tetto per-step vero
sarebbe un numero nuovo, non questo.

Test in `src/lib/server/chat/token-budget.test.ts` (19), col modello finto dell'SDK
(`MockLanguageModelV3`) che chiama uno strumento a ogni giro e **non finirebbe mai da solo**: se il
turno si ferma è perché il predicato l'ha fermato. Sei mutazioni provate una a una — non sommare
l'uscita, non fermare mai, lasciar passare `Infinity`, perdere la riga in `stopWhen`,
auto-continuare, mettere il ramo sotto quello del tempo — e ognuna fa fallire un test.

### `Output.object` per il contratto di consegna: guardato, misurato, NON costruito

La domanda era se un turno che dichiara una consegna possa essere costretto a portare l'id
dell'artefatto in un **campo** invece che in una frase. `Output` c'è davvero nel nostro `ai` v6 e
funziona. La risposta è comunque **no**, per tre fatti — due dell'SDK, uno del guasto:

1. **`responseFormat` non è dell'ultimo passo.** L'SDK lo attacca a **ogni** chiamata del ciclo
   (`node_modules/ai/dist/index.mjs:4646` per `generateText`, `:7634` per `streamText`). Misurato,
   non dedotto: il passo 0 di un ciclo con strumenti riceve già `{ type: 'json' }`. In chat vuol
   dire 75 passi in modalità JSON, cioè **niente prosa da trasmettere** su una superficie che
   trasmette markdown mentre il turno gira.
2. **Non esiste un punto dove rifiutare.** Il ciclo prosegue solo se l'ultimo passo ha prodotto
   chiamate a strumenti; un passo di solo testo chiude il turno comunque, e `stopWhen` può solo
   fermare prima, mai prolungare — già scritto e verificato in `goal-tools.ts`. `Output` cambia il
   *formato* di quel testo, non la possibilità di rimandare indietro il turno.
3. **Uno schema vincola la forma, non la verità.** I casi misurati in `production-claim.ts` sono un
   modello che copia in una frase un URL MP4 **vero**, letto da `list_motion_videos` nello stesso
   turno, e un modello che spunta un criterio dopo che lo strumento gli ha detto di no. Un campo
   `artifact_id: string` obbligatorio si riempie con lo stesso URL, dalla stessa lettura.

Quindi `Output` aggiungerebbe una cosa sola: uno **slot leggibile a macchina** al posto di una regex
sulla prosa (`production-claim.ts` ammette che «la lista non finisce mai»). E quella cosa in questo
repo ha già la sua forma compatibile con lo streaming e col ciclo: un tool `finish` con schema zod,
come `submit_review` in `video-review-agent.ts` — l'input di una chiamata a strumento **è** validato
dallo schema, **è** un passo, e il suo risultato è terreno solido che le guardie leggono già.

Non costruito, quindi. Ma il fatto 1 è pinnato in `src/lib/server/chat/typed-output.test.ts`: se un
aggiornamento di `ai` rendesse `output` valido solo sull'ultimo passo, il test cade e la domanda va
riaperta. La mutazione che lo prova: tolto `output:` dalla chiamata, il passo 0 torna a
`responseFormat` indefinito e il test fallisce.

### Il prompt di sistema perde 6.215 token a ogni passo: cinque tagli, misurati costruendo le costanti

Il system prompt della chat era 33.954 token su un brand vero (Anomalia, misurato il 23/8), e si
rispedisce **a ogni passo di ogni turno** — 75 passi per turno, più 9 continuazioni. Il proprietario
ha deciso cinque tagli (direttiva 22). Sono stati fatti tutti e cinque, ma non tutti come erano
stati scritti, e le due deviazioni sono dichiarate qui sotto.

**1. `disruptiveSystemSection()` fuori dal prompt → `how/DISRUPTIVE-IDEAS.md`.** 9.209 caratteri,
**2.302 token**, per una dottrina che morde quando si PROPONE — angoli, campagne, script, varianti —
cioè in una minoranza dei turni. Non è stata cancellata: è un file che si legge, con una riga di
indice che dice *quando*. **È una scelta di comportamento, non solo di costo**: l'agente non è più
spinto verso la proposta contraria a ogni passo, se la va a prendere. Il **banco idee** resta nel
prompt — sono le idee vive di quel brand, cioè un fatto, e senza il banco davanti agli occhi
`mark_idea_used` non verrebbe mai chiamato — ma le sue due righe che rimandavano ai «tre test» ora
nominano il file, o sarebbero state un puntatore nel vuoto. `read_disruptive_ideas`,
`save_disruptive_idea` e `mark_idea_used` restano montati e non restano orfani.

**2. `MOTION_CRAFT_SPECS` solo dove si scrive motion.** 24.274 caratteri, **6.069 token**. Dai due
head degli specialisti era già uscito il 22/8 (sono in `how/MAKE-MOTION-VIDEO.md`, con il cancello
di `REQUIRED_READS`): **restava nell'head dell'agente nullo**, che è quello di ogni thread senza
mestiere scelto. Tolto anche da lì. L'agente nullo vede il file nell'indice e le tre azioni che
scrivono il sorgente rifiutano finché non l'ha letto, quindi non perde il mestiere — lo paga solo
quando lo esercita.

**3. `GOAL_BLOCK` cancellato, le sue regole nelle descrizioni dei tre tool.** Qui la direttiva
correggeva sé stessa: spostare non risparmia, perché le definizioni degli strumenti si rispediscono
a ogni passo esattamente come il prompt. **Il risparmio è venuto dal fatto che erano già scritte due
volte**: `set_goal`, `update_goal` e `close_goal` dicevano quasi parola per parola quello che il
blocco diceva. Tolte 3.268 caratteri (817 token) dal prompt, aggiunti 1.148 (287 token) alle
descrizioni per le due sole regole che il blocco aveva in più — «finché è aperto non chiedi il
permesso» e «chiudere è una CHIAMATA, non un'etichetta nel testo». **Netto: −530 token a ogni
passo**, e una copia in meno da tenere allineata. `agent-base.ts` (le tre superfici che producono)
ora inietta solo l'obiettivo APERTO, che è un dato: le regole gli arrivano coi tool.

**4. Il documento del brand è un file: `brand/studio.md`.** `DESIGN.md` — identità, voce, palette,
tipografia, logo, direzione artistica, pilastri, prodotti, persone, indice della conoscenza,
concorrenti — si componeva a ogni turno nel prompt di ogni mestiere: **13.407 caratteri / 3.352
token** sul brand vero. Adesso lo compone `renderBrandStudioFile` (`chat/brand-file.ts`) chiamando
**la stessa `renderDesignDoc`** che stava nel prompt, quindi non nasce una seconda versione che
diverge. Nel prompt resta `## BRAND` (nome, sito, categoria, pilastri, preferenze video): il minimo
per parlare del brand e per non sbagliare i default di `create_post` senza aprire niente.

*Il rischio, dichiarato*: una lettura costa uno step, e uno step vale ~31.000 token fissi. Se
l'agente aprisse quel file a ogni turno avremmo speso 31.000 per risparmiarne 3.352. La condizione
perché paghi è che la maggior parte dei turni non ne abbia bisogno, e quella condizione la crea la
riga di indice che dice *quando* leggerlo (`Not needed to answer a question, navigate, or read data
back`), non la buona volontà. **Va misurato sui giri veri**: quante volte l'agente apre
`brand/studio.md` adesso che non ce l'ha nel prompt.

*Conseguenze strutturali*: `needStudioDoc` e `MAKER_AGENTS` sono stati cancellati (decisione
lasciata esplicitamente a questa sessione da chi ha riparato i pacchetti). Esistevano per dare a
`motion` e `ugc` il documento Studio pur senza pacchetto; da quando è un file, e i file non hanno
mestiere, governavano solo due `fetch` — prodotti e concorrenti — che per quei due mestieri nessuna
sezione renderizzava: due query a turno per nessuno. Cadono anche i `fetch` di `people` e
`brand_documents`, che il solo `DESIGN.md` leggeva.

**5. AI Act e Work Ethic: accorciati, NON fusi — ed è una deviazione dichiarata.** La direttiva
diceva di fonderli «semplificandoli». La fusione è stata **rifiutata, con la ragione**: l'AI Act è
un vincolo legale con una lista tassativa (Art. 5), Work Ethic è una postura di lavoro. Non si
sovrappongono in una riga, quindi fondere avrebbe risparmiato **un'intestazione (~15 token)** e in
cambio avrebbe messo la blacklist dentro un capitolo che si legge come consigli su come lavorare.
Il risparmio vero stava nell'accorciare, che è ortogonale al fondere: `aiActSystemSection()` da
4.997 a 4.577 caratteri, `WORK_ETHIC_BLOCK` da 3.012 a 2.728. **−176 token a ogni passo**, con ogni
pratica vietata, ogni dovere dell'Art. 50 e l'Art. 14 intatti — `ai-act.test.ts` li verifica uno per
uno e passa invariato. È meno dei ~600 che la direttiva ipotizzava: tagliare di più avrebbe
significato togliere righe che nominano un difetto vero, e ognuna di quelle righe è lì perché
qualcosa era andato storto.

#### Il conto, per mestiere e a ogni passo

Misurato costruendo davvero le costanti (`scripts/_prompt-size.ts` ricostruisce il prompt vero con
un client Supabase finto: quello che resta è lo SCHELETRO, cioè esattamente ciò che i cinque tagli
spostano). Le sezioni che dipendono dai dati del brand sono misurate sul prompt reale catturato il
23/8 alle 09:20.

| | tolto dal prompt | rimesso | netto a ogni passo |
|---|---:|---:|---:|
| dottrina dirompente | −2.302 | | |
| `GOAL_BLOCK` | −817 | | |
| AI Act + Work Ethic accorciati | −176 | | |
| `DESIGN.md` (brand vero) | −3.352 | | |
| indice file (2 righe nuove) | | +146 | |
| descrizioni `set_goal`/`update_goal` | | +287 | |
| **ogni mestiere** | **−6.647** | **+433** | **−6.215 token** |
| `MOTION_CRAFT_SPECS` (solo agente nullo) | −6.069 | | **−12.283 token** |

Sullo scheletro, prima → dopo, in caratteri: `content` 57.695 → 46.810 · `ugc` 44.992 → 33.431 ·
`motion` 48.188 → 36.816 · `web` 45.124 → 33.852 · `analyst` 45.187 → 33.898 · agente nullo 89.075
→ 53.421. La differenza fra questi delta e la tabella qui sopra (+1.240 caratteri circa) **non è
mia**: è l'`ORCHESTRATION_BLOCK` cresciuto e le righe READY aggiunte dalla sessione parallela che
stava riparando i pacchetti sugli stessi file.

#### E il controllo che rifiuta l'imitazione

`src/lib/server/chat/prompt-cuts.test.ts` — 46 prove. Ogni taglio ne ha **due gemelle e non una**:
«non è più nel prompt» **e** «è ancora raggiungibile», perché un taglio che toglie e basta non è un
alleggerimento ma un impoverimento, e i due si scrivono uguale. C'è l'andata e ritorno vero su
`brand/studio.md` (scrivo prodotti, persone, documenti, concorrenti, palette e voce nel database
finto; li rileggo dal file) e un **tetto per mestiere** sulla lunghezza del prompt: quando quel test
fallisce, la domanda giusta non è «alzo il tetto?» ma «cosa è rientrato dalla finestra?».

### La configurazione della sandbox non arrivava a nessuna VM che esistesse già

`Sandbox.getOrCreate` accetta `timeout`, `snapshotExpiration` e `keepLastSnapshots` — e li **ignora**
su ogni sandbox che esiste già: *«returns it with its existing configuration and ignores the creation
parameters you pass. To change the configuration of an existing sandbox, use `sandbox.update`»*
(docs/sandbox/concepts/persistent-sandboxes). I nostri nomi sono stabili per brand
(`anomalia-<brand>-<mode>-g2`), quindi **tutte** le sandbox dei brand attivi giravano con la
configurazione del giorno in cui erano nate, e `grep -rn 'sandbox.update(' src/` era vuoto.

Non è (solo) una questione di soldi: `render-tools.ts` divide `lease` fra installazione e render e
crede al numero che ha passato. Su una VM nata con un timeout più corto quel budget era finzione, e
il render moriva a metà — lo stesso sintomo di cui parla il commento a `render-tools.ts:86`.

Adesso dopo `getOrCreate` si confronta la configurazione vera della VM con quella richiesta
(`sandboxConfigDrift`, `sandbox.ts`) e si chiama `update` solo se divergono — su una sandbox appena
creata non diverge mai, quindi non c'è un round-trip in più.

**Il timeout si alza soltanto.** La sandbox è del brand e due turni girano in due processi diversi:
`update` documenta una sola direzione come sicura sulla sessione viva (*«When `timeout` is increased
and a session is currently running, the running session's deadline is also extended»*), e
sull'abbassamento tace. Tacere su una sessione altrui vuol dire non toccarla. Il tetto di un brand fa
quindi cricchetto verso l'alto fino a `SANDBOX_MAX_LEASE_MS` e non torna indietro: il costo dichiarato
è fino a `(lease − durata del turno)` di memoria a orologio per turno.

**`stop()` resta non chiamato, e stavolta con la verifica.** Il verdetto suggeriva di aggiungerlo
perché la ragione scritta nel codice («chi finisce prima spegne la sessione sotto i piedi dell'altro»)
sarebbe scaduta con `@vercel/sandbox` v2. Verificato nel nostro 3.1.0: il risveglio automatico esiste
(`withResume`, `dist/sandbox.js:615`) ma scatta **solo** su un errore HTTP 410/422 di una richiesta
*nuova* (`isSandboxStoppedError` = `status === 410`). Un comando **già in volo** quando arriva lo
`stop()` non viene ripreso da niente. La ragione quindi non è scaduta: è cambiata di forma, ed è più
stretta di com'era scritta. Nessuno `stop()` aggiunto.

**Il tetto vero, con il suo prezzo, accanto alla costante.** `SANDBOX_MAX_LEASE_MS` resta 15 minuti,
ma il tetto di piattaforma su Pro è 24 ore (96×) e ora è scritto lì insieme al motivo per cui non lo
usiamo: Provisioned Memory `iad1` $0,0212/GB-ora × 4 GB ≈ **$62/mese per VM accesa sempre**, e teniamo
due nomi per brand. Alzarlo è una decisione del proprietario, non di chi passa di lì.

### Il collaudo della catena minima, e i due secondi e mezzo su cui il gate della voce era cieco

Il proprietario ha chiesto due volte che il prodotto **funzioni davvero**, e la revisione forense
aveva stabilito che **nessun test percorreva la catena intera**: i cancelli avevano i loro test
(`easing.test.ts`, `voice-gate.test.ts`), il ricettario i suoi, il tetto aritmetico i suoi, la
libreria le sue venti voci — tutti verdi, e l'unico collaudo di *crea → renderizza → allega* restava
una prova a mano in chat, con un modello in mezzo che confonde le acque. Se la catena è rotta sotto,
nessuna riparazione del prompt si vede mai.

**`src/lib/motion-video/chain.test.ts`** la percorre senza il modello. Il sorgente è una costante:
il seme di `create_motion_video` senza `source` (la funzione pura che lo produce) e
`posts/1-carousel-pullback`, una voce della libreria già cotta con il suo MP4. Sette anelli, un `it`
ciascuno, e il nome del test è la riga che si legge quando si rompe. Comando:
`npm run check:motion-chain`.

**Cosa ha trovato al primo giro.** `readSourceMeta` leggeva `durationInFrames` con una regex sui
soli **letterali** (`export\s+const\s+durationInFrames\s*=\s*(\d+)`), e il commento sopra la
funzione affermava che «il contratto TSX li impone come export letterali». Non è vero, e non lo è
proprio dove conta: **17 voci su 20** della libreria di animazioni — quelle che l'agente è istruito
a *copiare* — calcolano la durata (`Math.round(BEAT * fps) * STEPS`). Su tutte e diciassette la
regex non trovava niente e vinceva il fallback, che dentro `renderMotionMp4` è il letterale **180**.

Quindi `assertMotionVoiceGate` — il cancello nato dopo il trailer del 21/8 con la voce troncata a
metà parola, quello che «è aritmetica sui frame e gira sempre» — misurava un video da 6 secondi
mentre dalla VM ne usciva uno da **3,67s** (`transitions/1-slide-up`, 110 frame) o **5,8s**
(`posts/1-carousel-pullback`, 174 frame). Due secondi e mezzo di scarto sono esattamente lo spazio
in cui una battuta viene mozzata **senza che il gate che esiste per impedirlo dica niente**: la
copertura si calcola sulla durata sbagliata, e `checkVoicePlacement` confronta la fine della voce
con un `durationInFrames` inventato. Nell'altro verso lo stesso difetto rifiuta un video buono.

La riparazione sta dove tutti i chiamanti passano: quando l'export **c'è ma non è un letterale**, si
**esegue il modulo** con `compileMotionSource` — gli stessi export che il `ROOT_TSX` passa a
`<Composition>`, quindi i numeri giudicati sono per costruzione quelli renderizzati. Scartata la
riparazione nel solo `renderMotionMp4`: `output-tools.ts`, `agent.ts` e `tools.ts` leggono la stessa
funzione e avrebbero continuato a mentire ognuno per conto suo.

La guardia `declares()` è la parte che non si vede e che serve: se il nome **non è dichiarato
affatto**, vince il fallback del chiamante e non i default di `compileMotionSource` (30/180) — in
`agent.ts` quel fallback è `motionFramesForDuration(duration)`, cioè 450 frame per un video da 15s
scelto nel picker, e prenderne 180 avrebbe accorciato la bozza di due terzi. Il test esistente
passava per coincidenza (usava proprio `{30, 180}` come fallback): ora ce n'è uno che usa numeri
diversi apposta.

**Perché il collaudo non renderizza, e dov'è il secondo livello.** `renderMotionMp4` apre una
microVM, scrive nel bucket `media`, aggiorna `motion_videos` e scala i crediti del brand: una spesa
e tre scritture in produzione, l'opposto di ciò che deve fare un test che gira a ogni
`npm run test:unit`. La prova che quel sorgente **renderizza** si versiona già —
`bake-manifest.json`, scritto dalla stessa VM del render di produzione, con l'impronta del sorgente
cotto — quindi l'anello 6 verifica quella, e cade dicendo quale comando ricuocere. Il secondo
livello, esplicito e a richiesta, è quel comando: `FORCE=1 npm run bake:motion-library -- <voce>`.
Non ne è stato costruito un secondo: sarebbe stato lo stesso render con un nome nuovo, senza
database e senza crediti già oggi.

**L'anello 7 dichiara ciò che manca.** Verificato in produzione (sola lettura, 23/8):
`select count(*) from posts where media_url ilike '%motion%'` → **0 su 483 post**, e in
`information_schema.columns` nessuna colonna di `posts` punta a `motion_videos`. Nessun tool accetta
un url arbitrario per `media_url`: `render_motion_video` scrive `motion_videos.preview_url` e
finisce lì. La catena si ferma **un anello prima della consegna**: si può fare un video, non si può
pubblicarlo. Il test non finge che passi — asserisce che l'anello **manca**, così il giorno in cui
qualcuno lo costruisce è questo test a cadere e a chiedere di essere riscritto in positivo.
Costruirlo è una scelta di prodotto e va dal proprietario, quindi qui non è stato fatto.

Ogni anello è stato verificato con una **mutazione**: rotto il codice sotto, il suo `it` diventa
rosso (e la mutazione su `compileMotionSource` ne fa cadere sette, che è ciò che deve fare una
catena). Una l'ha già trovata da sola: il collaudo era rosso sull'anello 4 prima della riparazione.

**Un difetto che il collaudo ha visto e non ha chiuso.** `compileMotionSource` accetta il componente
anche come `exports.MotionVideo` / `exports.MotionAd`, mentre il `ROOT_TSX` della VM fa
`import MotionVideo from './Video'` — **solo il default**. Un sorgente con `export function
MotionVideo` e nessun `export default` supera quindi il compilatore e muore in VM con un componente
`undefined`: la stessa classe dei due render esplosi con `(0, esm_namespaceObject.slide) is not a
function`, dove compilare passava e renderizzare no. Oggi non morde (26 righe di `motion_videos`,
**zero** senza `export default`), quindi l'anello 1 lo *rifiuta* invece di stringere il compilatore
— stringerlo avrebbe rotto anche la lettura e la patch di un eventuale sorgente già salvato.

### Le primitive dei file non mentono più: sette difetti chiusi, `glob` che nasce, e un `grep` da 20 secondi che ne diventa uno

`read_file`, `ls` e `grep` sono la porta da cui passerà tutta la migrazione dei quindici `read_*`.
Il difetto che li accomunava non è l'imprecisione: è che **producevano risposte sicure e false**, e
ognuno si sarebbe moltiplicato per quindici. Misurati sull'albero del 23/8 (153 file più le
aggiunte in corso), chiusi qui prima di spostarci dentro qualunque dato.

**1. `grep` esauriva il tetto sul primo file.** Il cap era globale (`matches.length >= cap` →
`continue`), quindi `useCurrentFrame` — che esiste in **72 file su 216 righe** — tornava **12
risultati tutti dallo stesso file**, con «152 file non guardati» accanto. È la *radar source
starvation* riapplicata ai file: chi sta in fondo all'elenco non esiste mai. Adesso è una passata
per raccogliere e un **round-robin** per servire: stessa query, **12 file distinti**, e il resto
dichiarato come righe (`204 righe in più`), non come «fermato a 12».

**2. `grep` dichiarava una copertura che non aveva.** `scope` emetteva `targets.length` mentre
`searched_files` accanto diceva 1 — il tool affermava «cercato in tutti i 153 file» avendone letto
uno. Adesso `scope` porta `searched`, e nomina anche i file **non leggibili** invece di saltarli in
silenzio.

**3. `grep` su un prefisso sconosciuto restituiva un ERRORE.** È il difetto peggiore delle
primitive, perché un modello legge un errore come *«quella cosa non esiste»* e **chiude l'indagine**
invece di spostarla. «Non esiste» è un fatto sul mondo, «non ho guardato» è un fatto sullo
strumento: adesso torna un risultato normale con zero righe e un campo `blind` che dice la seconda,
più i prefissi veri. Stesso ramo copre il mestiere il cui albero è ancora vuoto — dove l'errore era
la norma, non l'eccezione.

**4. Gli accenti.** Mancava `.normalize()` su entrambi i lati: «però» in NFC e in NFD sono due
stringhe diverse per `includes()`, e il sintomo è «il file non contiene quella parola». Oggi il
corpus è documentazione Remotion in inglese e il difetto è latente; **domani sono didascalie e nomi
di prodotto presi dal database e dagli scrape**, dove le due forme convivono. `fold()` normalizza e
toglie i segni su entrambi i lati, quindi `perche` trova `perché`: `grep` è uno strumento di
scoperta, e qui allargare è l'errore giusto.

**5. `read_file` non aveva `offset`/`limit`.** 30 chiamate su 36 a `read_motion_source` passano
`start_from` e 33 su 36 `max_chars`: senza paginazione quella conversione perde il modo in cui il
tool viene usato davvero. Aggiunti, con `next_offset` e `chars` **dichiarati solo quando si
impagina** — chi legge intero non paga niente. E il default resta il file intero, di proposito.

**Il corollario che sarebbe stato un buco serio**: `how/MAKE-MOTION-VIDEO.md` sono 67.726 caratteri
ed è obbligatorio prima di ogni scrittura motion. `hasReadFile` controllava che la lettura fosse
*riuscita*, non che fosse *completa*: con `limit: 2000` il cancello si sarebbe aperto sul 3% delle
specifiche. Adesso **una lettura impaginata non apre il cancello**.

**6. La descrizione di `read_file` inlinava `mine`**, che per `web` e `analyst` è **vuota**: quei
due mestieri leggevano `Yours: .` a ogni singolo passo, cioè una descrizione che dice «non hai
niente da leggere» a chi ha un tool per leggere. Via l'elenco, resta il conteggio — vero per tutti,
e non cresce con l'albero. Il test lo pinna come proprietà: la descrizione **non contiene nessun
path**.

**7. `LS_CAP = 60` senza filtri.** Dichiarare «60 di 1.000» è onesto e inutile: l'agente sa che gli
manca qualcosa e non ha modo di andarselo a prendere. `ls` prende `query` (sui path, senza accenti)
e `limit`; il taglio resta dichiarato quando morde.

**E `prefixesOf` insegnava prefissi che non funzionano**: `p.split('/').slice(0,2)` su un path a due
segmenti rendeva `how/MAKE-MOTION-VIDEO.md/`, che l'agente copia-incolla e che non elenca niente —
lo stesso danno del rifiuto che voleva evitare. Il test adesso prova ogni prefisso suggerito
passandolo davvero a `ls`.

#### `glob` nasce, e la ragione non è il risparmio

Un giro precedente aveva concluso che «se `ls` accetta un prefisso, `find` non serve». Con 153 file
non regge: `ls` risponde a *«cosa c'è qui»*, `grep` cerca **dentro** i file, e fra le due mancava il
modo di trovarne uno **per come si chiama**. Sedici caratteri di regex (`*` dentro un segmento, `**`
attraverso le cartelle) invece di `minimatch`, che non è installato.

#### Il crash che era lì da sempre

`AGENT_FILES['constructor']` non è `undefined`: è `Object.prototype.constructor`. Passava `if (!f)`
e moriva su `f.body()` con un **TypeError non catturato dentro `execute`** — verificato su
`constructor`, `__proto__`, `toString`, `hasOwnProperty`. Il traversal `../` era impossibile per
**assenza della chiave**, non per costruzione: adesso c'è la costruzione (`Object.hasOwn`), in
`resolve` e nella `readAgentFile` esportata.

#### Il bucket globale, prima che diventi una fuga fra clienti

`readOverride` scaricava `overrides/<path>` da un bucket **senza brand id**, e l'override **vince
sul codice**. Oggi innocuo — nel registro c'è solo materia di prodotto. Il giorno in cui la
migrazione fa nascere `brand/products.md`, **un solo oggetto servirebbe gli stessi prodotti a tutti
i brand**, in silenzio e con l'aria di funzionare. Adesso è un elenco chiuso (`how/`, `skills/`,
`library/`), con un test che si accende **il giorno in cui un path di brand entra nel registro**,
non il giorno in cui qualcuno se ne accorge in produzione.

#### 20.056 ms → 1.074 ms, e il secondo `grep` 12 ms

Misurato, non stimato: un `grep` senza risultati su tutto l'albero chiamava `download()` su ogni
file — 153 round trip verso un bucket **vuoto**, cioè venti secondi per sentirsi dire «niente». Il
tetto globale lo nascondeva finché la query aveva molti risultati; col tetto per file la scansione
intera diventa la strada normale, quindi andava chiuso **prima**. Si chiede **una volta** quali
cartelle esistono sotto `overrides/` (promessa memoizzata, TTL 60s) e si scarica solo per quelle:
prima chiamata 1.074 ms, successive **12 ms**. Bucket assente o migration 0214 non applicata →
insieme vuoto → zero download, la stessa degradazione di prima senza l'attesa. Prezzo dichiarato: un
override appena caricato si vede al massimo un minuto dopo.

#### Il troncamento che prometteva un'uscita inesistente

`renderRunTrace` taglia una traccia a 24.000 caratteri dicendo *«usa grep su questo stesso
percorso»* — ma `grep` passava dalla **stessa resa** e riceveva il testo già tagliato. Adesso `grep`
e chi impagina risolvono con `full: true`: la porta indicata si apre davvero.

#### La telemetria, che va messa PRIMA del primo taglio

`ai_calls` aveva righe `read_file` e **zero** `ls`/`grep`: il passo di **scoperta** — l'unica
variabile che decide se la migrazione guadagna o perde — era invisibile agli strumenti con cui tutto
è stato misurato. Adesso `ls`, `grep` e `glob` scrivono la loro riga, con la chiave normalizzata sul
prefisso e non sul path (o la cardinalità esplode al primo path dinamico).

**Le rinomine della direttiva 21 NON entrano qui, ed è una scelta.** `read_file` → `read` mentre
esistono **49 definizioni `read_*`** in questo repo (contate, non stimate) non crea una gerarchia:
crea una cinquantesima sorella con un nome più corto. L'argomento della direttiva — *«con `read` e
basta la gerarchia si vede dal nome»* — è vero **solo dopo** che i quindici sono spariti, quindi le
rinomine vanno nella stessa fetta della loro sparizione. `glob` invece è nuovo, non rinomina niente
e apre una domanda che oggi non si può fare: entra adesso.

**Test**: 12 nuovi in `agent-files.test.ts` (uno per difetto, tutti sulla **proprietà** e non sui
numeri — l'albero cresce a ogni voce) e 3 in `agent-files-override.test.ts`. `logAiCall` è mockato:
prima questi test scrivevano davvero nella Supabase di produzione a ogni giro.

### Lo specchio del brand nella sandbox: due file su otto non si scrivevano, e `history.csv` produceva zeri con metodo citabile

`brand/` — i dati del brand materializzati come file dentro la VM dell'agente — esiste da tre
giorni. Cinque difetti, tutti della stessa famiglia: **uno stato che non si dichiara**. Nessuno era
diagnosticabile da dentro la VM, che è ciò che li rendeva pericolosi invece che rumorosi.

**1. `history.csv` restituiva mediana 0,0 e la faceva sembrare una misura.** `social_post_history`
ha due fonti con metriche **incompatibili**, misurato in produzione: `engagementRate` sta su
**376/376** righe `zernio` e su **0/3.131** righe `scrapecreators`; `saves` idem; `reach` su
**0/3.507**, cioè su nessuna fonte e nessun brand. E **22 brand su 29** non hanno una sola riga
`zernio`. Il CSV scriveva comunque l'intestazione `engagement_rate`, quindi lo script di una run
vera — `float(r['engagement_rate'] or 0)` — leggeva celle vuote come zeri, calcolava **mediana 0,0
su ogni piattaforma** e la riportava in un rapporto che dichiara *«METHOD: script Python su
brand/history.csv»*. Dalla VM non c'era modo di accorgersene: la colonna che l'avrebbe detto —
`source` — non era nel file.

Tre cose, e la prima è quella che conta: `source` va in colonna; le righe si deduplicano riusando
`dedupeSocialHistory` di `social-history-metrics.ts` (lo stesso post esiste due volte fra le fonti,
26 gruppi misurati — senza dedup un `count(*)` per piattaforma conta doppio); e **una colonna che
nessuna riga valorizza non viene scritta affatto** (`describeColumns`). Non è cosmesi: in
`csv.DictReader` una chiave assente alza `KeyError`, che è rumoroso, mentre una cella vuota diventa
zero in silenzio. Quelle valorizzate solo in parte restano, con la loro copertura dichiarata nel
README accanto al file (`engagement_rate 1/2`) e con scritto che le due fonti non portano le stesse
metriche.

Scartato: filtrare `.eq('source','zernio')`. È la strada che il `LEARNING-POINT CONTRACT` impone ai
learning point, ma qui svuoterebbe il file per 22 brand su 29 buttando 3.131 righe di post veri del
brand. Il file serve a **contare**, non ad allenare: la separazione la fa la colonna, non il filtro.

**2. Due file su otto non si scrivevano da quando `brand/` è nato**, e il README diceva che il
brand non aveva quel dato. `posts.content` non esiste (la colonna è `caption`) e
`brand_strategy.gtm_plan`/`.status` non esistono (la tabella ha `report, benchmark, positioning,
citations`): PostgREST rispondeva **42703**, supabase-js risolveva con `{data: null, error}` —
**non lancia mai**, quindi il `catch` di `attempt()` non si accendeva — e `if (!data) return`
ingoiava tutto. Il README è onesto per costruzione, elenca solo ciò che è riuscito, quindi l'agente
leggeva «questo brand non ha una strategia» davanti a un guasto e concludeva in buona fede.

Ora ogni query legge `error` e un guasto diventa una riga `⚠ … NON caricato (42703) — è un GUASTO,
non l'assenza del dato`. **Un file mancante per bug e un file mancante per assenza di dati devono
leggersi diversi.** `posts` usa un **alias**, `content:caption`, non una rinomina: `p.content` è
letto due volte più sotto (`chars` e `caption`), e rinominare solo la select avrebbe materializzato
`posts.csv` con `chars = 0` e caption vuota su 200 righe — da «assente e visibile come assente» a
«presente e silenziosamente a zero», che è il modo peggiore di fallire. Aggiunta anche una riga
`generato: <ISO>` in cima al README: prima diceva *«rigenerati adesso»* e non stampava l'istante.

**3. Ogni `sandbox_exec` era gratis per il brand e invisibile in bolletta.** `SandboxUse = 'agent'`
esisteva nel tipo e non aveva **un solo chiamante**: il render dei motion video si addebitava, la
shell dell'agente no, pur accendendo la stessa macchina. L'addebito si chiude su `close()`, che è
l'unico punto per cui passano tutti e tre i chiamanti (subagents, queue, agent-base), nello stesso
registro di tutto il resto (`ai_calls` + `flatCostUsd`). **Tetto dichiarato**: si misura apertura →
`close()`, non il lease, quindi è un **limite inferiore** — la VM resta accesa fino al suo timeout
(vedi 5). Il numero esatto sarebbe `sandbox.activeCpuUsageMs`, che l'SDK popola solo dopo uno
`stop()` che non facciamo. Meglio un pavimento dichiarato che uno zero.

**4. Il 32,1% dei secondi di sandbox misurati non era addebitato a nessuno.** `computeCostUsd`
azzerava `flatCostUsd` quando `ok = false`. Regola giusta per Tavily, che non ci fattura una
ricerca fallita; sbagliata per una microVM, che è stata accesa comunque e ha consumato tempo
macchina. L'effetto era che **il percorso che costa di più era l'unico gratuito**, cioè l'invito
letterale a riprovare all'infinito — la prima cosa che fa un agente in loop, e il precedente in
casa è l'incidente di onboarding del 13 luglio (42 ore, ~$365). `sandbox-credits.ts` lo dichiarava
già a parole (*«si addebita anche quando il render fallisce»*) e questa riga lo smentiva in
silenzio. L'eccezione sta in `computeCostUsd` e non nel chiamante: è lì che passano tutte le righe.

**5. `release()` non spegne la macchina, e resta così — ma ora la ragione è scritta.** I docs Vercel
raccomandano l'opposto (*«Call sandbox.stop() when done rather than waiting for timeout»*) e il
divario è reale: mediana di un turno **40,6 s** contro un lease che dura sempre fino a **900 s**. La
ragione per non spegnere però esiste ed è concreta: la sandbox è del **brand**, due turni dello
stesso brand vivono in **processi diversi**, e chi finisce prima staccherebbe la corrente all'altro
a metà comando. Non c'è nessun refcount fuori processo che sappia dire «sono l'ultimo». Quindi la
decisione è confermata, il compromesso è dichiarato per esteso accanto a `release()`, e lo
spegnimento esplicito diventa lecito solo il giorno in cui quel contatore esiste (Postgres o Redis,
per nome di sandbox, `stop()` a zero — cioè infrastruttura: finché non serve, non si fa). Un test
rifiuta l'imitazione: uno `.stop()` nel codice di `sandbox.ts` fa fallire la suite invece che un
comando di un altro turno in produzione.

Non fatto, e dichiarato: `chmod -R a-w brand` dopo le `add()` (il guardrail su `brand/` è ancora un
cartello — `sandbox_exec` valida solo la `cwd`, con `rejectReadPath`, che la clausola su `brand/`
non ce l'ha), e il tracer `surface = 'chat_subagent'` che scrive zero righe su 294 sessioni.

### Il registro degli agenti: sei strumenti irraggiungibili, otto inerti, nove conflitti nel prompt

Tre difetti diversi, tutti della stessa famiglia — **una dichiarazione senza un controllore** — e
tutti verificati sui dati veri (`chat_messages.tool_calls` filtrando `type = 'tool-call'`, non con
una `LIKE` sul testo: il conteggio ingenuo su quella colonna sbaglia di 735 blocchi `text`).

**1. Sei strumenti che nessuno specialista poteva raggiungere.** Non stavano né in
`SHARED_TOOL_KEYS` né nelle `toolKeys` di nessuno dei cinque mestieri: li montava solo l'agente
nullo (onboarding e legacy). Chiamate in 60 giorni: `propose_plan` **5**, `save_social_handles`
**1**, `expand_knowledge` / `update_competitor` / `update_document` / `update_mood_references`
**0**. «Mai chiamato» qui non voleva dire «inutile», voleva dire «montato su nessuno» — e per due
di loro il prompt li ordinava comunque a tutti.

| tool | destino | perché |
|---|---|---|
| `propose_plan` | → `SHARED_TOOL_KEYS` | `PLAN_DOC_BLOCK` (chat-modes.ts) dice a ogni mestiere, in Agent **e** in Plan, «il tuo DEFAULT è chiamare `propose_plan`». Cinque teste su cinque leggevano il default di un tool che non avevano. Un piano non è di un mestiere: è di chi ha in mano una richiesta grande |
| `update_competitor` | → `analyst` | la sua descrizione dice chi legge quella lista («the strategy and market-reference jobs read this list»), e quei job sono suoi: era l'unico che guardava i concorrenti a ogni turno e non poteva correggerne uno sbagliato |
| `update_document` | → `content` | `add_document` è lì; chi crea un documento è l'unico che possa poi rinominarlo, ricollocarlo o cancellarlo |
| `update_mood_references` | → `content` | sono le tre immagini che orientano OGNI visual generato: stessa famiglia di `update_brand_kit` / `update_logo`, stesso mestiere |
| `save_social_handles` | resta all'onboarding | l'unico prompt che lo nomina è `onboarding-chat.ts`, che gira con `agent: null`. Corretto com'è |
| `expand_knowledge` | **cancellato** dal registro chat | 0 chiamate, nominato da nessun prompt, e pretende un `id` uuid che l'agente può avere solo da un'altra lettura. Per «cosa c'è scritto su X» esistono già `search_knowledge` (23 chiamate) e `read_document` (7). `expandKnowledge()` resta intera in `knowledge.ts` — questo era il suo unico chiamante, il ritorno sono otto righe |

Aggiunto anche **`add_document` a `SHARED_TOOL_KEYS`**: era del solo Content Creator mentre i tre
`read_*` dei documenti erano di tutti, e il blocco di modalità dice a chiunque «non sono conoscenza
finché non li salvi con `add_document`». Un PDF allegato in una chat UGC non aveva strada per
entrare.

**2. Otto nomi INERTI dentro `SHARED_TOOL_KEYS`.** `delegate_task`, `run_task_pipeline`,
`run_parallel_tasks` e i cinque `sandbox_*` stavano nell'elenco condiviso e non montavano niente:
`pickTools` filtra `Object.keys(tools)`, e in produzione il suo argomento è **solo**
`createChatTools` — quei tool nascono dopo, da `withSubagentTools` e `withSandboxTools`, che li
aggiungono al set già filtrato (`chat/+server.ts:1079` e `:1093`, `queue.ts:675` e `:689`). Restano
trasversali per **costruzione** (nessuno dei due wrapper guarda l'agente), non per dichiarazione.

Il test di registro non se ne accorgeva per una ragione precisa: costruiva un unico `ALL` fondendo
i tre gruppi e passava quello a `pickTools`. Si dava da solo la risposta che stava verificando.
Adesso monta **nell'ordine della produzione** (`mountedFor()` = `pickTools(CHAT, id)` → `SUBAGENT`
→ `SANDBOX`) e ha due asserzioni nuove che rendono impossibile ricascarci: *nessuna chiave in
`SHARED_TOOL_KEYS` è assente da `createChatTools`*, e lo stesso per le `toolKeys` di ogni mestiere.

**3. Nove conflitti diretti nel prompt** — due frasi che, seguite entrambe alla lettera, portano ad
azioni diverse. Per ognuno: chi vince e perché.

1. **La consegna di un media.** `SHOW_MEDIA_BLOCK`: «il turno finisce con `show_media`, mai con il
   suo indirizzo — un indirizzo scritto nella risposta è un DEFECT». Le capabilities di `motion`,
   1.900 caratteri dopo: «Preview lives at /…/motion-video — `propose_open_tab` it once the
   composition is ready». In produzione ha vinto quella sbagliata: **`show_media` 0 chiamate in 60
   giorni, `propose_open_tab` 15**. Vince `show_media` (la consegna), e la pagina torna a essere
   quello che è: l'editor, da aprire solo se l'utente lo chiede.
2. **`web` non aveva `show_media`.** Era l'unico dei cinque, e `SHOW_MEDIA_BLOCK` sta in **tutte**
   le teste: leggeva il divieto senza avere l'alternativa, mentre produce copertine d'articolo. Ora
   ce l'ha.
3. **Da dove nasce un criterio.** `set_goal`: «un criterio non viene MAI dal tuo mestiere; se
   sarebbe vero per qualsiasi altra richiesta, non è un criterio». La riga **READY** in cima alle
   capabilities di ogni mestiere è esattamente questo — «drafts sitting in pending with caption AND
   visual», «RENDERED to MP4» — ed è la definizione di *consegnato*. Sotto la vecchia regola andava
   scartata, cioè un obiettivo poteva chiudersi su un abbozzo. Adesso le fonti sono **due e non
   tre**: la richiesta e la riga READY; il metro resta per tutto il resto.
4. **Il permesso, dentro un obiettivo.** `set_goal`: «finché è aperto non chiedi il permesso di
   andare avanti, mai finire il turno su una domanda». `WORK_ETHIC_BLOCK`: «proponi invece di fare
   solo a un vero cancello di decisione: pubblicare, spendere oltre, distruggere, pagare». Vince il
   cancello — quelle azioni sono irreversibili — e ora è scritto come l'unica eccezione.
5. **Le scelte.** `WORK_ETHIC_BLOCK`: «una SCELTA non è una domanda: scegline una e falla». La riga
   di `role`: «per le scelte usa `ask_user_questions`». Vince l'etica del lavoro (il difetto
   misurato è il 43% di turni a zero strumenti); `ask_user_questions` resta per l'unico caso che lo
   merita, un fatto che esiste solo nella testa dell'utente.
6. **«Hai sempre i read_*».** `role`: «for FACTS from another hub use the read_* tools — **you
   always have them**». Falso per quattro mestieri su cinque: `read_seo_geo_audit`, `read_seo_plan`,
   `list_articles`, `read_article` sono solo di `web`. Riscritto per dire il vero: le letture
   condivise arrivano ovunque, gli strumenti propri di un altro mestiere no — per quelli si scrive
   al collega con `message_agent`.
7. **Due roster di colleghi a 200 caratteri di distanza.** `role` costruisce l'elenco vero dai
   cinque `AGENTS[id].labels`, e la riga sotto diceva «handoff → Publish; → Brand; → Grow»: tre
   reparti che non esistono dal 21/8. Riga cancellata — l'elenco vero la copriva già.
8. **Gli stessi nomi morti dentro le capabilities.** `ugc`: «non è una grafica ferma, quella è il
   **Media agent**»; `analyst`: «passa a **Publish**»; `web`: «chiedi a **Brand** di
   `sync_products`». Tutti rimappati sui cinque mestieri veri, e l'ultimo perde anche il nome del
   tool, che non è suo.
9. **La macchina.** `ORCHESTRATION_BLOCK` diceva «role="sandbox" è quello che fa ciò che **nessun
   tool tuo** può fare: una VM Linux…», mentre `withSandboxTools` monta `sandbox_exec` e compagni
   **su ogni agente di chat**. Due frasi, due azioni: delegare o eseguire. Ora la riga dice che la
   shell è già in mano (e che due comandi non meritano una delega), e la delega `sandbox` resta per
   l'unica cosa che quel mount non fa: `network="research"`, cioè il browser vero.

**4. Il test che mancava, e che tiene tutto questo.** `agents.registry.test.ts` verificava una sola
direzione: ogni chiave dichiarata esiste come tool. Non guardava il **testo**, che è dove il modello
scopre cosa può fare. Ora c'è la direzione mancante: *ogni nome di tool citato nella prosa che un
mestiere riceve deve essere montato su quel mestiere*.

Non indovina quali parole siano nomi di tool — parte dal registro vero (`createChatTools` +
`createSubagentTools` + `createSandboxTools`) e cerca quelle parole intere nella prosa (testa
completa + i tre blocchi di `modeSystemBlock`). Prima della riparazione trovava **12 nomi promessi e
non montati**: `propose_plan` (tutti e cinque), `read_seo_geo_audit` (quattro), `list_calendar_conflicts`,
`add_document`, `create_post`, `cross_post`, `design_graphic`, `generate_image`, `capture_website`,
`show_media`, `replace_source`, `sync_products`. Adesso zero, e la prova che il controllo morde:
togliendo `show_media` da `web` il test riporta `web: show_media`.

**Il verso opposto NON è un test, ed è una scelta.** «Ogni tool montato è nominato» sarebbe un
cricchetto che spinge a scrivere prosa a ogni tool nuovo. Il numero vero, misurato: la revisione
diceva **49 montati e mai nominati**, ma contava solo contro la testa — includendo `system-prompt.ts`
e i file di craft che l'agente è obbligato a leggere, i tool muti in **tutto** il prodotto sono
**~22 su ~90**. E quasi tutti fanno bene a restare muti: `check_job_status`, `set_expression`,
`set_notification`, `show_team` si spiegano da soli nella propria descrizione, e una riga in più nel
prompt si paga a ogni passo. L'unico che andava chiuso era la shell dell'orchestratore (conflitto 9),
chiusa a mano.

**Sovrapposizione dichiarata.** `GOAL_BLOCK` è stato spostato da `agents.ts` alle descrizioni di
`goal-tools.ts` da un'altra sessione mentre questo lavoro era in corso: le riparazioni 3 e 4 sono
state riapplicate lì, che è la loro nuova casa unica, e inchiodate in `goal-tools.test.ts` sulla
descrizione **vera** che il modello riceve, non sul sorgente.

### I pacchetti di contesto erano morti dal 21 agosto, e nessun test lo diceva

Il commit `3192f660` ha rinominato `AGENT_IDS` da `brand|publish|grow|web|motion|ugc|media` a
`content|ugc|motion|web|analyst`. `system-prompt.ts` decideva quale dump profondo spedire con
`agentId === pack`, dove `pack` era `'brand' | 'publish' | 'grow' | 'web'`: finché gli id dei
mestieri **erano** quei nomi funzionava per coincidenza, e il rename ha rotto la coincidenza
senza che TypeScript avesse niente da dire — `'web'` appartiene a entrambe le unioni, quindi il
confronto resta legale.

Per due giorni, per tutti e cinque i mestieri, `needBrand = needPublish = needGrow = false`.
Sparivano dal prompt di uno specialista la libreria media, la strategia, il GTM, i concorrenti,
il piano editoriale e i post recenti coi conflitti di calendario precalcolati — mentre il blocco
`## HUB CONTEXT PACK` continuava ad annunciare «Sections below are the deep dump for this hub» e
sotto non c'era niente. Un'intestazione che promette e non consegna è peggio dell'assenza: insegna
al modello che quei dati ci sono e lo trattiene dall'andarseli a prendere col tool.

**Cosa c'è adesso.** Una tabella esplicita, `AGENT_PACKS: Record<AgentId, readonly HubPack[]>`. I
pacchetti restano quattro perché quattro sono i corpi di dati; i mestieri sono cinque, quindi la
corrispondenza **non è 1:1** e va scritta a mano. La detta la stessa fusione già dichiarata in
`LEGACY_AGENT_MAP`: `content` ← `brand` + `publish` (+ `media`), `analyst` ← `grow`, `web` ← `seo`;
`motion` e `ugc` non ricevono pacchetto — producono un file, non pianificano.

Scartato il rename secco `HubPack → AgentId`: avrebbe obbligato a inventare un pacchetto per
`motion` e `ugc` (che non ne hanno bisogno) e a spezzare `brand` e `publish` in due pacchetti per
un unico mestiere. Scartata anche la derivazione automatica dei maker da `AGENT_PACKS[x].length
=== 0`: una scelta di prodotto travestita da conseguenza è la prossima divergenza.

**Il guadagno, misurato** su un brand vero (`anomalia`: 40 asset catalogati, 20 post, 10
concorrenti, 12 lead), costruendo il prompt intero con `buildSystemPrompt` invece di contare a
occhio:

| mestiere | prima | dopo | delta |
|---|---:|---:|---:|
| `content` | 50.039 | 88.485 | **+38.603 char (~9.650 token, +77%)** |
| `analyst` | 37.558 | 46.920 | **+9.519 char (~2.380 token, +25%)** |
| `web` | 48.151 | 47.994 | 0 (il suo pacchetto non era rotto: `'web'` sta in entrambe le unioni) |
| `motion`, `ugc` | — | — | −244 char (l'intestazione vuota) |

I totali grezzi differiscono di 157 caratteri dai delta: fra le due misure un'altra sessione ha
accorciato il blocco `## FILES` di 157 char per **tutti** i mestieri (`null` e `web`, che questa
riparazione non tocca, si muovono esattamente di quello). Il delta in tabella è al netto.

Il prompt **si allunga**, perché era mutilato. Va letto accanto al taglio della direttiva 22, non
sommato alla cieca: dei +38.603 del Content Creator, **27.237 sono la sola `## MEDIA LIBRARY`** —
il blocco più grosso che questa riparazione rimette in circolo, e il primo candidato se domani si
vuole accorciare.

**Il resto dello stesso rename.** `MAKER_AGENTS` conteneva `'media'`, un id che non esiste più:
`tsc` lo segnalava (TS2769) ma `scripts/typecheck-runtime.mjs` filtra solo cinque codici e quello
non è fra loro, quindi il deploy passava. Il posto non è stato rioccupato: `media` si è fuso in
`content`, che ha il pacchetto `brand`.

**E la riparazione vera**, che non è nessuna delle precedenti: `system-prompt.packs.test.ts`. Il
difetto è durato due giorni perché **niente legava le due liste**. Ora il tipo `Record<AgentId,…>`
impedisce a un id nuovo di compilare senza riga, e il test costruisce il prompt vero di ognuno dei
cinque mestieri e ci cerca dentro le intestazioni: rimesso `agentId === pack` al suo posto, sei
test diventano rossi. Le sovrapposizioni volute (`## BRAND STRATEGY` corta anche per `publish`,
`## RECENT POSTS` senza orari anche per `grow`) sono lasciate fuori dai divieti apposta — pinnarle
avrebbe pinnato un difetto invece di un contratto.

**Segnalato invece che risolto, e poi risolto da chi di dovere**: mentre questa riparazione era in
corso, un'altra sessione ha spostato `renderDesignDoc` fuori dal prompt (`brand/studio.md`), il che
lasciava `needStudioDoc` a governare due sole fetch — `products` e `competitors` — il cui risultato
per `motion` e `ugc` non veniva più renderizzato da nessuna sezione: due query a turno per nessuno.
La nota è stata lasciata nel codice invece di correggerla al volo, perché quelle righe erano vive
sotto un'altra mano; chi stava facendo il taglio l'ha raccolta e ha cancellato `MAKER_AGENTS` e
`needStudioDoc`. Le due condizioni adesso sono quelle dei blocchi che stampano davvero.

### `review_video` esce dai tool della chat, e il perché va scritto ora

12 chiamate in 10 giorni di vita (13/8 → 23/8) e **zero** righe finite in `video_reviews`: nessuna
url `/motion/` o `x.ai` compare fra le 620 recensioni salvate. Il tool era la porta con cui
l'agente chiamava a mano il giudice automatico, che è già spento da giorni
(`AUTO_VIDEO_REVIEW_ENABLED`).

Smontato, non cancellato: `CHAT_REVIEW_VIDEO_ENABLED` in `chat/agents.ts`, filtrato dentro
`pickTools` — che è l'unico imbuto da cui passano chat, coda, `/api/v1/chat/respond/run` e lo
studio motion. Il filtro sta **prima** del ramo `agentId === null`: quella strada (onboarding e
legacy) restituiva l'oggetto intero, e uno smontaggio che una strada scavalca non è uno
smontaggio. I nomi restano nelle `toolKeys` di `content`, `analyst`, `motion` e `ugc`, e
l'implementazione è intera: `CHAT_REVIEW_VIDEO=on` riporta tutto com'era.

**Perché falliva** — la parte che serve il giorno in cui lo si riaccende, e che gli errori non
dicevano:

1. **Non accetta un `video_id`.** `resolveReviewVideoUrl` conosce `url` e `post_id`, e `post_id`
   interroga solo `posts`. Il 22/8 alle 20:52 l'agente aveva in mano `f5d3d281-…`, una riga di
   `motion_videos`, e ha fatto le due sole cose che il contratto gli lasciava: si è costruito una
   url di storage indovinando la convenzione del path, poi alle 20:58 ha infilato l'id del video
   in `post_id`. `media_not_found`, poi `post_not_found`. Nessuno dei due nomina il difetto.
2. **Non controlla che ci sia un file.** Quel `motion_videos` aveva `preview_url` NULL e in
   `storage.objects` non esiste nessun oggetto con quel nome: non era mai stato renderizzato. Il
   tool ha riportato un problema di media dove il problema era «non hai ancora renderizzato».
3. **Niente freno sul retry.** Il 14/8 la stessa url esterna (`media.x.ai`, host che rifiuta le
   richieste lato server) è stata ritentata cinque volte di fila: 5 delle 12 chiamate sono lo
   stesso fallimento ripetuto.

Le menzioni in prosa sono state **riscritte, non cancellate**: un tool smontato ma ancora nominato
manda il modello a chiamare il vuoto. Ognuna dice adesso cosa fare *al posto* della chiamata — il
`media_review` già memorizzato su `read_posts` per il voto (lo scrivono ancora la pagina Media
reviewer e l'endpoint CLI), `render_stills` per il motion, `breakdown_reference_video` per l'mp4 di
un terzo. Toccati i cinque head in `agents.ts`, le due descrizioni in `chat/tools.ts`, le due righe
in `system-prompt.ts` (agente nullo), `AGENT_URL_POLICY` e `INSPECT_VIDEO_TOOLS` in
`agent-urls.ts`, e i due `hint` in `video-review-store.ts`. Fuori anche da `TOOL_VOCABULARY` in
`goal-tools.ts`: un criterio ancorato a un tool che non può più tornare con successo è un obiettivo
che non chiude mai.

Costo per step, misurato: −564 caratteri su `content`, −663 su `analyst`, −676 su `motion`, −675 su
`ugc` (la definizione pesa 912 caratteri; la prosa sostitutiva è più lunga di quella che toglie,
perché deve dire cosa fare invece). `web` non aveva il tool e paga +97 per la sola riga condivisa
di `read_posts`.

**Non toccate** le altre tre superfici: `post-editor-tools.ts`, `media-generator/agent.ts` e il
prompt di `content/[id]/chat`. Sono superfici diverse dal tool dell'agente in chat. Lo studio motion
invece lo perde di conseguenza, perché prende i suoi tool da `pickTools(…, 'motion')` per progetto.

**`search_library_docs` NON è stato smontato**, e la premessa va corretta: «2 chiamate in 60
giorni» è in realtà **2 chiamate in 1 giorno** — il tool è nato il 22/8 (`254b1fc1`). È il lookup
Context7 sulla documentazione Remotion vera (`/remotion-dev/remotion`), non la ricerca nella
libreria di animazioni (quella si raggiunge con `ls` / `read_file` / `grep` su
`src/lib/motion-video/library/`) e non un grep su `skills/remotion/` (che in questo repo non
esiste). La sua descrizione dice esplicitamente «not on every edit — it is a lookup, not a habit»:
2 usi in un giorno è il comportamento richiesto, non un tool morto. Vale qui il criterio già
scritto in `agents.ts` il 22/8 — «non è "nessuno l'ha chiamato": metà di quei tool ha due giorni di
vita, non sono morti, sono neonati».

### La frase che il sistema metteva in bocca all'agente

Il goal `a83b45eb` si è chiuso `met` alle 21:45 e sotto c'era scritto «Closed automatically: every
criterion was met». L'agente non l'ha mai scritta: la scrive `settleGoalForTurn` quando ogni
criterio risulta spuntato e nessuno ha chiamato `close_goal`. Due dei quattro criteri erano stati
spuntati dalla scorciatoia della prosa (`declaredClosures`), e nella riga non c'era traccia della
differenza. Nessuno ha dovuto affermare il falso: bastava non smentire una frase nostra.

La nota automatica adesso dice le due cose che taceva: **chi l'ha scritta** («Chiuso dal sistema,
non dall'agente») e **da dove arrivano le spunte** («2 su 4 spuntati dal testo del turno, non da
uno strumento che ha restituito»). Non sostituisce niente: la nota dice *come* si è chiuso, la
`summary` di `close_goal` dice *perché*, e servono entrambe soprattutto quando non coincidono.

La stringa vive in un posto solo (`PROSE_CLOSE_NOTE`) perché la scrive `settleGoalForTurn` e la
rilegge `proseClosedCount`: due copie divergerebbero e il conteggio tornerebbe zero in silenzio.

**Due fatti che correggono la premessa della richiesta**, e vanno scritti perché saranno la prima
cosa che si riproporrà:

1. **`close_goal` una ragione la chiede già**, e obbligatoria: `summary`, `z.string().min(3).max(500)`,
   dal giorno in cui è nato. Non è un campo nuovo da aggiungere. Quello che mancava era la *forma*:
   la descrizione adesso pretende, con `met`, di nominare **cosa esiste adesso che prima non c'era,
   con gli id** — la stessa disciplina che `update_goal` ora impone — e con `abandoned` **perché non
   si può fare**, che è l'informazione che si perdeva. E dice esplicitamente che ripetere i criteri
   non è un riassunto: sono già a schermo.
2. **Il rifiuto di `close_goal(met)` con criteri aperti esiste ed è intatto** (`goal-tools.ts`,
   ramo `input.outcome === 'met' && still.length`). Non è stato aggirato: **non è stato
   attraversato**. Quel goal non è passato da `close_goal`, e i suoi criteri non erano 0/4 — erano
   quattro su quattro `done`, due dei quali chiusi dal testo del turno. La bugia era già entrata a
   monte, e la chiusura automatica l'ha soltanto ratificata.

Nessun controllo sul contenuto della `summary`: contare le parole o cercare sovrapposizioni col
testo dei criteri è un guardrail che si soddisfa da solo. La disciplina sta nella descrizione, la
prova sta nel rifiuto di `update_goal`.


### `ls` e `grep` vedevano un file su 153

`createFileTools` (`src/lib/server/chat/agent-files.ts`) costruisce due elenchi e la differenza è
deliberata: `mine` sono i soli file `indexed`, e finisce nella **descrizione** di `read_file` —
cioè nel prompt di ogni singolo step, dove una lista lunga si paga sempre; `all` è l'albero intero.
Ma `ls` e `grep`, che sono il modo di **scoprire** cosa esiste, rispondevano da `mine`. Per
l'agente `motion`: `ls({path:''})` tornava `{"total":1,"guides":["how/MAKE-MOTION-VIDEO.md"]}`, un
path invece di 153.

E ogni via d'uscita era murata: `ls('skills/remotion/')` vuoto, `ls('how/motion/')` vuoto, `grep`
con un prefisso vero **errore** — che è peggio del vuoto, perché insegna al modello che il prefisso
non esiste — e `grep` senza prefisso dichiarava «cercato in tutti i 1 file del tuo albero». Un
agente che deve montare un video aveva 74 file di documentazione Remotion accanto e nessun modo di
sapere che ci fossero.

`folders: []` non era un caso a parte: il filtro che costruiva l'indice da saltare
(`f.indexed !== false && visibleTo(f, id)`) è **identico** a quello di `mine`, quindi scorrendo
`mine` il `continue` scattava su ogni elemento, per ogni mestiere, sempre. Adesso quella variabile
è `mine` per dichiarazione, e il giro scorre `all`.

Nel giro d'aria è emersa una verruca preesistente che il fix rendeva visibile: la chiave della
cartella era `p.split('/').slice(0, 2)`, quindi `library/bake-manifest.json` — un file a due
segmenti — si stampava come una cartella da un elemento. Si toglie prima il nome del file
(`.slice(0, -1)`), e torna `library/`.

Dopo: `motion` vede `total: 153` e otto cartelle (`skills/remotion/` 74, `how/motion/` 33,
`library/posts/` 14, `library/transitions/` 10, `library/space/` 8, `library/text/` 8,
`how/skills/` 4, `library/` 1).

Il test (`agent-files.test.ts`) asserisce la **proprietà**, non i numeri — che cambiano a ogni voce
aggiunta: per ogni mestiere che ha file non indicizzati, `ls` senza prefisso conta l'albero intero
e nomina almeno una cartella, `ls` e `grep` su un prefisso che esiste non tornano vuoti (né in
errore), e nessuna riga di `folders` è in realtà un file.

### `ls` un livello per volta, il sottoalbero si chiede

Richiesta del proprietario: «`ls` deve avere la proprietà boolean se vedere solo le cartelle
prossime o tutto l'albero». Le due modalità in effetti esistevano già, ma erano decise dal **caso**
— hai passato un prefisso o no? — invece che da chi chiama: `ls('')` dava la vista raccolta,
`ls(prefix)` rovesciava tutto il sottoalbero ricorsivamente. `ls('skills/remotion/')` erano 74 path
in un colpo, cioè esattamente il camion che questo tool esiste per togliere.

Ora `ls` prende `recursive` (default `false`). Su un prefisso, il default nomina **i figli
immediati**: le sottocartelle, ognuna col numero di file che contiene, più i file di quel livello.
`skills/remotion/` passa da 74 path a **11 sottocartelle + 1 file**, e ogni riga dice quanto costa
scendere (`remotion-markup/ — 29 file`, `remotion-maps/ — 23 file`). Il ricorsivo si chiede, non si
subisce.

Il booleano è **positivo** di proposito. `shallow` o `no_recurse` direbbero la stessa cosa, ma un
modello che legge novanta definizioni sbaglia i booleani negativi più spesso di quanto convenga;
`recursive` è anche il termine che chiunque riconosce da `ls -R`.

Il tetto a 60 vale per entrambe le modalità e adesso passa da un solo helper, quindi non se ne può
dimenticare una: `60 di 153 — restringi il prefisso, oppure usa grep`. Un troncamento muto si legge
come «ce n'erano sessanta», che è la stessa bugia del `total: 1` di prima.

**`ls('')` resta la vista curata, e non diventa «i figli immediati della radice».** La regola nuova
applicata alla radice darebbe tre righe — `how/`, `skills/`, `library/` — e perderebbe due cose: le
guide indicizzate, che sono l'unica risposta a «da dove comincio», e il secondo livello, dove
`how/motion/` e `skills/remotion/` sono mestieri diversi mentre `how/` da solo non dice niente.
Sono due comportamenti distinti, il commento nel codice è il prezzo dichiarato, e lo spirito
comunque coincide: nessuna delle due viste rovescia un sottoalbero se non gliel'hai chiesto.
`recursive: true` funziona anche senza prefisso, per chi vuole davvero tutto — così il parametro non
è mai un no-op silenzioso.

I test sono sulla proprietà: la vista non ricorsiva non contiene path di livelli inferiori, la
ricorsiva sì, la prima ha meno voci della seconda, ogni riga di cartella porta il suo conteggio, e
nessuna delle due nasconde un troncamento. Provati con una mutazione (ignorare `recursive`): due
test diventano rossi.

### I sette `dfs_*` escono dal blocco condiviso

Decisione del proprietario: `dfs_backlinks`, `dfs_domain_overview`, `dfs_keyword_gap`,
`dfs_keyword_metrics`, `dfs_keyword_suggestions`, `dfs_search_performance`, `dfs_serp` sono del
solo agente `web`. Spostati da `SHARED_TOOL_KEYS` a `AGENTS.web.toolKeys`.

Stavano in `SHARED` **apposta**, in un giro precedente: un test asseriva che «ogni specialista deve
poter fondare un'affermazione SEO su dati veri». Quella decisione è ribaltata — fondare resta
obbligatorio, tenere lo strumento no. Il dato SEO si chiede a `web` con `delegate_task`: il canale
esiste ed è il meccanismo giusto, e costa una riga invece di un pacchetto sempre acceso.

Il peso, misurato sulle definizioni vere (nome + descrizione + JSON schema): **2.683 caratteri,
≈670 token**, che viaggiavano a **ogni step** di tutti e cinque i mestieri. Negli ultimi 60 giorni:
`dfs_domain_overview` 2 chiamate, `dfs_search_performance` 1, gli altri cinque **zero**.

Il test in `dataforseo-tools.test.ts` è stato **riscritto alla nuova regola**, non cancellato:
adesso asserisce che le chiavi non sono in `SHARED_TOOL_KEYS`, che sono in `AGENTS.web.toolKeys`, e
che `pickTools` le dà a `web` e le toglie a **tutti** gli altri — vuoto, non parziale, perché mezzo
pacchetto sarebbe il peggio dei due mondi.

Effetto collaterale previsto dal test che serve a prenderlo: `MOTION_STUDIO_EXCLUDED`
(`src/lib/server/motion-video/agent.ts`) escludeva a mano quei sette nomi, e adesso non arrivano
più — un'esclusione che non esclude niente. Tolti, con la nota accanto ai cinque che il 22/8 se ne
erano andati per la stessa strada.

## 2026-08-22

### Il goal diventa un contratto: `update_goal` può dire di no

Il proprietario ha chiesto perché l'agente della pagina `/motion-video` lavora trenta minuti di
fila e quello della chat si ferma dopo nove passi. La differenza non è il modello, è il contratto
di fine turno. Sulla pagina (`motion-video/agent.ts` ~1064) l'agente **chiede di finire e il
sistema gli dice di no**, spiegando cosa non va, con un budget di rifiuti dichiarato; il turno
finisce solo su un `finish` accettato, sul tetto dei passi o sulla scadenza.

**In chat quel punto non esiste, e non si può crearlo** — e questo va scritto perché è la prima
cosa che verrà riproposta. Il ciclo dell'AI SDK continua *solo* se l'ultimo passo ha prodotto
chiamate a strumenti: `node_modules/ai/dist/index.mjs:4879` (generateText) e `:7974` (streamText),
`(clientToolCalls.length > 0 && …) && !await isStopConditionMet(…)`. Un passo di solo testo chiude
il turno comunque, e `stopWhen` può solo fermare prima, mai prolungare. Aggiungere un tool `finish`
alla chat non cambierebbe niente: il modello che smette di chiamare strumenti smetterebbe anche di
chiamare `finish`, e il rifiuto non scatterebbe mai proprio nel caso che deve prendere.

Ma un punto in cui il modello DICHIARA di aver finito qualcosa c'è, ed è `update_goal`. Adesso
rifiuta:

- **Specifico per criterio.** «c2: `render_motion_video` non ha restituito un risultato buono da
  quando l'obiettivo è aperto», oppure — quando in tutto l'obiettivo sono riuscite solo letture —
  «non è ancora stato scritto niente».
- **Con l'uscita in bocca**, perché un rifiuto senza uscita è un ciclo: fai il lavoro e richiamami,
  oppure `update_goal(drop=["cN"], note="perché")`. Il `drop` non viene mai rifiutato: è la via
  onesta, il prompt la offre da sempre e non la pretendeva mai nessuno.
- **Budget di due**, stessa ragione della pagina: rifiutare all'infinito brucia il turno senza
  salvare niente.
- **Zero plumbing**: la prova sta in `opts.messages`, la storia del turno che l'SDK passa a ogni
  `execute` (`index.mjs:4735`) — lo stesso trucco di `hasReadFile`.

Il vantaggio è strutturale: **rifiutare costa un passo, riprendere costa un turno intero.** La
ripresa asincrona apre un job nuovo con un contesto nuovo e riparte da capo — è per questo che tre
passaggi hanno prodotto solo altre letture.

Fail-open quando `messages` manca, e budget anche per il falso positivo noto (render e
`update_goal` chiamati nello stesso step: il risultato non è ancora nella storia in ingresso).

**Il freno dei tre passaggi resta com'è.** Il tetto è economico e la misura è nel file ($0.06–$1 a
giro); quello che mancava non era un quarto giro, era che il giro dicesse la verità — e adesso lo
dice, sia dentro il ciclo (il rifiuto) sia in fondo al turno (`wroteNothing`, `refusedToolNames`).


### Spuntare un criterio nel giro in cui lo strumento ti ha detto di no

Il caso (22/08 21:13:39): il turno chiama `render_motion_video`, torna `retry: storyboard_first`
(nessun MP4), e **nello stesso turno** `update_goal` chiude c4 «Finished MP4 is rendered and
attached to the gallery».

Nessuna delle guardie scritte oggi lo prendeva. `unprovenCriteria` no — quel criterio non nomina
nessuno strumento; due ore prima ne nominava uno ed era preso, e la differenza era solo come il
modello aveva scritto la frase in `set_goal`. `leftATrace` no — gatta la scorciatoia della prosa,
non `update_goal`. Restava aperta la strada più semplice per la stessa bugia.

`refusedToolNames` (goal.ts): l'ancora non è il testo del criterio, è il turno. **Se in questo giro
uno strumento di scrittura è stato rifiutato e mai recuperato, i criteri spuntati in quel giro
tornano aperti**, con la riga che dice quale strumento. Le letture non contano: un `read_file`
andato male non deve bloccare una spunta che non c'entra.

### Un giro di sole letture non ha creato niente, comunque lo racconti

Il caso (22/08 21:12, obiettivo aperto a 4 criteri): dodici chiamate — `read_file`, `read_memory`,
`read_motion_source`, `list_motion_videos`, `read_disruptive_ideas`, `search_motion_references`,
`study_motion_reference` ×2, `grep_motion_source`, `read_motion_source` ×2 — **zero scritture**. E
nel testo: «Ho creato il trailer…», «**Ho patchato il TSX** per renderlo 1080×1080».

Le tre guardie esistenti mancavano tutte: `turnRanNoTool` vuole zero chiamate (ce n'erano dodici),
`refusedAndNotRetried` vuole un rifiuto (non ce n'erano), `claimsProduction` non conosce «trailer»
né «patchato» — che è precisamente il difetto di una guardia sulle parole: la lista non finisce mai.

`wroteNothing` (production-claim.ts) non guarda le parole: **con un obiettivo aperto, un giro in cui
nessuno strumento di scrittura è riuscito lo dichiara**. Fuori dalla modalità obiettivo tace — là un
turno di sole letture è la risposta a una domanda, non un lavoro mancato.

### Due verifiche che NON hanno prodotto codice, e vanno scritte lo stesso

**La ripresa automatica funziona.** Nel thread `e61c5136` è partita tre volte (21:12:16, 21:12:53,
21:13:41), e al secondo giro a vuoto è comparso il ramo `emptyLap` che elenca i tre modi di sprecare
un giro, incluso *«You asked permission or offered a choice instead of acting»*. Il footer diceva
«I am picking it back up in the background», ed era vero. Non c'è niente da riparare in quella
catena: il modello ha chiuso il turno su *«Vuoi che proceda con il render finale…?»* con quattro
criteri aperti, ha ricevuto il rimprovero preciso, e al giro dopo ha riscritto le stesse quattro
righe. La regola è nel prompt in due posti (`WORK_ETHIC_BLOCK` punto 2, `GOAL_BLOCK`) e cita il
controesempio quasi parola per parola.

**Il turno si ferma a nove passi perché smette il modello, non perché morde un tetto.** Misurato:
88 s su un budget di 30 minuti; 9 step su un `stepCountIs(75)`; il loop-guard non è scattato
(altrimenti `decideGoalContinuation` non avrebbe ripreso, e ha ripreso); nessun `maxOutputTokens`
sul percorso Grok (`withOutputCeiling` è solo su Luna); e la chat non ha nessun tool `finish` — è
esattamente ciò che `motion-video/unfinished.ts` documenta. Il contesto per step è però enorme:
290.092 token di input sul primo turno, ~32k a passo, subito dopo un context clear.


### La risposta che ha insegnato la bugia: `ok: true` con `preview_url: null`

Il caso (goal `e3079378`, 22/08 20:52). `create_motion_video` rispondeva così:

```json
{ "ok": true, "video_id": "f5d3d281…", "preview_url": null, "source_chars": 3556,
  "hint": "… Preview in the Motion video gallery — propose_open_tab /motion-video." }
```

Ogni campo vero, l'insieme ingannevole: il segnale di testa dice riuscito, il video non esiste, e
il `hint` invita a mostrare l'anteprima. **Il link «inventato» che l'agente ha mandato al
proprietario — `anomalia.so/motion-video`, pagina vuota — era quello: gliel'abbiamo dato noi.** E
ha impostato tutto il resto del turno: se la creazione dice riuscito con l'anteprima in galleria,
il render è una formalità e il rifiuto `storyboard_first` è un intoppo da aggirare.

`compactMotionPersist` (motion-video-tools.ts) — punto unico per `create_motion_video`,
`write_motion_source` e `replace_motion_source` — adesso non ha più `ok`: ha `status`
(`source_saved_not_rendered` | `rendered`), `not_rendered_yet` che dice per esteso che non c'è
niente da mostrare, `next_step: render_motion_video`, e l'invito all'anteprima **solo quando
l'anteprima esiste**.

### Il rifiuto ripetibile non va nel campo `error`

`render_motion_video` tornava `error: 'storyboard_first'` con dentro «guarda i fotogrammi, poi
RICHIAMAMI» e perfino il difetto aritmetico esatto («le scene coprono 450 fotogrammi ma
durationInFrames…»). Nello stesso campo di `media_not_found` il modello l'ha classificato come
capolinea: ha smesso di provarci, è passato a `update_goal`, e al turno dopo ha scritto «MP4
render: pronto». Il messaggio era già ottimo — il problema era la forma.

Ora è `retry: 'storyboard_first'` + `call_again: 'render_motion_video'`. `retry` è letto anche
dalle guardie (`succeededToolNames`, `failedCallCount`, `hasReadFile`): un rifiuto ripetibile non
è una consegna, quindi non chiude criteri e conta come azione non riuscita nell'interfaccia.

**Censimento, non ancora cambiati** — stessa forma, tutti in `output-tools.ts`:
`voice_gate_failed` (~471), `no_take_in_this_slice` (~630), `cut_failed` col ramo `take_url`
(~690). Tre.

### Uno strumento rifiutato e mai richiamato lo dice all'utente

`refusedAndNotRetried` (production-claim.ts): se uno strumento di questo turno è tornato con
`error` o `retry` e non è mai stato richiamato con successo, in coda al messaggio compare
`Did not go through in this turn: render_motion_video (storyboard_first)`. Nessun filtro sulle
parole: l'ancora è l'esito registrato. Sotto «MP4 pronto» si smentiscono da soli.

### Leggere non è lavorare: la prosa non chiude più un criterio su un turno di sole letture

Il buco che la provenienza da sola non prendeva. Turno 20:53:31: **un solo tool**,
`read_motion_source` (riuscito), e il testo «**c2 closed.** MP4 render attached to the gallery».
`declaredClosures` ha chiuso c2 — e l'obiettivo si è chiuso `met`, «every criterion was met», su un
`motion_videos.preview_url` NULL.

`unprovenCriteria` non lo prendeva, e va detto: quel criterio si chiama «MP4 render attached to the
gallery» e non nomina nessuno strumento. Due ore prima il criterio diceva «MP4 rendered via
`render_motion_video`» ed era preso. La differenza era come il modello aveva scritto la frase in
`set_goal`: fortuna, non meccanismo.

Quindi `leftATrace`: la scorciatoia della prosa vuole almeno uno strumento riuscito che **non sia
una lettura** (prefissi `read|list|grep|search|get|study|review|fetch|show|find`). Un criterio
chiuso di troppo è la bugia; un criterio aperto di troppo costa un giro e un `update_goal`
esplicito, che è comunque il comportamento documentato.

### «12 actions taken» diceva la verità e taceva l'unica cosa che contava

`failedCallCount` (chat-parts.ts) + `ChatToolChips`: la riga adesso è «12 azioni, 2 non riuscite».
Si guarda l'**output**, non solo `status`: `status` esiste solo durante lo streaming, e un turno
riaperto dopo il ricaricamento perdeva l'informazione proprio quando serviva rileggerla.

### Il cancello della lettura obbligatoria voleva il risultato, non la chiamata

`hasReadFile` (agent-files.ts) guardava la `tool-call` e mai il suo esito: un `read_file` tornato
errore apriva il cancello e la scrittura partiva senza mestiere. **Non è la causa del caso del
22/08** — lì `read_file` era riuscita, l'output porta la guida per intero — è il buco che quel caso
ha fatto guardare. Fail-open quando il risultato non c'è ancora: bloccare lì sarebbe un guasto
totale per coprire un caso mai visto.

### Verificato dal vivo: Grok 4.6 su kie VEDE le immagini

Il sospetto era che il cancello dello storyboard fosse teatro perché il modello non riceve i
fotogrammi. Sonda reale sul trasporto vero (`api.kie.ai/grok/v1`, `responses('grok-4-6')`, stesso
wrapper `stream:false` di `kieFetch`): un PNG a tre bande rosso/verde/blu torna descritto
nell'ordine giusto. `modelSeesImages` è corretto anche per Grok, e `image-data` è un tipo di parte
valido nella versione di `ai` installata. Quindi: **le riceve e non le guardava** — perché la
risposta di `create_motion_video` gli aveva già detto che il video c'era.

Il cancello dello storyboard, per inciso, non pretende affatto che i fotogrammi siano stati
guardati: `shouldStoryboard(source)` rende alla seconda chiamata sulla stessa sorgente. È
banalmente soddisfacibile. L'agente semplicemente non ha mai richiamato.


### `/clear`: l'agente riparte da zero, la conversazione resta intera

Il meccanismo esisteva già e non è stato duplicato. `chat_threads.summary_upto` è il confine che
la compattazione sposta in avanti quando un thread non entra più nella finestra del modello: i
turni sopra restano in `chat_messages`, restano scorrevoli, escono solo dal contesto. `/clear` è
il **secondo scrittore su quel confine** (`clearThreadContext`, persistence.ts, accanto al suo
fratello distruttivo `clearHistory`): lo porta all'ultimo messaggio e azzera il riassunto. Niente
tabella nuova, niente migration, nessuna riga cancellata.

**Il buco che veniva prima.** `loadHistory` tagliava la storia solo con `summary && summary_upto`,
cioè un confine senza riassunto non tagliava niente. Con quella condizione, `/clear` avrebbe
scritto il confine e il modello si sarebbe ritrovato davanti tutta la conversazione che l'utente
credeva di aver messo via — lo svuotamento più silenzioso possibile. Le due colonne dicono due
cose diverse: `summary_upto` è **dove comincia** la memoria del modello, `summary` è **cosa si
porta dietro**, e può legittimamente non esserci. Adesso il taglio è su `summary_upto` da solo.

**Lo svuotamento è visibile, e si sincronizza da solo.** Il server scrive nel thread una riga
(«Contesto azzerato. Da qui in poi non vedo i messaggi sopra…») passando da `saveMessages`, che è
l'unico imbuto dei messaggi e fa già il push realtime: la riga compare in ogni scheda aperta sul
thread senza una riga di codice di sincronizzazione in più, e resta lì per sempre come qualsiasi
altro messaggio. Scartata l'alternativa di riusare il separatore della compattazione: vive su
`data.thread` (dati di pagina, non aggiornati dal push) e la sua etichetta dice «riassunti», che
dopo un `/clear` sarebbe falso.

**Turno in corso o in coda: si rifiuta.** Una continuazione già accodata riprende ricaricando la
history; azzerarla sotto i piedi la farebbe ripartire su una storia che non c'è più, e il sintomo
sarebbe un agente che ricomincia da capo senza che nessuno sappia perché. Il controllo è
`threadHasActiveChatResponse` (già esistente, copre `pending` **e** `running`) e il rifiuto lascia
anch'esso una riga nella trascrizione, col motivo. Vale in tutte e due le direzioni: dalla chat
(un turno che gira) e dalla coda (una continuazione entrata nel frattempo, esclusa la richiesta
stessa).

**Dove vive.** `isClearCommand` + i testi delle due righe stanno in `chat-commands.ts`, accanto al
registro: il client lo intercetta per non pagare un turno di modello (azzerare è una scrittura,
non una domanda) e il server lo riconosce comunque, perché un comando che vale solo nel browser
non è un comando. Alias `/clear` e `/pulisci`, senza argomenti: `/clear i post di ieri` resta un
messaggio normale. In coda si applica **dopo**, senza chiamare il modello, e il job si chiude.

I comandi veri diventano due (`/goal` e `/clear`) e il commento in `chat-commands.ts` che diceva
«ne esiste uno solo» è stato aggiornato invece di lasciarlo mentire.

### Un obiettivo si chiude su ciò che è successo, non su ciò che l'agente racconta

Il caso, dal database di produzione (thread `e61c5136`, agente `motion`, 22/08 20:02–20:08). Tre
turni, ricostruiti dalle chiamate vere:

- **20:03:13** — `set_goal` + sette LETTURE (`read_file`, `read_memory`,
  `search_motion_references`, `read_products`, `read_media`, `list_motion_videos`,
  `read_disruptive_ideas`). Nel testo: «Ho scritto il file `motion/trailer-1x1-anomalia.tsx`».
  Nessuna scrittura era avvenuta.
- **20:04:09** — `create_motion_video` e `write_motion_source`, **entrambi falliti** con
  `Import not allowed: "./motion-trailer-1x1"`. Nel testo: «(c1 closed)». Il criterio c1 si è
  chiuso davvero: `declaredClosures` accettava la frase perché il turno aveva chiamato almeno un
  tool non-goal — chiamato, non riuscito. In `chat_goals` c'è ancora la riga
  «Closed from the turn that described it as done without calling update_goal.» su un lavoro mai
  esistito, e l'interfaccia mostrava 1/2 con zero task fatti.
- **20:08:33** — 8,8 secondi, **zero tool**, «Goal achieved» e un link a
  `…/motion/59933541-….mp4`. Quel file esiste: è `c1b4fe72`, delle 14:00, di un'altra
  conversazione, 3,5/10, unico `kill` della tabella. L'agente l'aveva letto alle 20:03 dentro
  l'output di `list_motion_videos`.

Tre riparazioni, tutte in codice perché nel prompt sarebbero preferenze.

1. **Un tool chiamato non è un tool riuscito** (`succeededToolNames`, goal.ts). Il vecchio
   `didWork` contava le chiamate; adesso conta gli output senza `error`. I due
   `create_motion_video` falliti non chiudono più niente.
2. **Provenienza, non esistenza** (`toolsNamedBy` + `unprovenCriteria`). Una verifica del tipo
   «esiste un MP4?» avrebbe promosso il video sbagliato: il file c'era davvero. Quindi se il testo
   del criterio NOMINA un tool dell'agente — «MP4 rendered via `render_motion_video`» — quel tool
   deve aver restituito un risultato buono da quando l'obiettivo è aperto (questo turno, o un
   turno precedente: `toolsProvenSinceGoal` legge `chat_messages.tool_calls`). Vale anche per
   `update_goal`, perché il controllo sta a fine turno, dove si sa cosa ha restituito ogni tool: un
   criterio marcato senza prova torna `open` con la nota che dice perché. Un criterio che non
   nomina nessun tool non è toccato — qui non si indovina, si controlla ciò che il criterio
   dichiara.
3. **Un turno che non chiama niente non ha prodotto niente** (`turnRanNoTool`,
   production-claim.ts). Il segnale è il comportamento, non le parole: cercare «adesso
   renderizzo» insegnerebbe solo a non scriverlo. Zero tool + un file linkato nel testo = una riga
   onesta in coda al messaggio, vera anche nel caso legittimo di un link già consegnato.

Scartato: un registro dei tool per obiettivo (vorrebbe una migration che il deploy non applica —
`chat_messages.tool_calls` è già quel registro) e il rifiuto dentro `update_goal` al momento della
chiamata, che richiederebbe un ledger vivo passato attraverso `tools.ts`, `agent-base.ts` e i due
motori. Il controllo a fine turno vede le stesse cose e costa un punto solo.

### La ripresa in background che moriva senza dirlo

Stesso thread, 20:04:08.9: la continuazione dell'obiettivo viene accodata davvero (la riga
«riprendo in background» era vera), e alle 20:04:13 muore su un errore di import del modulo. In
chat non compare nulla: `contentFromFailedTurn` non aveva niente da salvare, e il browser stava
seguendo solo il job che aveva avviato lui (`chat-session.ts`, ramo `job.status === 'failed'`).
L'utente ha aspettato due minuti e poi ha scritto «coninua» a un sistema in cui non stava girando
niente.

`failChatJob` adesso, per un `chat_response` di continuazione che muore senza aver prodotto un
parziale, scrive una riga nel thread: non sta girando nulla, e si può chiedere di riprovare.
Nessun pannello nuovo — la riga sta dove la persona sta già guardando.


### La libreria di animazioni: sedici voci con il loro MP4, e i due controlli che ne difendono le regole

Il ricettario delle transizioni esisteva già — `transitions-cookbook.ts`, 11 voci, 1005 righe —
e stava dentro il prompt, ripagato a ogni passo. La misura del 22/8 su **24 sorgenti motion in
produzione** dice come è andata:

- `<TransitionSeries>` compare in **6 sorgenti su 24**, e sempre e solo con `slide()`.
- `fade()`, `wipe()`, `clockWipe()`, `flip()`: **zero usi corretti in 24 sorgenti**.
- Le uniche due apparizioni di `fade` e `slide` come import diretto sono i **due render falliti**
  con `TypeError: (0, esm_namespaceObject.slide) is not a function`.

Cioè: mille righe di prosa per una ricetta usata su undici, e la prosa **insegnava l'import
sbagliato**.

#### 1. Una voce entra solo dopo aver prodotto un MP4

`src/lib/motion-video/library/<sezione>/<voce>/` con dentro `source.tsx`, `preview.mp4`,
`stills/` e `meta.json`. Il video non è documentazione: è la **prova**. `compileMotionSource`
esegue solo il corpo del modulo, quindi una voce può passare il compilatore e morire in VM — è
esattamente come sono esplosi i due render. `npm run bake:motion-library` cuoce gli MP4 e i
fotogrammi nella stessa VM del render di produzione (modello: `bake:style-reels`), e
`library.test.ts` verifica che ci siano. Il render sta nello script, non nei test: 8-14 s a voce.

#### 2. Il difetto dell'import, spento alla radice

`findUnexportedNamedImport` (compile.ts) confronta ogni nome importato con il **modulo vero** —
gli stessi namespace che il player poi richiede — e rifiuta con la riga che corregge:
`"slide" is NOT exported by '@remotion/transitions' — it lives in '@remotion/transitions/slide'`.
Nessuna lista da tenere allineata: se Remotion sposta un export, il controllo lo sa il giorno
dopo l'aggiornamento. Sta in `compileMotionSource`, dove passano tutti gli scrittori
(`applySourceEdit`, `replaceSource`), quindi è una guardia sola invece di una per chiamante.

#### 3. Il controllo aritmetico: due numeri, e funziona su entrambe le forme

Il difetto più contato nei giudizi di mestiere — **4 volte su 10** — è «the composition
terminates into dead black frames because the Sequences are shorter than the container».
`findDurationMismatch` (easing.ts) confronta `durationInFrames` con i fotogrammi che le scene
coprono davvero, e rifiuta `finish`. Legge **quattro forme** in ordine di precisione:
`<TransitionSeries>` (somma delle battute **meno** le transizioni: l'overlap si conta una volta
sola), `<Series.Sequence>`, `<Sequence from/durationInFrames>` sciolte, e — la forma che conta —
le **guardie a mano** `const s2Active = frame >= 200 && frame < 410`, che sono **16 sorgenti su
24**. Due cancelli di questo repo erano già stati scritti indicizzando sui tag `<Sequence>` ed
erano spenti proprio dove il difetto viveva. Tolleranza 0,25 s: è l'arrotondamento di
`Math.round(2.1 * fps)` ripetuto su sei battute, non tolleranza estetica.

#### 4. Le molle sono il contenuto

Misura su tutti e 24 i sorgenti contro i voti di craft: **≥4 `spring()` → 7,70 di media** (8,8
spring, 6,8 interpolate); **≤2 → 4,98** (0,5 spring, 22,8 interpolate). Serie monotona, e il
peggiore mai giudicato — unico `kill` — ha 0 spring e 44 interpolate. Non è "eased contro
lineare": ogni interpolate porta già il suo `easing`. È **molla contro interpolazione**. Ogni voce
atterra su molle e porta la riga che impedisce la "riparazione" sbagliata: *una molla non ha campo
`easing` perché non le serve, la fisica È l'easing*.

Il test non riusa la soglia 4 così com'è, ed è dichiarato: quella misura vale per una
composizione intera, non per una voce che dimostra un meccanismo solo. Trasferisce l'altra metà —
almeno 2 molle, e mai più di 6 interpolate per molla — che rende impossibile la forma bocciata.

#### 5. Le sezioni sono la domanda, non la tecnica

`transitions/` (come passo alla scena dopo), `text/` (come arriva una frase), `posts/` (come un
post già approvato diventa movimento). Tre, perché il nome della sezione è il primo livello
dell'indice e un `ls` deve dimezzare la scelta. **Scartata `product/`**, che avevo proposto io: una
sezione con zero voci cotte non è un livello d'indice, è una cartella — e le regole sui mockup di
prodotto (letterbox, raggio, crop oltre il bordo) sono finite dentro le voci di `posts/`, che è
dove i giudizi le chiedono.

#### 6. Una voce, un movimento

`posts/2` aveva sopra una piastra con headline, badge e riga d'accento; `posts/1` aveva scrim e
didascalie dentro ogni card. Tolti tutti e due. Un template che si porta dentro il trattamento del
testo non è un template, è una grafica: chi lo copia si prende tutti e due e la voce smette di
incastrarsi con quelle di `text/`, che fanno esattamente quel mestiere.

Stessa regola applicata a una **fusione**: «griglia regolare inclinata che scorre» e «mosaico a
mattoni dritto che scorre» erano due candidate con l'85% di codice in comune e due righe d'indice
indistinguibili. Sono diventate **una**, `posts/2-media-wall`, con `TILT` come manopola. Due voci
quasi identiche sono lo stesso difetto dell'indice lungo che nessuno legge, travestito da
abbondanza.

#### 7. Il ciclo che si chiude

`2-media-wall` scorre su un piano **piastrellabile**: il modulo è una dissezione esatta di un
rettangolo 4×7 unità (undici caselle, nessun buco, nessuna sovrapposizione — la verifica colonna
per colonna è nel commento), e la battuta del ciclo dura esattamente il tempo di percorrere
l'altezza di un modulo. È l'unica voce dove la curva è quasi dritta invece che expo in-out, e il
perché è scritto lì: l'expo metterebbe una frenata e una ripartenza sul punto di giunzione, cioè
renderebbe visibile la cosa che il ciclo serve a nascondere.

#### 8. Le tre voci di testo rifatte, e la regola che le ha rifatte

`text/2`, `3`, `4` sono state bocciate a vista dal proprietario e rifatte: «già» senza accento (in
un file che viene **copiato**, un refuso si moltiplica), il blu `#0E4DFB` che legge come l'accento
di default di un framework, metà tela vuota, e didascalie che descrivono il template
(`UNA PAROLA ALLA VOLTA` con la barra di avanzamento) — cioè la stessa malattia del punto 6.

Il primo rifacimento ha introdotto un difetto peggiore: **il testo tagliato dal bordo destro**.
Con 86 px di margine per lato restano 908 px, e il sans bold occupa ~0,45 × fontSize per
carattere: **la riga più lunga in caratteri decide il corpo**, non il contrario — e sulla voce
dell'accento va contata la parola che scatta, che porta 44 px di piastra e il 114% di scala. Il
conto è scritto in testa a ognuna delle tre. È stato trovato guardando i fotogrammi cotti, non
rileggendo il codice.

#### 9. Cosa ho misurato del ricettario esistente

`npm run bake:motion-library -- --cookbook` renderizza tutte e 11 le voci. **10 su 11 rendono.**
`SCRIM_PLATE` moriva con `Error loading image with src:
https://example.com/replace-with-read_media-url.jpg` — un segnaposto che **non può renderizzare
per costruzione**, quindi una voce che nessuno poteva verificare e che, copiata alla lettera,
spediva un render fallito. Sostituito con un'immagine vera più il commento che dice di cambiarla.
`TransitionsCookbookEntry` ha ora un campo `renders`, riempito dalla cottura e non dalla
compilazione, e le voci con `renders: false` **non entrano nell'indice dell'agente**: restano nel
codice con il loro errore, perché toglierle in silenzio nasconderebbe il difetto.

#### 10. Dove la legge l'agente, e quanto costa

Le voci sono file leggibili con `read_file` sotto `how/motion/library/<sezione>/<voce>.md`,
registrate in `AGENT_FILES` con `indexed: false` — leggibili per path, **fuori** dall'indice di
radice. L'indice per intento (tre sezioni, una riga per voce) sta dentro
`how/MAKE-MOTION-VIDEO.md`, che chi scrive motion **deve leggere comunque** prima di poter
scrivere: quindi l'indice non costa nessun passo in più, e il corpo di una voce si paga solo
quando si apre davvero. Contro le 1005 righe in prompt a ogni passo, sono ~20 righe dentro una
lettura già obbligatoria. Il bucket `agent-docs` le materializza da sé (`defaults/`), e un
`overrides/how/motion/library/...` vince senza deploy: il meccanismo era già lì, questo lavoro ci
ha messo dentro il contenuto.

**Nessuna superficie per l'utente**: nessuna pagina, nessuna galleria. Gli MP4 servono a due cose
diverse — sono la prova che la voce renderizza, e sono ciò che il proprietario apre per giudicare
il movimento.

#### 11. Due regole del proprietario, e cosa di ognuna il codice può davvero decidere

**«Una UI non è uno sfondo»** — niente screenshot a tutta tela come fondale con elementi
programmatici animati sopra. Scritta dove appartiene, dentro `PRODUCT UI MOCKUPS` in `craft.ts`, e
in forma di meccanismo invece che di divieto: *il movimento accade DENTRO l'interfaccia* — il
cursore che arriva su un controllo, il campo che si compila, la tabella che si riordina.

Del controllo va detto cosa **non** fa: dal sorgente **uno screenshot e una fotografia sono
indistinguibili** — finiscono nello stesso bucket `media` con lo stesso tipo di URL, e non c'è
nessun segnale che dica quale sia una UI. Un controllo che provasse a indovinarlo sarebbe largo,
darebbe falsi allarmi e finirebbe spento, come i due cancelli che indicizzavano su un tag che metà
dei sorgenti non ha. Quindi `findFrozenBackplate` controlla la **metà certa**, che è anche quella
che porta il difetto: un `<Img>`/`<Video>` a tutta tela dentro un `<AbsoluteFill>` con lo stile
fatto di soli valori fissi **non si muove**, e tutto ciò che gli sta sopra galleggia. È la regola
«nessuna scena statica, mai» applicata all'unico elemento che `findStaticTails` non può vedere: un
tag `<Img>` non contiene interpolate. Rifiuta `finish` e il messaggio porta entrambe le correzioni,
perché il codice non sa quale dei due casi ha davanti.

**«Usare il più possibile i template»** — l'adozione misurata è l'**8%**: i marcatori `// wow:`
compaiono in 2 sorgenti su 24, `<TransitionSeries>` in 6 e sempre solo con `slide()`. Non è
disponibilità: l'indice è dentro la lettura obbligatoria. Aggiunte due righe a `craft.ts` col verbo
giusto — **copia e adatta, non riscrivere il meccanismo** — con i numeri davanti.

Il controllo **non l'ho aggiunto, ed è deliberato**: esiste già ed è nel posto giusto.
`craft-review.ts:209` rifiuta una composizione a 4+ battute senza `fullCanvasScale` né
`sharedElement`, e `detectWowMechanisms` li deduce dalla **forma del codice** — una scala che
supera davvero la camera, un elemento che attraversa davvero il taglio — non dal commento. Un gate
sul marcatore sarebbe falsificabile scrivendo una riga di commento, cioè misurerebbe la buona
volontà invece del mestiere. La riga nelle specifiche adesso lo dice esplicitamente al modello,
così non spreca token a decorare.

#### 12. Gli accenti, e perché sono finiti in un test

Lo stesso vizio ha colpito due volte in un pomeriggio: «gia» senza accento **dentro un fotogramma
renderizzato** — e queste voci esistono per essere copiate, quindi un refuso si moltiplica — e un
`c'è` dentro una stringa a virgolette singole in `library/index.ts`, che **ha rotto il dev server
del proprietario**. Due sintomi, una disattenzione.

Sistemati tutti (18 file, commenti e stringhe) e messo un test che scandisce ogni voce. `ponytail`:
elenco chiuso di parole invece di un pattern generico — `[a-z]'` prenderebbe ogni stringa a
virgolette singole che finisce per vocale, e un controllo che dà falsi allarmi viene spento. Ha già
trovato un residuo che il giro a mano aveva mancato, in una stringa renderizzata.

#### 13. I video non si versionano, la prova sì

Il proprietario ha chiesto di mettere i video della libreria in `.gitignore`: **46 MB di binari
rigenerabili**, e la cartella era interamente non tracciata — un `git add -A` se li sarebbe presi.
Giusto. Ma toglie il piede da sotto al test: su un clone fresco `preview.mp4` non esiste, quindi
`expect(existsSync(mp4)).toBe(true)` sarebbe rosso per chiunque non abbia cotto in locale.

**La risposta facile era la peggiore**: far saltare l'asserzione quando il file manca lascia il
test VERDE proprio nel caso in cui non sta verificando niente. Un test che si disattiva da solo
quando la condizione non è comoda è peggio di nessun test, perché nessuno va a guardarlo.

Quindi si versiona la **prova**, non il payload. `bake-manifest.json` lo scrive la cottura e dice,
per voce: che ha renderizzato, quando, quanto pesa, quanti fotogrammi, e **l'impronta del
sorgente**. L'impronta è il pezzo che lo tiene onesto — modifica un `source.tsx` senza ricuocere e
il test cade dicendo esattamente `npm run bake:motion-library -- <voce>`. Senza, il manifesto
sarebbe una bugia che invecchia, cioè lo stesso difetto dei commenti stantii che questa sessione ha
trovato altrove. È la stessa idea del campo `renders` del ricettario, estesa invece che duplicata.

Il manifesto si **fonde** invece di sovrascriversi: una cottura parziale — una voce sola, o una VM
che scade a metà, che è successo — non cancella la prova delle altre. E resta la seconda rete: dove
i file ci sono davvero, il test li guarda (MP4 troncato, fotogrammi che non combaciano con
`meta.json`), cose che il manifesto da solo non vedrebbe.

Peso ridotto anche a monte: `--crf=23` invece di 18 sui video e fotogrammi a mezza scala. Sono
anteprime per giudicare un movimento, non consegne — 112 MB sono diventati ~46. Nel bucket
`agent-docs` non ci sono mai stati e non ci devono andare: lì ci va ciò che l'agente legge, e
nessun modello legge un MP4.

### Il percorso programmatico delle grafiche: perché non reggeva, e cosa lo tiene su adesso

Il 97,4% delle grafiche statiche sono immagini di diffusione. Il percorso **programmatico**
(satori: HTML/TSX → SVG → PNG) — l'unico che disegna il testo dai contorni dei font invece di
farlo allucinare a un modello — ha prodotto **6 post in 60 giorni**. Sei difetti, in ordine.

#### 1. Il compositore non aveva né un timeout né un ritentativo

Prima cosa da dire perché smonta metà della diagnosi di partenza: la tabella dei fallimenti che ha
aperto questo lavoro (`compose_graphic` 18,5% ko, `revise_graphic` 16,7%) **mescola due ere**.
`composeGraphic` e `reviseGraphic` — il compositore a blocchi — **non hanno più nessun chiamante**:
tutte le porte passano dalle varianti *Source* da quando sono state introdotte (13/8/2026). Le 27
chiamate `compose_graphic` e le 12 `revise_graphic` sono di prima, e infatti si fermano il 13/8. Il
percorso vivo, `compose_graphic_source`, ha 5 chiamate: 2 fallite con `HTTP 500` la settimana del
10/8, zero da allora.

I difetti però sono reali e valgono identici sul percorso vivo, perché il trasporto è lo stesso
(`structuredKie`). Dai `ms` di `ai_calls`, i fallimenti sono di **due specie opposte**:

| | quando muore | cosa fare |
|---|---|---|
| `HTTP 524` (×3) | **125.034 / 125.034 / 125.037 ms** — il bordo Cloudflare di kie molla a ~125s | **non riprovare**: sarebbero 4 minuti per due fallimenti |
| `HTTP 500` / `Server exception` (×6) | 1.499 – 17.408 ms | **riprovare**: è un singhiozzo, e nessuno riprovava |

E i successi: p50 18,4s, p90 78,2s, max 120,4s.

`structuredKie` faceva `fetch` **senza `signal`**, quindi su un 524 il chiamante bruciava 125
secondi interi prima di sapere di aver fallito — dentro un turno di chat che ne ha 300 in tutto. E
non riprovava mai, quindi un 500 da un secondo e mezzo uccideva la composizione.

Adesso: `AbortSignal.timeout(120_000)` (sotto il 524, sopra il p90 dei successi) e **un solo**
ritentativo, concesso solo se il tentativo è morto entro 30s — `shouldRetryKie`, testata sui numeri
veri. Vale per ogni chiamata strutturata a kie, non solo per le grafiche.

Secondo pezzo, e questo era il vero silenzio: `composeGraphicSource` aveva un `catch {}` **muto**
che ripiegava sul compositore a blocchi, e `reviseGraphicSource` un secondo `catch {}` che
**ricompone da zero** — cioè l'utente chiede «accorcia il titolo» e si ritrova un'altra grafica.
Entrambi ora scrivono la ragione vera nei log prima di ripiegare. Non sono stati rimossi: una
grafica peggiore è meglio di nessuna grafica. Ma finché tacevano, i 27 giri del ramo a blocchi
sembravano il percorso normale invece del sintomo che erano.

#### 2. Il gate esisteva e lo vedeva una porta su quattro

`inspectGraphicTree` cammina l'albero che satori rasterizza davvero. Era agganciato **solo** a
`write_source` / `replace_source`, le due tool che *patchano* una grafica. Le tre porte che ne
**compongono** una da zero — `create_post(graphic_brief)`, `designPostGraphic`, il media generator
— non lo chiamavano mai: **la prima composizione, quella che poi si pubblica, non era mai stata
controllata.**

Un innesto solo, e nel punto giusto: `renderGraphicSource` l'albero ce l'ha già in mano, quindi
l'ispezione vive lì e l'esito torna dentro `RenderedGraphic.issues`. Ogni chiamante presente e
futuro è coperto senza saperlo, e ognuno decide da sé cosa farne.

Sopra ci sta `composeAndRenderGraphic` (design-compose.ts): componi (o revisiona) → renderizza → su
un difetto **bloccante** un solo giro di riparazione via `reviseGraphicSource`, che i `detail` del
gate li prende già come correzione. Un giro, non un ciclo: due costano più della grafica che
salvano. Le tre porte ora passano tutte da lì e restituiscono `design_warnings`.

**L'eccezione preservata**: l'editor del browser (`applyPostGraphicSource`) continua a salvare
sempre. I difetti gli arrivano come avvisi e mai come rifiuto — rifiutare il salvataggio a una
persona che sta guardando la propria tela resta assurdo.

#### 3. Il sorgente non si perde più in silenzio

`graphic_designs.source` **esiste** in produzione (0167 applicata a mano). Ma era `NULL` su tutte e
18 le righe, e il colpevole era ancora armato: un ripiego in `saveGraphicVersion` reinseriva la
riga **senza `source`** quando l'insert falliva con un errore contenente la parola "source", e
tornava il numero di versione come se fosse andata bene. Risultato: due grafiche HTML v2 con uno
`spec` di 41 caratteri e nessun sorgente, che `parseGraphicRow` restituisce come `null` — cioè
**illeggibili per il codice che le aveva appena scritte**.

Tolto. Un salvataggio che riesce a metà e non lo dice è peggio di uno che fallisce. Tolti anche i
due ripieghi gemelli in lettura (`latestGraphic`, `graphicHistory`), che rileggevano senza la
colonna e degradavano ogni riga v2 a "grafica senza sorgente": facevano sparire la cronologia
invece di dire che mancava una migration.

#### 4. Un post senza immagine poteva essere pubblicato

31 post non testuali negli ultimi 90 giorni senza `media_url` né `media_urls`: 5 approvati, 5
schedulati, **1 pubblicato**. Il controllo deterministico esisteva già
(`deterministicPrepublishIssues`, "Visual post has no media") ma gira solo dal cron che giudica
poco prima dello slot — e c'è una porta che gli passa davanti: il ramo *«nessun account
collegato»* di `publishApprovedPost` scrive `status = 'approved'` e torna **prima** del gate.

La guardia va in cima a `publishApprovedPost`, che è la strozzatura condivisa da approve (UI, CLI,
chat), approvazione via email, radar, repost, riprogrammazione e scheduler — riusando i due helper
puri che già esistevano. Una sola, non una per chiamante: mettere la guardia in ogni chiamante è
esattamente il modo in cui era già stata mancata.

#### 5. Il ciclo critica → rigenerazione, e il 401 che non faceva rumore

Due cose diverse, tenute separate apposta.

**Il ciclo era già limitato**, contro il sospetto di partenza: `MAX_QC_RETRIES = 2`, cioè al massimo
tre tentativi, più `HIGH_STAKES_CANDIDATES = 2` candidati paralleli sui post ad alto rischio. Non
c'è nessun anello aperto. Le ~10 critiche per post vengono dai caroselli (una per slide) e dalle
rigenerazioni chieste a mano, non da una giostra.

Quello che mancava è **sapere se il ciclo serve**: `posts.qc` registrava `retried` come un
**booleano**, quindi la domanda che decide il numero giusto — il giro N porta un voto più alto del
giro N−1? — era senza risposta possibile. Adesso `posts.qc` porta `attempts` (quanti render sono
davvero serviti) e `capped` (il tetto è scattato e si è spedito comunque), con un `console.warn`.
Un troncamento muto si legge come «è il meglio che sapeva fare», che è un'altra cosa.

Perché il tetto **non scende oggi**: su 164 post con un voto, 45 hanno riprovato, 36 sono finiti a
"passa" e 9 hanno esaurito il tetto partendo lo stesso — il ritentativo serve nell'80% dei casi in
cui scatta. Ma il giudice timbra **7/10 su 124 post su 164**, e 31 dei 36 recuperi atterrano
esattamente su 7: un anello di correzione guidato da un segnale che quasi non varia non converge,
si ferma dove finisce il budget. Il numero giusto lo dirà `attempts` fra qualche settimana. Tagliare
adesso sarebbe intuito.

**Il 401.** 166 chiamate `critiqueImage` respinte con `HTTP 401` dalla tier vision di MiMo
(`mimo-v2.5`), il 4,9%. Verificato giorno per giorno: **il ripiego su Gemini le ha prese tutte,
1:1** — nessuna immagine è rimasta senza critica, ed è precisamente per questo che il guasto è
passato inosservato per due settimane. Quello che costava era il tentativo condannato *prima* di
ogni ripiego: mediana 2,2s, col base64 dell'immagine addosso. La tier `mimo-v2.5-pro` intanto
risponde regolarmente, quindi non è la chiave in generale.

Stessa medicina già scritta per DeepSeek: al primo 401/402 quel **modello** esce di scena per il
resto del processo, con un `console.error` in chiaro. Per modello e non per provider, perché il
guasto è selettivo. Nessun TTL: su Vercel il riciclo del processo è già il timer.

#### 6. Le regole grafiche misurate non arrivavano al prompt che compone

Il buco strutturale, e valeva più degli altri. Due skill con numeri veri
(`graphic-feed-legibility`, `graphic-palette-discipline`) arrivano all'**agente di chat** via
`brand-memory`. Ma `design_graphic` fa una **seconda chiamata separata** con `HTML_SYSTEM`, che di
quelle regole non sapeva niente: delle sue 29 righe, 20 erano il contratto tecnico di satori, 3 il
contratto TSX, e 6 consigli qualitativi **senza un numero dentro**.

`GRAPHIC_CRAFT_SPECS` (`src/lib/design/graphic-craft.ts`, client-safe come `MOTION_CRAFT_SPECS`
perché la UI deve poter mostrare le stesse regole) prende il posto di quelle sei righe, e viene
aggiunto sia a `sourceSystemFor` sia a `systemFor` — vale anche per il ripiego a blocchi.

Il contenuto non è inventato: sono le due skill più **le due regole vere rimaste nel ramo morto**.
Il compositore legacy era più ricco di quello vivo e conteneva l'unica regola tipografica con un
esempio del repo (dove spezzare una headline: «Nove posti.\nTu ne presidi uno.») e l'unico numero
di contrasto su foto (il velo 0.4–0.55). Recuperate.

Tutto in **frazioni di tela, mai in pixel** — la disciplina che il gate e i preset hanno già. Un
test lo verifica riga per riga: ogni px citato porta la sua percentuale accanto.

#### 7. Il gate ora ha i suoi test, e quattro regole in più

`src/lib/design/graphic-check.test.ts` non esisteva: il gate era coperto solo di riflesso da
`default-skills.test.ts`, che lo guarda come illustrazione delle skill. Adesso ci sono 28 test suoi,
tutti passando dallo stesso `htmlToSatori` che alimenta il renderer.

Quattro regole nuove, con lo stesso metro di quelle vecchie:

* **`off_canvas` (BLOCCA)** — testo `position:absolute` piazzato interamente oltre il bordo. La
  radice è forzata `overflow:hidden`, quindi non esonda: viene **tagliato via**. È testo presente
  nel sorgente e assente nel prodotto, esattamente come il testo troppo piccolo, e i numeri sono
  letterali. Non scatta su un bleed che tocca ancora la tela, né su una forma senza parole, né
  quando la posizione la decide il flex — lì nessun controllo statico può sapere, e tacere è
  l'unico comportamento onesto.
* **`outside_safe_area`** (avviso) — il padding **dichiarato sulla radice** sotto il 3% della
  larghezza. Se la radice non dichiara niente non si dice niente: il margine può venire da un
  figlio o da un flex centrato, e inventare un difetto sarebbe peggio che non vederlo.
* **`line_too_long`** (avviso) — una riga di corpo oltre i 45 caratteri, il numero della skill. Non
  si applica alle headline: a quella dimensione la misura è un altro numero.
* **`logo_missing`** (avviso) — il logo del brand offerto in AVAILABLE IMAGES e mai usato. Letto
  sul **sorgente** e non sull'albero, deliberatamente: al render ogni URL è già un data URI e nel-
  l'albero il logo non è più riconoscibile.

**Il vincolo di metodo**: una regola tiene solo se vive in tre posti — il prompt, un esempio che
compila, un controllo che rifiuta l'imitazione. Un blocco di test lega `GRAPHIC_CRAFT_SPECS` alle
costanti del gate: se qualcuno cambia una soglia senza toccare il prompt che la insegna, cade lì.

### Il giudice automatico dei post è spento (interruttore, non demolizione)

`video-review` — il voto 0-10 con verdetto `ship/fix/kill` sullo standard organic/ads — non parte
più da solo. `AUTO_VIDEO_REVIEW_ENABLED` in `video-review.ts` (`AUTO_VIDEO_REVIEW=on` lo riaccende),
consultato in **due punti** più la riga di cron:

* `queueVideoReview` — la coda **è** l'automatismo: produttore, scheduler, render di una clip,
  salvataggio di un media, modifica di un post, tutto finisce lì. Chiuderla lì invece che in dodici
  chiamanti è il motivo per cui fra un mese non ricompare un innesco scoperto.
* `scoreFinishedClip` con `auto: true` — il giudizio in linea che pilota il rifacimento (produttore
  UGC, lotto UGC, job motion).
* Rimossa da `vercel.json` la riga `*/5` su `/api/v1/videos/review/work`. **L'endpoint resta**:
  è anche il modo in cui una review chiesta a mano viene drenata.

**Resta acceso tutto ciò che una persona chiede**: `POST /api/v1/brands/:slug/videos/review` e il
comando CLI, la pagina di review nel browser, il tasto QC del workbench motion, il «richiedi
review» in Impostazioni › Media reviewer (che ora passa `manual: true`), e le tool di chat.

**Perché.** La rubrica è quella dei video applicata anche alle immagini: `ORGANIC_DIMENSIONS` è una
lista sola, quindi su una grafica ferma vengono comunque giudicate `sound_off`, `hold`,
`spoken_craft` e `loop_worthiness` — dimensioni che su un'immagine non vogliono dire niente e
deprimono l'`overall` per costruzione. Su **511 review statiche**: 160 `kill` e 284 `fix` contro 67
`ship`, cioè l'87% del nostro stesso lavoro bocciato da un metro che non era fatto per misurarlo. E
`anatomy` — l'asse anti-artefatto, dichiarato obbligatorio — risulta compilato in **1 review su
511**.

**Cosa NON è stato toccato.** Nessuna riga cancellata: `video_reviews` (620), `posts.qc`,
`motion_craft_scores` restano, sono l'unica serie storica di qualità che abbiamo e servono a dire
se il prossimo giudice è migliore. E **`market_video_analyses` non c'entra**: l'analisi del campo
(`market-video-analysis.ts`, cron `market/*`) chiama il giudice per conto suo su contenuti di
mercato e scrive in una tabella diversa — resta accesa. Va detto perché la nota di consegna
attribuiva al field watch le 137 righe di `video_reviews` con `post_id` nullo: **non è così**, tutte
e 217 puntano al nostro storage e vengono da media generator, render motion e upload dell'utente.

**I consumatori del verdetto, e cosa succede a ciascuno** — tutti degradano a vuoto, nessuno
mostra un voto fantasma: Impostazioni › Media reviewer (elenco e riquadri: la storia resta, smette
di crescere), `weekly-recap` (la riga sulle review sparisce se non ce ne sono), `strategy-agent-reads`
e `video-review-agent` (blocco vuoto nel prompt), `media-review-stats` (statistiche ferme),
`maybeFlagPostForMediaRemake` (nessun `needs_attention` da QC media). `media_origin` non legge il
verdetto: descrive come il media è stato fatto.

### `schema-drift-check.mjs`: ciò che il codice nomina, contro ciò che il database ha

Le grafiche erano rotte da otto giorni e nessuno l'aveva visto. La 0167 aggiungeva
`graphic_designs.source`, non era stata applicata in produzione, `design-store.ts` selezionava
quella colonna: PostgREST rispondeva 42703, il codice leggeva `data` come null, e OGNI lettura di
una grafica tornava vuota. Nessun crash, nessun allarme. Terza volta che lo stesso meccanismo
produce un guasto muto — in questo repo i deploy non eseguono le migration.

La richiesta era «estrapolare ogni query e verificare che funzioni». Il metodo scartato è
**eseguirle**: una `insert` del prodotto non sa di essere una prova, e girerebbe sul database dei
clienti. Il metodo scelto è **confrontare i nomi**, e il validatore era già lì: PostgREST.
`?select=<colonna>&limit=0` fa risolvere il nome a Postgres senza leggere una riga e risponde
42703 / PGRST205 / PGRST200 quando il nome non c'è, 42501 o 200 quando c'è. Con la chiave **anon**:
zero righe, zero scritture, nessun dato di cliente toccato, e si punta alla produzione.

Tre confronti in un file solo, senza dipendenze nuove:

* **codice → database** — un walker delle catene `.from().select()/.eq()/.insert()` (niente parser
  TypeScript: risolve anche `select(SELECT)` con la costante del file, che è la forma esatta di
  `design-store.ts`), e ogni nome letterale finisce in una sonda. Quando una `select` a più colonne
  fallisce, si toglie quella che PostgREST nomina e si richiede, così ne trova due o tre in un giro.
* **migration → database** — cosa ogni file di `supabase/migrations` introduce (con rename e drop
  scontati) contro cosa esiste davvero: è così che si dice quali migration **non sono applicate**.
* **codice → vincoli** — i literal scritti in una colonna con un `check (… in (…))`, in unione su
  tutti i file: è la famiglia che ha già bloccato l'autopilot per 30 giorni.

Due decisioni che valgono più del resto. **L'autotest all'avvio**: prima di ogni giro lo script
verifica di saper ancora distinguere una colonna che esiste da una che non esiste, e se non ci
riesce esce 2 senza stampare risultati — un verde bugiardo è precisamente il modo in cui
l'incidente è passato inosservato. **La dichiarazione di ciò che non sa guardare**: 277 punti nel
codice (select costruite a runtime, oggetti passati per variabile, spread) e quattro famiglie di
schema (policy RLS, indici, NOT NULL, CHECK vivi ma non in nessun file) sono stampati con il
conteggio, più i nomi delle migration che allargano solo un `check` e la cui applicazione da fuori
è indistinguibile. Un controllo che tace su ciò che non copre è peggio di uno che lo ammette.

Primo giro: **20 divergenze**, zero falsi positivi. `0168_prepublish_gate.sql` non applicata (il
gate pre-pubblicazione non ha mai guardato un post), 14 colonne che il codice sbaglia a nominare,
6 valori che un `check` rifiuta, e 0162/0163/0178 da verificare a mano.

### Il ricettario non è più un muro nel prompt: è un file che gli agenti DEVONO leggere

Craft specs + ricettario delle transizioni stavano dentro gli head di `content` e `motion` come una
costante, `REMOTION_CRAFT_BLOCK`: **14.875 token ricopiati a ogni step di ogni turno**, anche
mentre si scriveva una didascalia, anche senza un video in giro. E il modello **non li copiava
comunque** — nel video da 3,5/10 aveva scritto confronti sul numero di fotogramma a mano invece
delle sequenze che il ricettario insegna. Un muro che si paga sempre e si applica quando capita.

**Le misure che hanno deciso il progetto** (22/8/2026, registro completo dei tool + `ai_calls` e
`chat_messages` di produzione):

| | |
|---|---|
| definizioni dei tool, `content` | 120 tool, **29.989 token** per step |
| di cui blocco condiviso | **78 tool su 120 = 18.904 token, il 63%** |
| `buildAgentHead('content')` | **22.302 token**, di cui 14.875 di ricettario |
| prosa dentro le definizioni | **66%** (41% description + 25% describe dei campi) |
| turno del trailer (thread `fac6cc33`) | 25 tool call, **301.075 token in ingresso, 448 in cache (0,15%)**, 302.189 ms — il muro dei 300s al secondo — e nessuna chiamata di produzione |
| tool mai chiamati in 60 giorni | **47 su 148**, di cui 26 nel blocco condiviso |

La conclusione che ha riscritto il piano: **trasformare i 27 tool di lettura in file vale il 13%**,
perché le letture sono già magre (3.303 token in tutto). Il peso è la prosa delle azioni e il
ricettario nel prompt. Si è partiti da lì.

**Cosa c'è adesso.** `src/lib/server/chat/agent-files.ts`: un registro di file, `read_file` e `ls`
come uniche primitive, e un indice **per mestiere** nel prompt. Il ricettario è
`how/MAKE-MOTION-VIDEO.md`, servito dalle stesse costanti compilate di prima
(`craft.ts` + `transitions-cookbook.ts`) — nessuna seconda copia che possa divergere.

**Il file è facoltativo da leggere e obbligatorio per agire.** `create_motion_video`,
`write_motion_source` e `replace_motion_source` rifiutano finché non è stato letto **in quel turno**,
e il rifiuto nomina il file. È la cosa che col prompt è impossibile: la regola era davanti agli
occhi e restava facoltativa, adesso è a portata di mano ed è vincolante.

- **`opts.messages`, non una closure.** Una closure in `createChatTools` si azzera a ogni
  continuazione dopo il muro dei 300 secondi, e costringerebbe a rileggere a ogni ripresa. La
  storia rigiocata porta la lettura con sé: gratis. C'è un test che è esattamente quella proprietà.
- **L'indice sta nel prompt, non dietro `ls`.** Se per sapere cosa esiste bisogna chiamare `ls`,
  ogni lettura costa due step invece di uno e il meccanismo perde sulla latenza ciò che vince sui
  token. La misura era già in casa: l'indice delle skill in `buildMemoryContext` comprime **14×**
  (6 skill, 2.174 token di corpi contro 156 di indice, ~26 token a riga).
- **`how/` è per mestiere, i dati del brand sono di tutti.** Stesso campo `agents` di
  `DEFAULT_SKILLS`, stessa semantica. L'Analyst non paga le righe dei tutorial che non può usare, e
  un file che non sta sotto `how/` nasce `agents: null` — un test lo impone, altrimenti un rifiuto
  manderebbe l'Analyst a chiedere a Motion quali sono i prodotti del brand.
- **Una dichiarazione sola.** `REQUIRED_READS` è **derivato** da `unlocks`, non è un secondo
  elenco. E il test che conta: *per ogni agente, ogni azione che pretende un file deve avere quel
  file nel proprio indice*. Senza, un mestiere terrebbe in mano uno strumento che gli è vietato
  imparare a usare — uno strumento che **non può mai chiamare**, invisibile finché qualcuno non ci
  sbatte.
- **`render_motion_video` NON è nel cancello**, a differenza delle altre tre. Rifiutare al render
  butterebbe via venti step di lavoro quando il sorgente è già stato scritto sotto questo stesso
  cancello; e la pagina `/motion-video` esclude le tre ma non quello, quindi le pretenderebbe la
  lettura di un testo che il suo prompt contiene già per intero.
- **Il rifiuto instrada verso `delegate_task`, non verso `message_agent`.** Il rifiuto arriva a
  metà lavoro: serve adesso, in questo turno. `delegate_task` apre un sotto-agente dentro il turno
  in corso e il risultato torna subito; un DM accoda un turno intero del collega (misurato:
  $0,05-0,13 e 25-186 secondi) e la risposta arriva quando questo turno è finito. Anche l'uso dice
  la stessa cosa: 60 giorni, `delegate_task` 20 chiamate, `message_agent` 3.

**Il bucket `agent-docs`, perché finora era una scatola nera.** Il proprietario non aveva modo di
vedere cosa gli agenti leggono. Adesso `defaults/how/…` è scritto da noi e rigenerato (= ciò che
dice il codice), `overrides/how/…` è scritto da lui e **vince quando c'è**, `INDEX/<agente>.md` è
l'indice vero che quel mestiere riceve nel prompt — generato dalla stessa `filesIndexFor`, mai
scritto a mano, perché un documento che si può scrivere a mano è un documento che diverge. Il
riallineamento tocca solo `defaults/`: **non può cancellare una sua modifica**, e la garanzia sta
nella forma delle cartelle invece che in un controllo che qualcuno può dimenticare. Cancellare un
oggetto in `overrides/` è il rollback. `GET /api/v1/agent-files` (Bearer `CRON_SECRET`, cron alle
03:00) riallinea e restituisce la mappa. **Serve la migration 0214, scritta e non applicata**:
finché non lo è, ogni lettura degrada in silenzio sul codice compilato.

**Risparmio misurato, per step:**

| agente | prima | dopo | |
|---|---|---|---|
| `content` | 52.301 | **37.732** | −28% |
| `motion` | 43.363 | **28.794** | −34% |
| `ugc` / `web` / `analyst` | invariati | invariati | le primitive stanno solo dove c'è un file |

Detto onestamente: il 100% sui turni che non toccano il motion (in 60 giorni i tool del sorgente
motion compaiono in 4 thread su 79), e circa un quinto su quelli che lo toccano — dopo la lettura
il testo resta nella storia del turno come ci stava prima. **L'argomento non sono i soldi**: ai
volumi di oggi (307 turni in 30 giorni, $17,99 in tutto) vale ~$9 al mese. L'argomento è il muro
dei 300 secondi, dove metà dei token in ingresso di un turno che lavora sono definizioni e prompt
che a quel lavoro non servono.

**La via di ritorno**, esplicita perché chi arriva dopo deve saperla: se il cancello peggiora gli
agenti motion invece di migliorarli, si rimette `${MOTION_CRAFT_SPECS}\n\n${MOTION_TRANSITIONS_COOKBOOK_PROMPT}`
nei due head di `agents.ts` e si toglie `unlocks` dal file. Due righe, le costanti sono ancora al
loro posto.

### La cartella editabile: 129 file nel bucket, e l'indice del prompt non si muove di un token

Il proprietario: *«in questo momento è tutta una scatola nera, non ho idea di che cosa gli agenti
vanno a leggere»*. Adesso lo apre e lo legge, e può correggerlo — il mestiere lo conosce lui.

**Nel bucket `agent-docs`, `defaults/`: 129 file, ~135.000 token.**

| | file |
|---|---|
| `skills/remotion/` — documentazione Remotion ufficiale | 74 |
| `how/motion/` — ricettario transizioni, craft specs, seme | 24 |
| `library/` — animazioni (posts, text, transitions) | 22 |
| `how/skills/` — le skill di prodotto | 6 |
| `how/MAKE-MOTION-VIDEO.md`, `how/WRITE-VIDEO-PROMPTS.md`, `how/graphic/seed.html` | 3 |

**E l'indice nel prompt è rimasto fra 124 e 257 token per mestiere.** È la tesi di tutta la
giornata che si verifica da sola: 135.000 token di materia costano **zero** finché nessuno li apre.
In un prompt non ci sarebbero mai stati.

Il campo che lo rende possibile è `indexed`. Il registro ha due mestieri che non coincidono: cosa un
agente **può leggere** (tutto) e cosa vale la pena **elencargli a ogni turno** (pochissimo).
L'albero è completo, l'indice è curato — le mappe Cesium/Mapbox sono il 48% del corpus Remotion e
noi facciamo motion graphics per i social: elencarle farebbe decidere peggio.

**Un difetto trovato prima di materializzare.** `remotion-markup/remotion-maps/` è una copia
verbatim di `remotion-maps/` — 32 file, identici tranne la profondità dei link relativi (`diff -rq`:
l'unico che differisce è `static-map/TECHNIQUE.md`, e differisce solo per `../../../` contro
`../../../../`). Materializzati entrambi, ogni `grep` sulle mappe sarebbe tornato in doppia copia —
e la prima volta che succede l'agente conclude che la libreria è inaffidabile. Escluso il ramo
annidato. Il primo tentativo di esclusione **non mordeva**: le chiavi di `import.meta.glob` non
hanno lo slash iniziale, quindi il `replace` non tagliava il prefisso. Se ne è accorto il conteggio
(81 file invece di 66), non una lettura del codice.

**`.agents/skills/` non era letto da nessuna riga di `src/` o `scripts/`.** Serviva agli agenti che
lavorano su questo repo, non a quelli del prodotto: le skill Remotion **non arrivavano né a
`motion` né a `content`**. Ci arrivano da adesso, e solo perché passano dal registro. È il tipo di
cosa che sembra fatta e non lo è.

**`grep` cambia forma**: `path` diventa un PREFISSO facoltativo, e senza si cerca ovunque. È ciò che
rende 129 file utili invece che rumorosi. E **dichiara dove ha cercato** (`searched_files`,
`not_searched`, `scope`): un `grep` che tace su ciò che non guarda è cieco in silenzio, e l'agente
legge «nessun risultato» come «non esiste». `ls` senza prefisso nomina le guide curate e riassume il
resto in una riga per cartella.

**`how/WRITE-VIDEO-PROMPTS.md` — la guida ai prompt Seedance, con un cancello che morde solo dove
serve.** Il ricettario ha il cancello perché senza si scriveva l'import sbagliato: due render morti.
Qui il danno equivalente è chiedere al diffusore di **scrivere del testo**, e la misura è peggiore:
131 prompt su 340 lo chiedono, e il **16,8% delle review ritrova testo corrotto** («Social growts»,
«Scopa menu»). Ma morde solo sui video, via il nuovo predicato `only`: **il cancello è per TOOL, non
per argomento**, e `create_post` fa anche foto e caroselli — pretendere una guida sui video prima di
una foto sarebbe il cancello che qualcuno toglie perché dà fastidio.

**Un incrocio che vale da solo la consegna.** `skills/remotion/remotion-markup/transitions.md`
righe 154-164 documenta l'import per submodule (`@remotion/transitions/slide`, `/wipe`, `/flip`)
contro la radice — che è **esattamente** il nostro difetto più costoso sul motion, arrivato in
produzione due volte. Il nostro gate in `modules.ts` era già giusto; adesso c'è la fonte ufficiale
da citare per nome invece di rispiegarla a parole nostre.

**Perché non biforca.** `defaults/` è uno **specchio in sola scrittura**: non viene mai letto a
runtime. La lettura è `overrides/` oppure il codice compilato. Un bucket non riallineato può
ingannare chi guarda, **non può cambiare il comportamento di un agente**. Cinque test lo pinnano —
override che vince, default che è il codice, override vuoto che non svuota la guida, storage che
fallisce a metà lettura e non svuota niente.

### I segreti si tolgono alla scrittura — e il tentativo precedente girava a vuoto

Avevamo cablato `SandboxSession.secrets()` fino a `saveAgentSession` convinti che il registro dei
valori coniati arrivasse a chi scrive la traccia. **Non ci arrivava mai.** `onSecret` è cablato solo
dentro `...(opts.deviceLogin ? …)`, `deviceLogin: true` esiste solo in `withSandboxTools`, e il
sotto-agente costruisce un `createSandboxTools` **nuovo**: il suo `Set` era sempre vuoto, `scrub`
era l'identità, e `secrets: []` faceva uscire la redazione dal suo primo `if`. Un meccanismo che
sembrava cablato e proteggeva niente.

E lo scrittore era un altro: le **267 righe** di `agent_sessions` in produzione hanno
`system_prompt` fino a **148.295 caratteri** contro i 40.000 dichiarati da `saveAgentSession` — non
passano da lì, le scrive `harness/persist.ts`, **grezze e senza tetti** (transcript da 1.029.357).
Redigere solo l'altro ramo sarebbe stato teatro: quel ramo, in produzione, non ha scritto una riga.

**Copertura, misurata sul `.env` vero (31 nomi da credenziale su 43 righe con valore):**

| | prima | dopo |
|---|---|---|
| come `NOME=valore` | **3/31 (10%)** | **31/31 (100%)** |
| come valore nudo, solo per forma | — | 19/31 (61%) |
| come valore nudo, con il registro dei valori | — | **31/31 (100%)** |

I 12 che solo il registro salva sono UUID ed esadecimali nudi (`EXA_API_KEY` è un UUID,
`CRON_SECRET` è hex64): restano allowlistati per forma, o si cancellerebbe ogni hash di commit e
ogni `brand_id` della traccia.

**`src/lib/server/redact.ts`** — cinque strati in ordine fisso: valori noti (con 9 varianti: case,
senza trattini, JSON-escaped, urlencode, base64, base64url, hex), 18 forme di provider,
nome→valore, URL, blob opaco fail-closed. Due dettagli che sono la differenza fra funzionare e
sembrare di funzionare: **niente `\b` davanti al nome** (è ciò che faceva passare ogni
`GEMINI_API_KEY=`, perché `_` è un carattere di parola) e la **classe del valore negativa**, così
`Tr0ub4dor&3` non sfugge per via del carattere che nessuno aveva previsto.

Il registro dei valori è **per BRAND, non per closure**: la VM è del brand
(`anomalia-<brandId>-<mode>`), orchestratore e delegati la condividono, e `persist.ts` — che non ha
nessun `Set` — ci arriva lo stesso.

**Dove si applica:** in `harness/persist.ts` (i quattro campi, con i tetti che lì non c'erano), nel
recorder **prima di `clipEventData`** (redigere dopo lascerebbe dieci caratteri di token appesi al
troncamento: sedici tentativi di forza bruta, non un segreto), su `system_prompt` ed `error` che non
passavano da nessuna redazione, e come cintura in lettura per le righe già scritte.
`format_version: 2` marca «redatta alla scrittura» — **la colonna esiste già, nessuna migration.**

**Quello che nessun filtro sul testo può chiudere, e come si chiude:** `fold -w8`, `rev`,
`A=${TOK:0:18}` spezzano il valore e passano ogni strato — provati. Quindi quando nella VM vive una
credenziale (una domanda sola all'apertura: `.anomalia/github-device.json`, `.github.env`), la
traccia **non registra più** stdout/stderr dei comandi. Il modello continua a vederli nel turno: è
la copia scritta per sempre a non tenerli.

**E la porta che era aperta adesso.** `GET /api/v1/brands/:slug/agent-sessions?id=` era `select('*')`
col client **admin** e un solo vincolo, `brand_id`: restituiva eventi, transcript, system prompt ed
errori **grezzi**, di qualunque superficie, a qualunque membro del brand e a qualunque API key
`anomalia_` — e la `hint` lo pubblicizzava. Adesso: colonne esplicite **senza `system_prompt`**
(dati del brand, email dell'utente, `stripe_customer_id`; non è una questione di redazione, è che
non serve a capire una run), filtro sull'autore, e redazione in uscita. Stessa cosa in
`getAgentSession` e in `readRunTrace`, dove `threadId` e `userId` diventano **obbligatori**:
`agent_sessions` non ha la policy `user_id = auth.uid()` che hanno `chat_threads` e `chat_messages`,
e il transcript contiene i messaggi dell'utente — **nessuna traccia è più pubblica della
conversazione che trascrive.** La policy è in `0215`, **scritta e non applicata**.

`sandbox_save_output` non passava da `scrub` sui rami binari: `cp ../altra-run/.github.env a.png`
pubblicava una credenziale come card permanente. Adesso i byte devono avere una firma d'immagine
vera e non contenere un valore del registro.

**Il tetto, dichiarato invece che nascosto** (nel commento sopra `redactSecrets`): valore spezzato,
esadecimale/UUID nudo non nostro, password in prosa, registro di processo. Un `«redacted»` di
troppo costa una domanda; uno di meno costa una chiave.

**`runs/<id>.md` — la traccia di un sotto-agente, leggibile.** Da `delegate_task` all'orchestratore
tornavano il rapporto scritto e tre numeri: se il rapporto era vago, il capo doveva crederci o
rifare il lavoro. Il dato c'era già tutto (`subagents.ts` registra ogni `tool_call` con input e
output, il testo del modello e il rapporto; `saveAgentSession` li persiste) — mancava il percorso.
Nessun tool nuovo: **un path in più sulla primitiva che esisteva già**.

- **Scopribile dove serve.** `saveAgentSession` ora è atteso invece che `void` — senza id la traccia
  esiste e non è raggiungibile — e il risultato porta `trace: "runs/<id>.md"`. La riga in coda al
  rapporto si aggiunge **solo quando il verdetto non è `pass`**: invitare a rileggere anche i giri
  riusciti rovescerebbe nel padre proprio i token che il sotto-agente serviva a risparmiare. Stessa
  regola nell'indice: *«leggila quando un rapporto è vago o sospetto, non quando è andato bene»*.
- **`grep` prima di `read`.** Aggiunta la terza primitiva: una traccia con dentro l'output di un
  comando è enorme, e il caso d'uso vero è *trova l'errore*, non *leggi tutto*. La lettura intera è
  troncata a 24.000 caratteri e dice quanto ha tagliato e di usare `grep`.
- **I segreti.** Gli output erano già puliti alla fonte — `sandbox-tools.ts` applica `scrub()` prima
  di restituire stdout/stderr — ma gli **input** no: un token scritto dentro un comando finiva
  registrato tale e quale, e il set dei segreti coniati nel giro vive in una closure per-run che a
  posteriori non esiste. Filtro per FORMA sulle sagome note (GitHub, Slack, OpenAI, AWS, `Bearer`
  lunghi, `password=`), dichiarato per quello che è: strettamente meglio di niente, non completo.
  **Il caso generale va chiuso alla scrittura**, passando il set dei segreti a `saveAgentSession` —
  decisione da prendere, non da aggirare.
- **Perimetro.** Solo brand + thread + `surface='chat_subagent'`. Il filtro sulla superficie non è
  ridondante: in `agent_sessions` convivono due FORME di evento (`kind`/`data` dal recorder,
  `type`/`content[]` dalla superficie chat, verificato in produzione), e senza di esso un id
  indovinato renderebbe un documento che sembra una traccia e non lo è.
- **Conservazione.** `agent_sessions` non ne ha nessuna: **45 MB per un giorno e mezzo, 267 righe**
  (misurato il 22/8). Il giorno che si pota, la lettura dice *«traccia non più disponibile»* invece
  di tornare un file bianco — che farebbe concludere «il delegato non ha fatto niente», la
  conclusione sbagliata.
- Le tre primitive sono salite in **`SHARED_TOOL_KEYS`**: `delegate_task` è di tutti, quindi ogni
  mestiere ha almeno un file da leggere. È quello che le fa smettere di essere un'ottimizzazione
  del motion.

**Chi legge cosa, interrogabile.** Ogni `read_file` scrive una riga in `ai_calls` con
`label='read_file'`, `provider='internal'` e `context='read_file:<path>'` — il path in una forma che
una `group by` legge senza parsing. Il MESTIERE non si duplica: si ricava unendo `thread_id` a
`chat_threads.agent`, che ce l'ha già.

```sql
select coalesce(ct.agent,'auto') mestiere, replace(a.context,'read_file:','') file,
       count(*) letture, count(distinct a.thread_id) thread, round(avg(a.ms)) ms_medi
from ai_calls a left join chat_threads ct on ct.id = a.thread_id
where a.label='read_file' and a.created_at > now() - interval '30 days'
group by 1,2 order by letture desc;
```

Il dato **non si poteva prendere gratis** da `chat_messages.tool_calls`, che pure conserva gli
argomenti di ogni chiamata: misurato su 60 giorni, li perde nello **0% dei turni normali, nel 24% di
quelli che toccano il muro dei 300 secondi e nel 100% dei salvataggi parziali** — cioè esattamente i
turni per cui questa misura esiste. La perdita non è casuale, è correlata al caso interessante.

`cost_usd` resta null (niente token, niente tariffa piatta), quindi la riga è invisibile ai crediti e
ai limiti di frequenza, che filtrano già `cost_usd is not null`. La pagina Utilizzo la esclude per
provider: un evento non fatturabile non va sul conto di nessuno.

**Non fatto, e perché.** I file per brand (`PRODUCTS.md`, `PEOPLE.md`, …) sono la fetta successiva:
`renderDesignDoc` li rende già, ma vanno staccati dal prompt uno alla volta. Quando arriveranno
**non** verranno scritti nel bucket: si rendono al momento dal database, per brand, perché sessanta
brand per dodici file sarebbero settecento oggetti da tenere allineati a dati che cambiano da soli —
settecento occasioni di mostrare a un agente un prodotto che il brand non vende più. In coda a ogni
`INDEX/<agente>.md` c'è la riga che lo dice, così chi apre il bucket e vede solo `how/` non conclude
che i dati del brand non esistono. La prosa delle azioni
grasse (`create_post` da sola: 5.494 byte di prosa contro 1.152 di struttura) vale altri ~12.600
token su `content` e viene dopo — `contracts.test.ts` è già stato puntato al file richiesto, così
quel giro non lascia un test rosso in eredità. E la potatura dei 47 tool mai chiamati è ultima
apposta: metà ha due giorni di vita, si pota con sessanta giorni di dati sotto.


### Il seme insegnava la forma che uccideva i video, e nessun cancello la vedeva

Il trailer `c1b4fe72` è uscito **3,5/10 «kill»** con «transizioni rotte» e «due secondi di nero».
Il giudice aveva ragione su cosa vedeva e torto su perché. Il sorgente dichiara `s2Local = frame -
82`, `s3Local`, `s4Local`, `s5Local`, `s6Local` — **cinque variabili, nessuna usata** — e monta le
battute come `{s2Active && <OldWayBeat />}`. Dentro, `useCurrentFrame()` dà il fotogramma
**assoluto** (162…270 per `OverviewBeat`) mentre ogni interpolate è scritta in **locale**: `iris` va
da `[0, 22]`. La rivelazione è finita 140 fotogrammi prima che la scena esista. Da fuori: taglio
secco e fotogramma congelato.

**La forma non era sbagliata in sé.** Interpolare sul fotogramma assoluto dentro *un solo*
componente è corretto — è quello che faceva il seme. Non sopravvive alla **fattorizzazione**, che è
il passo che chiunque fa: estratto `OldWayBeat` perché è più pulito, il componente continua a
ricevere il fotogramma assoluto mentre chi lo scrive pensa in locale. Il difetto non nasce da un
errore, nasce da un riordino ragionevole di una forma fragile.

**E il modello la imparava da noi.** `Sequence|Series` compariva **zero** volte in `source.ts`, con
dieci `<AbsoluteFill>` pilotati dall'aritmetica assoluta. Le craft specs chiedevano «one beat = one
Sequence», il ricettario mostrava sequenze — e **8 video su 24 in produzione** sono usciti nella
forma del seme. Il seme è il documento più letto del sistema: il modello imita il file che ha
davanti, non la prosa che gli sta sopra. Per lo stesso motivo, su 24 video **due** portano un solo
marcatore `// wow:` del ricettario, che costa 10.300 token a ogni passo di ogni slice.

**La correzione è nel seme, non in un consiglio.** `defaultMotionSource` ora emette una
`<Series.Sequence>` per battuta, con tre componenti separati e un `offset` negativo che è la
sovrapposizione, cioè la transizione. Dentro una Sequence il tempo locale è **vero per
costruzione**: ogni battuta si scrive come se fosse l'unica cosa del video, e fattorizzarla è
sicuro invece che letale. Le durate escono dalla durata totale (mai un terzo fisso, o un video da
90s uscirebbe con tre scene da mezzo minuto) e l'ultima chiude l'aritmetica, così la somma cade
esattamente su `durationInFrames` senza un fotogramma nero in coda.

**La rete sotto: `findDeadEntrances`** (`easing.ts`), per i sorgenti scritti prima e per chi ci
ricasca. Nomina il componente, la guardia che lo monta, il fotogramma di comparsa e la prima
interpolate scritta in locale. Sul trailer vero dice `OverviewBeat` — **la stessa scena** che
`findStaticTails` accusa di 2,9s di immobilità e che nello storyboard è il fotogramma congelato:
tre letture che convergono da direzioni diverse. Cablato in `finish` **prima** del controllo di
stasi, perché è la causa e non il sintomo — rifiutare la stasi senza dirlo manda il modello a
prolungare una deriva che è già lunga abbastanza.

Condizione stretta di proposito: la battuta non parte da zero (a fotogramma 0 locale e assoluto
coincidono) e ogni range sta dentro la **durata** della battuta invece che nel suo intervallo
assoluto. Un componente scritto in assoluto — range `[82, 172]` — supera la durata e non viene
toccato. Punto cieco dichiarato: `CtaEndCard` è l'entrata morta peggiore del file (monta al 436,
range fino al 104, 3,5s di fermo immagine) e il controllo **tace**, perché una delle sue interpolate
usa `[0, len]` con `len` prop passata al montaggio. Politica del file: range illeggibile = silenzio,
mai un rifiuto inventato. Risolvere le prop numeriche dal sito di montaggio è ~8 righe, non fatte
ora perché la stessa `unresolved` governa anche `findStaticTails`.

Estratti due helper condivisi in `easing.ts` (`componentMotionMap`, `guardMountedBeats`) invece di
duplicare la lettura delle guardie: i due controlli leggono la stessa forma, e leggerla in due posti
è il modo in cui fra un mese ne resta uno solo aggiornato.

### Il blocco possiede l'orologio, il modello possiede tutto ciò che si vede

La riga di confine per i blocchi di scena, e non è una convenzione: **è il confine che i controlli
già pattugliano.** `findLinearMotion` e `findStaticTails` leggono esattamente le funzioni di
`frame`. Al blocco appartiene tutto ciò che lo è — easing, passo per indice, quando finisce
l'entrata, il fatto che qualcosa si muova ancora all'ultimo fotogramma. Al modello tutto il resto —
parole, colori, font, corpo, posizione, quanti figli, durata. Finché tocca solo il resto i controlli
restano verdi per costruzione; appena tocca l'orologio si accendono.

Primo blocco, `title-block.ts` (file a sé, **non** nel ricettario): `motionTitleBlock()` emette
costanti + componente + la `<Series.Sequence>` che lo monta, nei valori del brand. Il passo **non è
una costante scelta a mano**: esce dal numero di parole e dalla durata del beat — è la ragione per
cui è una funzione e non uno snippet. Se le parole non ci stanno **allunga il beat e lo dice**, mai
comprimere.

La garanzia non sta nel blocco — un blocco copiato è codice come tutto il resto e verrà adattato —
ma nel controllo: `findWateredStagger` rifiuta un passo sotto 0,15s **nominandolo**. Sul trailer
vero il passo scritto a mano era `const delay = i * 4`, cioè 0,133s a 30fps: **sotto soglia per un
fotogramma**, con le parole che entravano in blocco, e nessuno l'aveva mai detto.

Criterio per i prossimi blocchi: **vale la pena solo se le sue proprietà si possono verificare sul
sorgente adattato.** «Il titolo entra con un overshoot» è verificabile; «il titolo è elegante» no.


### Grok non "smetteva di chiamare gli strumenti": gli buttavamo via i pensieri

Il sospetto era che il passaggio della chat a Grok 4.6 avesse spento la disciplina degli agenti.
I numeri, presi da `chat_messages` a parità di tipo di richiesta (solo turni che seguono una
richiesta di produzione, 30 giorni):

| modello | turni | chiamate/turno | mediana | turni a **zero** chiamate |
|---|---|---|---|---|
| gpt-5-6-luna | 21 | 7.00 | 6 | **0%** |
| grok-4-6 | 21 | 6.38 | 6 | **28.6%** |
| gemini-3.7-flash | 14 | 3.36 | 3 | 35.7% |

Cioè: **Gemini non era il termine di paragone buono** — era il peggiore dei tre. La mediana di Grok
è identica a quella di Luna; quello che è comparso è una **coda**: circa un turno di produzione su
quattro finisce a parole, e su Luna non succedeva mai. Il turno guardato a mano (thread `1b73b254`)
è esattamente quel caso: il modello *scrive* «Goal chiuso: c1 e c2 now true» senza mai chiamare
`update_goal`, e l'obiettivo torna indietro con 2 criteri su 3 aperti.

A livello di giornata il divario sembrava molto più grande (3.43 contro 11.90 chiamate per turno),
ma quel confronto è sporco: nella giornata di Grok ci sono decine di turni «ciao», «ok», «cos'è un
gatto», che a **zero chiamate ci stanno giustamente** (è la regola TRIAGE di `WORK_ETHIC_BLOCK`).
Il numero onesto è quello della tabella sopra.

**Il difetto nostro, e non è il prompt.** Il provider OpenAI dell'AI SDK decide se un modello è un
reasoning model **dal nome**: `o1 | o3 | o4-mini | gpt-5*`. `grok-4-6` non ci sta dentro, quindi
veniva trattato come un modello normale, e sulla Responses API di kie sparivano due cose in
silenzio — stampate dal body della richiesta e dai warning dell'SDK il 2026-08-22:

1. `reasoning: { effort }` **non veniva spedito affatto** (*«reasoningEffort is not supported for
   non-reasoning models»*). Il picker del thinking era decorativo su Grok, e **Auto ('medium') e
   Pro ('high') mandavano a kie richieste identiche byte per byte**. Quella che sembrava una
   differenza di qualità fra i due tier era solo differenza di richieste degli utenti.
2. A ogni step dopo il primo: *«Reasoning parts without encrypted content are not supported when
   store is false. Skipping reasoning parts.»* Il ragionamento dello step N veniva **buttato**
   prima dello step N+1. `store:false` (che ci serve perché kie non ha item store) chiede
   `include: reasoning.encrypted_content` solo per i modelli che l'SDK riconosce — lo stesso `if`.
   Un modello che pilota 120 strumenti ripartiva ogni step senza il piano appena fatto: nelle sonde
   si vede rileggere `read_posts` tre volte e `read_editorial_plan` due, cioè ri-derivare quello
   che sapeva già.

**La correzione**: `forceReasoning: true` in `kiePro` (`chat/model.ts`), una riga. È l'opzione che
il provider espone proprio per questo caso: rimette in richiesta sia l'effort sia l'include (il
messaggio di sistema passa a `role: 'developer'`, verificato dal vivo che kie/Grok lo accetta, sia
in streaming sia no). Misurato sulla stessa richiesta che aveva fallito («crea un post statico e
grafico»), 3 giri per condizione con il set di tool e il prompt veri: **prima 14.0 chiamate in 5
step e ~105s, dopo 7.7 chiamate in 3 step e ~50s**, a parità di consegna. Il numero grezzo
"chiamate per turno" *scende*, ed è il verso giusto: quello che sparisce sono le riletture.

Il commento di `KIE_NO_STORE` in `kie.ts` prometteva «plus encrypted reasoning» — vero sui
`gpt-5-6-*`, falso su Grok. Corretto sul posto, così il prossimo non ci ricasca.

**Cosa è stato escluso, con i dati.**
- *Troppi strumenti* (~120 per specialista, ~31k token di sole definizioni): stessa richiesta con
  120 tool e con 24, due giri per parte. Con **120** ha consegnato 2 volte su 2, con **24** una su
  due (l'altra ha chiamato `ask_user_questions` e si è fermata). Tagliare il set non migliora
  niente: la soglia non è lì.
- *Formato degli schemi*: il body verso kie è pulito — 120 `type:"function"` con `parameters` senza
  `$ref`/`$defs`, tutti con description, nessun `strict`. Non c'è niente che Grok capisca a metà.

**Il 28.6%, chiuso nell'SDK e non nel prompt.** La propensione del modello resta, ma non deve più
poter finire il turno: al **primo step di una richiesta di produzione** ora si passa
`toolChoice: 'required'` (`forcedFirstStepTools` in `harness/run.ts`, l'unico punto da cui passano
tutte e tre le superfici di chat — la rotta in streaming, la coda e il percorso CLI/MCP — così non
si ripara in tre posti e se ne dimentica uno). È vincolato due volte, perché forzare uno strumento
dove non serve è peggio del difetto: **solo** `surface: 'chat'`, e **solo** quando
`isHeavyProductionAsk` dice che il messaggio è una richiesta di produzione — lo stesso
classificatore deterministico della scalata Auto→Pro. Una domanda («cos'è un gatto») resta libera:
il TRIAGE di `WORK_ETHIC_BLOCK` non si tocca. `ask_user_questions` è **escluso** dallo step forzato,
perché è in `stopWhen`: sarebbe l'unico modo di obbedire al `required` senza fare niente. E se dopo
il filtro non resta nessuno strumento non si forza affatto — un `required` senza candidati è un 400
del provider, non una correzione. Verificato sul filo: kie/Grok accetta `tool_choice:"required"` con
119 tool al primo step e torna a `auto` con 120 dal secondo; sulla richiesta che aveva fallito,
**2 giri su 2 hanno prodotto il post, 0 hanno chiesto**.

**Gli altri due percorsi Grok, chiusi anche loro.** `director.ts` (8 step) e `produce-agent.ts`
(40 step il generatore, 12 il reviewer) avevano lo stesso identico difetto — `KIE_NO_STORE` senza
`forceReasoning` — e su 40 step è dove costa di più. Adesso esiste **`KIE_GROK_NO_STORE`** in
`kie.ts` (store:false + forceReasoning) e i tre percorsi spandono quella: il difetto era proprio lo
scordarsene, un nome solo e la quarta volta non si sbaglia.

Sulla `temperature` che `forceReasoning` porta via, **misurato invece di indovinato** (grok-4-5, 4
campioni per condizione, stesso prompt a entropia alta): `temperature: 0` → 2 risposte distinte su
4, `temperature: 2` → 3, **senza temperature → 4**. Cioè il campionamento di default di kie/Grok è
*più* vario di quello che gli imponevamo: togliere lo 0.6 del generatore non costa varietà, la
restituisce. L'unico punto dove si perde qualcosa è il **reviewer**, che stava a 0.3 per essere
ripetibile e ora campiona come vuole il modello: è un giudizio, non una svista — il verdetto è
ancorato alle immagini e alle regole, non alla temperatura. Sui percorsi Gemini di ripiego la
temperatura resta esattamente quella di prima.

**La metrica di riuscita, corretta.** Non «chiamate a strumento per turno»: quel numero sale quando
il modello ri-deriva quello che sapeva già, e scende quando nel conteggio entrano i «ciao». Il
numero è **la percentuale di turni di produzione che finiscono a zero chiamate**. Sta scritto nel
commento sopra `resolveTier`, accanto alla query che lo produce.

**Cosa NON è riparabile da qui**: la propensione del modello a chiudere a parole resta — quello che
è cambiato è che adesso non può farlo al primo step di un lavoro. A prompt identici, strumenti
identici e harness identico, Luna partiva da 0% di turni muti e Grok da 28.6%. La scelta di tenere
Grok su Auto e Pro è del proprietario; il costo va guardato anche di tasca, perché sulle stesse
righe `ai_calls` un turno Grok costa **$0.128** contro **$0.019** di Luna.

### Due skill di design su 107, e il pavimento del feed

La richiesta era «usiamo anche le skill di
[Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills)» (MIT, 107 skill in
9 plugin). Ne sono entrate **due**, e la ragione per cui le altre 105 sono rimaste fuori è la stessa
per cui le nostre funzionano: **quelle sono consigli**. Ottimi consigli — ma una riga nell'indice
delle skill si paga a **ogni turno** dell'agente che la vede, e una regola che nessun controllo fa
rispettare è una riga che il modello legge e ignora senza che nessuno se ne accorga. La barra di
`default-skills.ts` non è "è un buon consiglio": è *questa regola chiude un difetto che oggi
produciamo, e so nominarlo*.

**Il difetto.** Una grafica si compone su una tela da 1080px e si guarda in un feed da ~390: 0.36×.
Il modello che scrive l'HTML non ha mai quel fatto davanti — nel prompt del compositore
(`HTML_SYSTEM` in `design-compose.ts`) non c'era **una sola riga** su dimensioni, contrasto o
gerarchia — e il risultato è sempre lo stesso: una didascalia a 18px, cioè sei punti sul telefono
di chi scrolla. Presente nel sorgente, invisibile nel prodotto.

**Il gate: `inspectGraphicTree`** (`src/lib/design/graphic-check.ts`). Non è un motore CSS: cammina
**l'albero che satori rasterizza davvero**. Per ottenerlo, `sourceToSatoriTree` è stato estratto da
`renderGraphicSource` (HTML → `htmlToSatori`; TSX → compile + `renderToStaticMarkup` → lo stesso
parser) e ora ha due lettori. Un controllo che si riparsasse il sorgente per conto suo boccerebbe
pixel che non esistono.

Quattro regole, **una sola con i denti**:

| regola | esito |
|---|---|
| `text_below_feed_floor` — testo sotto il 2.2% della larghezza tela (24px su 1080) | **RIFIUTA** la scrittura |
| `low_contrast` — WCAG 4.5:1 (3:1 sopra il 5% della tela) | avviso |
| `hierarchy_flat` — fra il primo e il secondo corpo meno di 1.5× | avviso |
| `off_palette` / `too_many_colors` — tinte fuori dal brand kit, o più di tre | avviso |

Blocca solo la prima **per scelta, non per pigrizia**: il px è letterale nel sorgente e si corregge
alzandolo, quindi il rifiuto converge in un giro. Contrasto e palette no — dietro il testo può
esserci una foto o uno scrim posizionato in assoluto che nessun controllo statico vede, e un
rifiuto su un falso positivo manda l'agente in loop su un difetto che non esiste. Il contrasto viene
**saltato del tutto** quando la tela contiene un'immagine o un gradiente: meglio tacere che
bocciare alla cieca. Gli avvisi tornano in `design_warnings` sullo stesso risultato del tool — sono
sul verbale, ignorarli è una decisione presa in chiaro.

Il gate è agganciato a `write_source` / `replace_source` (`chat/graphic-source-edit.ts`), le **sole**
porte da cui un modello cambia una grafica. **Non** ad `applyPostGraphicSource`: da lì passa anche
l'editor del browser, e rifiutare il salvataggio di una persona che sta guardando la propria tela
sarebbe assurdo.

**Le due skill**, entrambe solo a `content` — l'unico hub che ha `design_graphic` e le tool di
sorgente. `motion` e `ugc` non le vedono: un trigger che l'agente non può eseguire è un costo per
turno senza contropartita.

- `graphic-feed-legibility` — le proporzioni citano per nome `defaultGraphicHtml`, la tela di
  partenza che il prodotto già spedisce (kicker 2.5%, corpo 3%, titolo 8.4%, margine 7%), e un test
  verifica che **quella tela passi il proprio gate**. È lo stesso patto delle skill di motion, che
  citano le voci del ricettario per nome invece di incollarne il codice.
- `graphic-palette-discipline` — al massimo tre tinte non neutre, un accento usato una volta, e
  nessun hex inventato. `gate` dichiarato **"advisory"**: si vede a colpo d'occhio quali regole
  hanno i denti e quali stanno solo sul verbale.

**Costo dell'indice**, misurato con lo stesso conto di `buildMemoryContext` (`length/4`): `content`
da **94 a 157 token** (+63); `motion` invariato a 94; `analyst`, `web`, `ugc` a zero. Il primo
trigger è stato accorciato a 97 caratteri perché `skillTrigger` tronca a 100 — un trigger tagliato
a metà è una skill che il modello non capisce quando chiamare.

**Licenza.** MIT, quindi si potrebbe copiare con attribuzione. Non è stato copiato niente: le due
regole sono riscritte da zero nel nostro registro, con le nostre frazioni di tela, i nostri nomi di
tool e i nostri numeri importati dalle costanti (`MIN_TEXT_RATIO`, `MIN_HIERARCHY_STEP`) perché il
prompt e il gate non possano divergere. È **ispirazione, non derivazione** — niente `NOTICE`,
niente `THIRD-PARTY` — e la fonte dell'idea è attribuita in testa a `default-skills.ts`
(`readable-measure`, `critique-typography`, `visual-hierarchy`). Nel dubbio si attribuisce.

**Cosa è stato scartato e perché.** Personas, interviste, sprint di design, handoff, presentazioni:
mestiere di uno studio. `data-visualization`: non generiamo grafici. `animation-principles`: già
coperta, meglio, da `motion-alive-scenes`, che ha un gate. `dark-mode-design`, `platform-
conventions`, tutta `interaction-design` (Fitts, Hick, form design, loading states): parlano di
schermi con cui si interagisce — un post non ha stati hover. La coerenza **fra le slide di un
carosello** è l'unica candidata seria rimasta fuori: il difetto è reale (ogni slide è composta da
una chiamata diversa, e la deriva è garantita), il controllo sarebbe fattibile confrontando i
sorgenti fratelli, ma senza poter vedere il difetto in produzione — vedi sotto — sarebbe stata una
regola scritta a occhi chiusi.

**TROVATO PER STRADA, NON RISOLTO: le grafiche sono ferme dal 14/8.** ~~La migration `0167` non è
mai stata applicata in produzione: `graphic_designs.source` **non esiste** nel database.~~
**CORRETTO IL 22/8/2026: la colonna ESISTE** — la 0167 è stata applicata a mano. Quello che resta
vero di questa nota è la diagnosi: `design-store` seleziona quella colonna, e finché non c'era,
**ogni** lettura e scrittura di una grafica tornava errore. È esattamente il difetto già annotato
in memoria ("una colonna nuova in una select condivisa azzera ogni lettura della tabella"). Quello
che era rimasto armato è il ripiego scritto per sopravvivere a quella settimana — vedi
*«Il sorgente non si perde più in silenzio»* più in alto, che lo toglie.

### La chat non sapeva cosa vuol dire "finito", e i due cancelli che tacevano

Due difetti trovati guardando lo stesso trailer da 3,5 con cui è nato lo storyboard.

#### 1. In chat non esisteva una definizione di "finito"

Il sospetto era che la pagina `/motion-video` avesse più tempo della chat. **Falso, e va detto
perché è la premessa che cambia tutto**: `chat/+server.ts:96` e `motion-video/+server.ts:40`
dichiarano tutti e due `maxDuration: 1800`. Stesso muro. Il budget morbido della chat è
`CHAT_TURN_BUDGET_MS` = 1735 s, il tetto di step 75 contro i 64 della pagina.

La differenza sta in **cosa fa ripartire il lavoro**:

| | Pagina motion | Chat (prima) |
|---|---|---|
| Riprende quando | timeout **o** step esauriti **o non ha chiamato `finish`** | **solo** `deadline.expired` |
| Riprese | `DESIGNER_MAX_CONTINUATIONS = 24` | `CHAT_MAX_CONTINUATIONS = 9` |

`finish` è il contratto della pagina: l'agente deve **dichiarare** di aver finito, e se smette
senza dichiararlo `shouldContinueDesignerSlice` accoda un altro job. È così che quel percorso
lavorava mezz'ora su un video — non con una chiamata da 1800 s (il suo massimo reale è 918 s) ma
con una **catena** di slice.

La chat non ha `finish`. La sua unica leva è aver bruciato tutti i 1735 secondi, e la mediana di
un turno di chat è **26 secondi** (`ai_calls`, 4 giorni: p50 26 s, p90 164 s). Quella leva non si
arma mai. Quindi l'agente si fermava quando il modello smetteva di parlare, e **nessuno
controllava se il lavoro fosse davvero finito**.

`motion-video/unfinished.ts` è la definizione che mancava, e sta in codice perché nel prompt
sarebbe un'opinione: **finito = esiste un MP4 di questo video con verdetto `ship`**. Non che
l'agente lo dica, non che il sorgente compili. `decideMotionContinuation` torna `null` quando il
turno non stava facendo un motion video — una funzione nuova non deve togliere una ripresa che il
progetto già faceva.

**I tre freni, tutti in codice.** Un ciclo che riprende da solo può girare a vuoto a spese di
qualcun altro, e i crediti li paga l'utente senza vederlo:

- **il voto deve salire** — due giri consecutivi in cui `motion_craft_scores.overall` non migliora
  sono lucidatura a vuoto: si chiude e si consegna quello che c'è. Al primo verdetto negativo si
  riprende comunque: senza due giudizi non c'è un confronto, e quella è la prima correzione.
- **un tetto di spesa per video** — `MOTION_CHAIN_USD_CAP = 3`, letto da `ai_calls` sul thread a
  partire dalla nascita del video. L'ancora è quella perché "quanto ha speso questo thread da
  quando questo video esiste" è una domanda con una risposta sola e una query. Registro
  illeggibile → il tetto **non** blocca: un freno che non sa contare non deve fermare il lavoro.
- **`MOTION_MAX_CONTINUATIONS = 24`**, come la pagina — il freno stupido, che è il motivo per cui
  c'è. `enqueueTurnContinuation` prende un `maxDepth` opzionale: una produzione ne chiede 24, una
  conversazione resta a 9.

E quando si ferma **lo dice**, con il motivo e il voto migliore raggiunto
(`motionUnfinishedNotice`): un ciclo che si chiude in silenzio è indistinguibile da un lavoro
finito. Non lo dice quando il video è uscito — un avviso su un lavoro riuscito è rumore.

Costo accettato dal proprietario: ~$2-3 per video contro un video da 3,5 che non si può usare,
cioè sprecato al cento per cento.

#### 2. Due cancelli su quattro erano SPENTI, e nessun test lo diceva

Il trailer `c1b4fe72` non ha **nessun** `<Sequence>`, di nessun tipo: sono 13 `<AbsoluteFill>`
accesi da guardie nominate sul frame (`const s2Active = frame >= 82 && frame < 172`), 44
`interpolate`, zero molle, zero `<Audio>`. Il ricettario insegna le `<Series.Sequence>`; il
modello, quando scrive davvero, scrive i confronti. Ogni controllo che legge solo i tag su quella
forma **non legge niente — e tacere sembra passare**.

| Controllo | Sul sorgente vero | Esito |
|---|---|---|
| `findLinearMotion` | 0 violazioni | **corretto** — 44 interpolate, 44 easing |
| `detectWowMechanisms` | **0 battute** su 6 | **SPENTO**: la soglia «4+ battute» non si accendeva mai, e il file porta 5 marcatori `// wow:` che nessuno ha verificato |
| `findStaticTails` | **[] sempre** | **SPENTO**: `hosted` si riempiva solo dai tag, restava vuoto, e la funzione usciva senza guardare niente |
| gate della voce | passa | **cieco per progetto**: guarda il piazzamento della voce che esiste; senza un solo `<Audio>` esce con `voiced:false` e non dice niente |

`findStaticTails` è il più grave: **«nessuna scena deve essere statica, mai» — il difetto numero
due — non aveva mai guardato la classe di video in cui il difetto era.** Corretto, ora trova
quello che il giudice aveva trovato: `OverviewBeat` dura 108 frame e la sua ultima interpolazione
finisce al 22 — **2,9 secondi di immobilità**, che è la scena della chat, il fotogramma 216 dello
storyboard.

`detectWowMechanisms` conta ora anche le guardie a due lati (stessa forma che leggono `motionBeats`
e `findStaticTails`): 4 battute invece di 0, quindi la soglia si accende. Il gate della voce resta
com'è — «deve esserci una voce» è una decisione di prodotto, non una correzione — ma il silenzio
diventa un **rilievo** dello storyboard: `NESSUN <Audio>: questo video uscirà MUTO`. Rilievo, non
rifiuto: a volte il silenzio è la scelta giusta, ma non per distrazione.

**`gates-on-real-source.test.ts`** è la regola nuova: il TSX in produzione di quel trailer sta in
`__fixtures__/trailer-3-5.tsx.txt`, e ogni controllo deve trovarci quello che il giudice ci ha
trovato. Il test verifica per prima cosa che il fixture non contenga sequenze — se un giorno
qualcuno lo sostituisce con un file "normale", il test smette di provare qualcosa e lo dice. Un
cancello che non ha mai visto un sorgente reale è una promessa non provata, ed è esattamente così
che è nato questo difetto.

### Lo storyboard prima del video, e gli occhi che l'agente di chat non aveva

Due difetti che erano la stessa cosa vista da due lati: **l'agente che resta non vedeva niente**.

`src/routes/app/[brand]/motion-video` è deprecata. Il suo agente (`motion-video/agent.ts`) aveva
`render_stills` — rende la composizione davvero in una VM e ATTACCA i fotogrammi al risultato del
tool — e aveva il ricettario delle transizioni intero nel prompt. Il Motion Specialist della chat,
cioè la superficie viva, non aveva **né l'uno né l'altro**: scriveva TSX e poi chiedeva l'MP4. Il
primo giudizio visivo su un video di chat arrivava dalla QC di craft **sul file finito** — e quella
QC, sotto i 90 secondi residui, saltava in silenzio. È così che è uscito il trailer del 21/8.

**1. Il materiale.** `REMOTION_CRAFT_BLOCK` in `chat/agents.ts` porta craft specs + ricettario
completo (11 voci) dentro i due agenti che scrivono sorgente Remotion, `motion` e `content`. È
**composto** da `transitions-cookbook.ts`, non trascritto: il ricettario resta in una forma sola,
quella che il suo test compila. Il divario non era teorico — `detectWowMechanisms` PRETENDE su ogni
composizione da 4+ battute un match-cut e una scala a tutto schermo, e il codice di
`FULL_CANVAS_SCALE` non stava in nessun posto che l'agente di chat leggesse: si bocciava un agente
per non aver copiato una ricetta che nessuno gli aveva dato.

Costo misurato, per step: `motion` 9.445 → 18.971 token (+101%), `content` 6.933 → 21.543 (+211%,
non aveva nemmeno le craft specs). Le skill di default non tengono più una seconda copia degli
snippet: citano la voce per nome e rimandano al ricettario che ora è nel prompt. Il test della
coppia skill↔gate è stato riscritto sulla fonte vera — ogni nome che la skill promette come
match-cut passa davvero `detectWowMechanisms`.

**2. Gli occhi.** `render_stills` è montato anche in chat (`chat/tools.ts`), con `resolveTarget`
asincrono perché lì non esiste una selezione in memoria: il sorgente si legge dal database a ogni
chiamata. `agents.registry.test.ts` ha una guardia che lo dice da sola — un prompt che nomina un
tool è un contratto — e infatti si è accesa appena il tool è entrato nel registro.

**3. Lo storyboard.** Il primo `render_motion_video` di ogni **versione del sorgente** non produce
l'MP4: rende **un fotogramma per scena**, in una sola apertura di macchina, e li attacca al
risultato (`toModelOutput`, come `render_stills`). Le scene le legge `motion-video/beats.ts` dal
TSX — `<Series.Sequence>`, `<TransitionSeries.Sequence>`, `<Sequence from=…>` — al 55% di ogni
battuta, che è la posa che la scena tiene: l'inizio è l'entrata, la fine è l'uscita. Le transizioni
di una `TransitionSeries` accorciano la timeline e vengono sottratte, o ogni scena dopo la prima
verrebbe fotografata nel punto sbagliato.

**Perché costa meno del render che evita** (produzione, `ai_calls`, 21-22/8): `sandbox.motion_stills`
n=21, p50 **21 s** (fino a 4 fotogrammi); `sandbox.motion_render` n=14, p50 **85 s**, avg 116 s,
max 229 s, più 7 falliti a 162 s di media. L'apertura pesa ~5 s e ogni fotogramma dopo ~4-5 s:
sei scene in un'apertura stanno in ~30 s. In crediti la differenza è quasi nulla (entrambi
arrotondano al minimo di 1 credito) — quello che si risparmia è il **budget del turno**, che è la
risorsa scarsa: un MP4 buttato può mangiarsi una slice intera da 300 s.

**Il freno sta in codice, non nel prompt.** `createStoryboardGate` rifiuta una volta per hash del
sorgente e al massimo `MAX_STORYBOARD_REFUSALS = 2` volte per turno — stessa forma di
`MAX_REVIEW_REFUSALS` e `MAX_FINISH_REFUSALS`. Il test che conta è quello: un agente che patcha
all'infinito e non è mai contento esce dal ciclo al terzo giro, e il render parte comunque.

**Quello che uno still NON mostra** viaggia nella stessa risposta: `motionSourceFindings` gira
`findLinearMotion`, `findStaticTails` e `detectWowMechanisms` sul TSX. Su chat non li girava
**nessuno** — vivevano solo dentro `finish`, che è un tool della pagina deprecata. Ora stanno dove
passano tutti i chiamanti, accanto al gate sulla voce.

**Niente attese.** Lo storyboard si mostra e non si ferma: nessuna domanda all'utente, nessun
permesso. E quando non si può fare — niente VM, o meno di 90 s residui — il risultato lo **dichiara**
(`storyboard_skipped`), invece di sparire come faceva la QC di craft.

**Provato dal vivo, ed è servito.** Giro reale sul trailer che la QC aveva bocciato 3,5/10 «kill»
(18 s, verticale, `c1b4fe72`): **quattro fotogrammi in 25,2 s** — installazione della VM inclusa,
perché quella macchina era fredda — contro i **167 s** che lo stesso video era costato in MP4 lo
stesso giorno. Tre dei quattro difetti che il giudice aveva elencato guardando il file finito si
vedono nei fermi immagine: il beat di nero morto (un punto viola su 1080×1920 — il PNG pesa 37 KB
contro i 578 del successivo, il difetto si vede persino nella dimensione del file), lo screenshot
in letterbox con il claim tagliato a metà, il testo su testo. Il quarto — «transizioni rotte»,
3/10 — **non si vede e non si può vedere**: sta fra due fotogrammi.

**E il giro ha trovato un difetto che nessun test avrebbe trovato.** Quel trailer non ha **nessun**
`<Sequence>`, di nessun tipo: sono 13 `<AbsoluteFill>` accesi da condizioni scritte a mano
(`frame >= 82 && frame < 172`), 44 `interpolate`, zero molle, zero `<Audio>`. Il ricettario insegna
le `<Series.Sequence>`; il modello, quando scrive davvero, scrive i confronti. Due conseguenze, e
la seconda è grossa:

- `motionBeats` tornava vuoto e lo storyboard ripiegava sullo spargimento regolare — centrando
  quattro battute su sei per fortuna e saltando **apertura e CTA**. Ora legge anche i confronti sul
  frame, e ricostruisce i due estremi (che sono scritti a un lato solo perché non hanno un lato).
- `detectWowMechanisms` conta le battute **con lo stesso metodo**, cioè contando i tag. Su quel
  trailer ne contava zero, quindi il gate che pretende un match-cut e una scala a tutto schermo su
  ogni composizione da 4+ battute **non si è mai acceso** — mentre il sorgente portava cinque
  marcatori `// wow:` che nessuno ha verificato. `motionSourceFindings` ora prende il conteggio più
  alto fra i due metodi. Un controllo che non riconosce la forma in cui il modello scrive davvero è
  un controllo spento.

### La documentazione della libreria, invece del ricordo che il modello ne ha

I due agenti che scrivono sorgente — Motion Specialist e Content Creator — scrivevano TSX Remotion
**a memoria**. Il modello ha una data di taglio, Remotion no: una prop rinominata, un export
spostato, un componente che ora vuole `startFrom` invece di `from`, e il render muore su un errore
che dal prompt non si poteva prevedere.

Ora hanno `search_library_docs`: una domanda, e torna il pezzo di documentazione vera.

**Perché HTTP e non MCP.** La richiesta nasceva da `https://context7.liam.sh/mcp`, e quell'indirizzo
funziona davvero (ci si parla, espone `resolve-library-uri` e `search-library-docs`). Ma parlare MCP
costa una `initialize` più una `notifications/initialized` più un trasporto SSE da tenere vivo **a
ogni turno**, una chiamata di resolve prima di ogni fetch, e — la parte che non conta nessuno — circa
700 token delle sue due descrizioni di tool iniettati nel prompt *anche quando l'agente non consulta
niente*. Lo stesso indice è servito su HTTP semplice (`context7.com/api/v2`, nessuna chiave
richiesta): una GET, nessuna dipendenza nuova, nessuna sessione remota dentro un turno che ha già un
tetto di 300 secondi, e un servizio giù che degrada in «non ho trovato» invece di portarsi via il
turno. Non è un client MCP: è un tool nostro che chiama un URL.

- **Remotion di default, in una sola richiesta.** L'id `/remotion-dev/remotion` è fisso nel codice:
  la libreria che questi due agenti scrivono davvero non ha bisogno di essere cercata ogni volta.
  Il parametro `library` esiste per il resto (react, zod, …) e paga il resolve solo allora.
- **Quando, non «sempre».** Un tool che l'agente ha e non chiama è peso morto; uno che chiama a ogni
  edit è un round-trip per ogni riga. La riga di prompt dice *prima* di usare un'API di cui non si è
  certi, e *quando* un render fallisce con un errore che sa di API.
- **Chi vince.** Il ricettario delle transizioni, le craft specs e le regole del brand dicono **come
  facciamo noi i video**; Context7 dice **come funziona la libreria**. La riga lo scrive esplicito —
  «ours always wins» — perché il rischio vero non è che l'agente non consulti: è che preferisca
  l'esempio generico della documentazione ai nostri pattern, e i video peggiorino restando corretti.
- **Il fallimento è il caso normale, non l'eccezione.** Timeout a 10s, ogni errore torna come
  risultato del tool con l'istruzione di non ritentare più di una volta. Il test lo prova su rete
  morta e su 429 — è quello che succederà davvero.
- **Costo misurato:** ~1,8 s la prima chiamata (connessione fredda), ~1,5 s le successive, ~3 s
  quando c'è da risolvere una libreria diversa da Remotion. Su un budget di 300 s, e solo quando
  l'agente decide di chiedere.

`CONTEXT7_API_KEY` è **opzionale**: senza, si va da anonimi e funziona; con, si alzano i rate limit
(l'IP di uscita di Vercel è condiviso). Non c'è nessuna chiave nel sorgente.

### Un video prodotto si mostra, non si linka

Il blocco media c'era e gli agenti non lo usavano: *"L'AI continua a darmi video sotto forma di
link"*, con l'indirizzo del nostro storage incollato nel testo sotto "Link del trailer:".

**La causa non era il prompt debole, era un prompt assente.** Con uno specialista selezionato la
testa è `buildAgentHead` + le capabilities DI QUELL'AGENTE: le regole su come si mostra qualcosa
vivevano solo dentro quelle del Content Creator, e il ramo `else` di `system-prompt.ts` (che le
aveva) non viene nemmeno percorso. Il Motion Specialist renderizzava un mp4 e incollava l'URL
perché nessuno gli aveva mai detto che esisteva un altro modo. Ora `SHOW_MEDIA_BLOCK` sta in
`buildAgentHead` — **tutti** gli agenti, consulti compresi — e un test lo verifica per ognuno.
Nelle capabilities del Content Creator le due righe duplicate sono sparite.

E l'istruzione contraria che si contraddiceva col resto era davvero lì: `output-tools.ts`, il
ripiego del render motion, diceva *"give the user the URL directly"*. Ora entrambi i suoi hint
dicono di consegnare la clip come media.

**La rete di sicurezza, che conta più del prompt.** Un indirizzo del nostro storage **da solo su
una riga** viene promosso a media allegato: esce dal testo e diventa il suo player, fuori dalla
bolla. È la stessa promozione che `splitGoalStatus` fa col notice del goal, nello stesso punto
delle due surface.

- **Da solo su una riga, non ovunque.** Un link dentro un periodo ("l'ho salvato qui: X, poi ho
  fatto Y") è una frase, non una consegna: strapparlo lascerebbe un buco nel discorso. Resta lì.
- **La riga che introduce resta, l'indirizzo se ne va.** "Link del trailer:" è la didascalia, e
  senza di essa il player comparirebbe senza che niente dica perché.
- **Foto come i video**: stessa regola, stesso metro su SVG/HTML/PDF, e **solo** il nostro
  storage — `isShowableMediaUrl`, la stessa funzione della falla markdown chiusa stamattina. Un
  indirizzo esterno resta testo e non viene caricato (verificato a livello di richieste di rete).
- **Niente doppioni**: se l'agente chiama `show_media` *e* cita l'indirizzo, `showMediaUrls`
  raccoglie gli URL già mostrati dal turno e la promozione li salta — la riga si pulisce lo
  stesso, la card è già di là. Vince la chiamata al tool, che è il gesto deliberato.
- `textBubbleRange` sa della promozione: un blocco che, tolto l'indirizzo, non ha più niente da
  dire non è una bolla — la faccia dell'agente e la riga delle azioni non ci si attaccano.
- Restano fuori di proposito le immagini markdown `![alt](url)` isolate: quelle sono l'agente che
  illustra dentro la prosa, non una consegna. Se un giorno danno fastidio, il posto è lo stesso.

### Un criterio si chiude chiamando lo strumento — e un giro a vuoto si riprova una volta

Il caso, dal database di produzione (thread `630fca9f`, 22/08). Il Motion Specialist scrive
«**c1 chiuso**: referenza studiata… **c2 chiuso**: UI reale catturata… c3 aperto…» e chiude il
turno con «Vuoi che la scriva ora o preferisci prima voice-over?». Sotto, la riga dell'obiettivo:
`0/5 — un giro intero non ha chiuso niente`. Non era il contatore a sbagliare: in quel turno erano
stati chiamati `study_motion_reference` e `capture_website` — cioè esattamente i tool che rendono
veri c1 e c2 — ma `update_goal` no. Il lavoro c'era, la registrazione no. L'agente ha usato
«chiuso» come **etichetta di stato**, non come **azione**.

Nei dati: 6 obiettivi restituiti alla persona, **tutti** per `no_progress`, 5 dei quali a `laps=1`
e con **zero** criteri chiusi; due sullo stesso thread a nove minuti di distanza. Zero settlement
per `awaiting_answer` — la domanda era in prosa, quindi `awaitingAnswer` era falso e il turno si
è fermato per l'altra ragione.

**Il difetto si auto-alimentava.** `no_progress` chiudeva l'obiettivo (`handed_back`); al turno
dopo l'`update_goal(done=[…])` dell'agente tornava indietro con *"No goal is open in this
conversation"* (verificato: è nel `tool_calls` del turno delle 15:57), lui apriva un obiettivo
nuovo con `set_goal`, lavorava — voice-over, musica, render, MP4 in galleria con tanto di link — e
di nuovo non registrava niente. Un giro a vuoto ne fabbricava un altro.

**Chiusure raccontate e mai registrate** (`declaredClosures`, `goal.ts`). Stessa forma di
`production-claim.ts` — regex deterministica, nessun modello di mezzo — ma trattamento opposto,
perché qui il lavoro esiste: se il turno ha chiamato almeno un tool che non sia `set/update/close_goal`,
le chiusure scritte in prosa («c1 chiuso», «c2: fatto», «c1 done») vengono **registrate davvero**
in `settleGoalForTurn`, con la nota che dice da dove arrivano. Non è un buco di fiducia nuovo:
`update_goal` non verifica niente neanche lui, prende per buona la parola del modello — e il
requisito «almeno un tool non-goal» è perfino più severo, perché `update_goal` si può chiamare
dopo zero lavoro. Se invece il turno **non** ha lavorato, la frase non vale niente e i criteri
restano aperti. Scartato: appendere una riga di correzione al transcript come fa
`production-claim` — il notice `_Goal …_` deve restare l'ultimo paragrafo, è quello che
`goal-status.ts` smonta in card.

**Un giro a vuoto si riprova una volta** (`GOAL_MAX_EMPTY_LAPS = 1`). Il commento che c'era —
«un giro che non chiude nulla è un giro che ripeterebbe se stesso» — vale solo se il giro dopo
sarebbe identico, e non lo è: `goalContinuationPrompt` ha ora un ramo `emptyLap` che riparte
dicendo **perché**, con i tre modi in cui un giro finisce a vuoto (hai lavorato e non hai marcato;
hai chiesto il permesso invece di agire; ti sei fermato ad aspettare un giudizio che puoi darti da
solo). Nuova ragione `no_progress_retry`: `continue: true`, `handBack: false`. Al secondo giro a
vuoto — `laps > GOAL_MAX_EMPTY_LAPS` — resta il vecchio `no_progress` con la resa. Il tetto è in
codice e non nel prompt, e il margine è **un giro**: `ai_calls` dice mediana $0.06 e media $0.09
per turno di chat, fino a ~$1 quando dentro c'è un render video. `GOAL_MAX_LAPS = 4` resta il
tetto complessivo. Nessun contatore separato e nessuna migration: `laps` conta già.

**L'avviso nomina ciò che si è chiuso ADESSO** — «appena chiusi: x; y» / «just closed: x; y»,
subito dopo la frazione, su `goalTurnNotice` e sul parser `goal-status.ts` **nello stesso giro**.
Non i `done` accumulati: quell'avviso è la fotografia di QUEL turno, e i nomi dei chiusi vecchi
non li ha mai avuti. Il tetto è `NOTICE_MAX_NAMED_CLOSED = 3` con soglia **binaria** (o tutti o
nessuno), perché il testo non è pixel: **rientra nel transcript del modello a ogni turno
successivo**, quindi si paga in token per tutto il resto della conversazione — e la registrazione
automatica qui sopra rende i chiusi più frequenti, cioè peggiora proprio il caso peggiore. Un
elenco troncato letto come completo sarebbe peggio del silenzio, quindi niente «+3»: sopra tre, la
riga torna com'era. Tetto duro 3 × `MAX_CRITERION_CHARS` = 600 caratteri, in pratica ~150.

Il gruppo è **opzionale nelle regex** (`JUST_CLOSED`): gli avvisi già scritti nei thread sono nel
formato di prima e devono continuare a leggersi uguali — un obiettivo di ieri non diventa
illeggibile perché il server oggi dice una parola in più. È la regressione da temere ed è
invisibile finché qualcuno non riapre una vecchia conversazione, quindi ha i suoi test: sei
avvisi vecchi (quattro template × due lingue) che devono continuare a produrre una card, con
`closed: []`. Nel dialog i nomi diventano spunte vere; `chat.goal.turn.doneCount` resta per i
chiusi di cui non conosciamo le parole (`status.done - status.closed.length`), che è anche il caso
di ogni avviso scritto prima di oggi.

**La riga in chat non cambia di una virgola** quando non c'è niente da nominare — il caso più
frequente, e il test lo confronta carattere per carattere con la versione senza il parametro.

**«Riprovo» non si confonde con «mi sono fermato».** `no_progress_retry` ha `continue: true`, quindi
`goalTurnNotice` usa il template che esisteva già («Riprendo in background» / «I am picking it
back up in the background»): «riprovo» si distingue da «mi sono fermato» riusando una frase che
il parser leggeva già, senza inventare un quinto stato.

**Il prompt, nei tre posti** (`GOAL_BLOCK`, `goalBriefing`, `goalNudge`): chiudere è una
CHIAMATA, non un'etichetta — «c1 chiuso» scritto nella risposta non chiude niente; e finché un
obiettivo è aperto non si chiede il permesso di procedere, non si offrono bivi fra due modi di
fare la stessa cosa, non si chiude il turno con una domanda mentre resta un criterio che l'agente
può chiudere da solo, e non ci si ferma ad aspettare un giudizio che è il proprio mestiere. Si
chiede solo ciò che esiste unicamente nella testa della persona — e allora con
`ask_user_questions`, che ferma il turno per davvero, non con una domanda in prosa che non ferma
niente e non fa avanzare niente.

### Un criterio nasce dalla richiesta, non da una regola di mestiere

Il proprietario, su un obiettivo per un post grafico: *«Perché gli dice almeno due idee
disruptive? È l'agent nel caso ad aggiungerle, non deve raggiungere un minimo né salvarne per
forza.»* Quel `c3` non veniva dalla sua richiesta: veniva da una riga di prompt di mestiere
(«questo lavoro deve lasciare almeno una idea nuova nel banco») che `set_goal` ha trascritto come
se fosse parte del lavoro. Nel system prompt di ogni agente ci sono decine di "devi sempre X":
ognuno di quelli è un criterio potenziale, e ne sono già stati trovati altri quattro vivi, fra cui
*«almeno UNA delle proposte deve essere costruita su un CONTRASTO»*, che sta davanti a tutti.

La regola, con il suo metro: **un criterio è ciò che l'utente ha chiesto, più le condizioni senza
cui quella cosa non è fatta**; uno standard che vale su OGNI lavoro è il modo in cui si lavora,
non cos'è questo lavoro. Il test: *se il criterio sarebbe altrettanto vero, e altrettanto
richiesto, per una richiesta completamente diversa, non appartiene a questo obiettivo.* Sta nei
tre posti dove l'obiettivo nasce e vive: `GOAL_BLOCK`, la descrizione di `set_goal`, e il
`goalBriefing`, che aggiunge la via d'uscita — un criterio così si butta con `update_goal(drop=…)`
come uno impossibile. Il metro torna anche nell'`instruction` che `set_goal` restituisce, cioè nel
momento in cui la lista esiste davvero e rileggerla costa zero.

**In codice no, e dichiarato come tale** (`ponytail:` sopra `normalizeGoalCriteria`). Un criterio è
testo libero e ogni regola automatica provata taglia anche quelli buoni: «almeno 3 post a
settimana» è uno standard se lo detta il prompt e un fatto del lavoro se lo dice il piano
editoriale, e dal punto di vista del filtro le due frasi sono identiche. Soprattutto, il costo dei
due errori non è simmetrico: un criterio di troppo **si vede, si legge e si butta**; un criterio
legittimo scartato in silenzio restringe l'obiettivo, che poi si chiude come RAGGIUNTO con il
lavoro non fatto — cioè esattamente il difetto contro cui esiste tutto il file. Se un giorno
servisse in codice, l'unico segnale non ambiguo è la **ripetizione**: uno standard di mestiere
ricompare parola per parola su obiettivi di thread e brand diversi, un criterio di lavoro no. Costa
una query dentro `set_goal` e non ferma comunque la prima volta.

### Il permesso non si chiede, e nemmeno si offre un bivio

*«Non deve chiedere alcun permesso, lo deve fare punto e basta.»* La regola c'era già, ed era
giusta: `WORK_ETHIC_BLOCK`, punto 2, *«"Potrei fare X, vuoi che proceda?" is the named failure»*,
con l'elenco dei veri cancelli decisionali (pubblicare, spendere molto oltre il chiesto, cambi
distruttivi, pagamenti). Mancava il caso che si è visto davvero, che non è una richiesta di
permesso ma **un bivio**: «vuoi che la scriva ora o preferisci prima il voice-over?» — cioè
l'ordine dei propri passi passato all'utente come se fosse una sua decisione. Una riga in coda al
punto 2, nella testa condivisa: un bivio non è una domanda, si sceglie e si fa; l'unica cosa per
cui vale la pena fermarsi è un fatto che esiste solo nella testa della persona, e si chiede con
`ask_user_questions`, che ferma il turno davvero, non con una frase in prosa che non ferma niente.

Sta in `WORK_ETHIC_BLOCK` e non nel blocco obiettivo di proposito: vale su **ogni** turno di
**ogni** agente, non solo su quelli con un obiettivo aperto — il thread da cui nasce la
segnalazione non ne aveva uno. Il divieto dentro la modalità obiettivo resta come rinforzo, dove
per di più è più stringente (lì non si chiude nemmeno il turno con una domanda mentre resta un
criterio chiudibile da soli).

### La riga dell'obiettivo dice quanti task restano, e il dettaglio si apre come le azioni

Aperta, quella riga elencava sei voci identiche: la motivazione dello stop ("un giro intero non ha
chiuso niente") e i cinque criteri, tutti `<li>` uguali dentro un unico array `details`. Un
commento travestito da task. E si vedevano solo i criteri APERTI (`status.open`), mai i chiusi:
per questo "0/5" seguito da cinque righe sembrava arbitrario, e con "2/5" se ne vedevano tre senza
alcun modo di sapere quali due fossero fatte.

**La riga in chat** non è più `Goal 0/5 - Stopped` con espansione in linea: è
`Goal - 5 tasks remaining - Stopped ...`, e al click apre il dialog (bottom sheet su mobile),
esattamente come `N azioni fatte` di `ChatToolChips` - stessi `ui/dialog` e `ui/sheet`, nessun
secondo componente di dialogo. A obiettivo raggiunto "0 task remaining" sarebbe assurdo: lì la
riga diventa una spunta e `Goal reached`, senza frazione e senza ripetere "Goal" due volte. Nuova
chiave `chat.goal.turn.remaining` (plurale ICU, quattro lingue).

**Il dettaglio** sta nel dialog, dove c'è spazio: i criteri uno sotto l'altro con il loro stato, e
la motivazione dello stop staccata sotto l'elenco - testo più piccolo e attenuato, allineato al
testo dei criteri e non ai loro segni. Nessun riquadro, nessun bordo, nessun fondo: a separarli
sono spazio, allineamento e peso, come fa già `.goal-foot` nella card dell'obiettivo vivo.

**Una resa sola.** `ChatGoalCriteria.svelte` disegna i criteri per tutti e due i posti che li
mostrano - la card dell'obiettivo appuntato e questo dialog. Spunta = fatto, cerchietto = aperto,
trattino + barrato = lasciato cadere. `ChatGoalCard` ne perde la copia (markup e ~25 righe di CSS);
la dimensione del testo la eredita da chi ospita (`font-size: inherit`), quindi niente prop
`compact`. Due rese della stessa informazione divergono al primo ritocco, ed è così che era nato
il difetto.

**I nomi dei criteri già chiusi non arrivano.** `goalTurnNotice` (`src/lib/server/chat/goal.ts`)
scrive nell'avviso solo la frazione e i criteri APERTI: dei chiusi si conosce il numero, non le
parole. Finché il server non li nomina, il dialog apre con una riga sola spuntata - `4 done`, la
chiave `chat.goal.turn.doneCount` che era già tradotta in quattro lingue e non usava nessuno -
invece di inventare N spunte senza nome. Scartato recuperarli dall'obiettivo vivo: `ChatColumn` ce
l'ha ma la pagina del thread no, e soprattutto un avviso è la fotografia di ALLORA - un criterio
chiuso dopo comparirebbe come fatto in un turno in cui non lo era.


### Su telefono il burger apre il rail della sovrapposizione, non la sidebar della dashboard

Su desktop la modal (`PageModal`) aveva già la sua colonna di navigazione. Su telefono no: dentro
una pagina della modal il burger apriva la sidebar della dashboard — quattro voci, da cui non si
raggiungeva nessun'altra pagina — e le impostazioni avevano un drawer tutto loro
(`SettingsSidebar` in modalità Sheet), con una TERZA lista di sezioni, icone proprie e un footer
con tema e lingua.

**Cosa condivide, adesso.** Le voci e la resa stanno in un componente solo, `PageRail.svelte`:
su desktop è la colonna della modal, su mobile è il contenuto del drawer. Stessi gruppi, stesso
stato attivo, stesso aspetto — `sm-rail`/`sm-item` sono gli stessi selettori di prima (li usa anche
`scripts/settings-modal-check.mjs`), quindi il desktop è invariato pixel per pixel. Scartata la
strada "un secondo componente per mobile che legge gli stessi dati": sarebbe stata la terza lista
da tenere allineata, ed è esattamente il difetto che si stava riparando.

**Una classificazione sola.** `overlayRoute(pathname, base)` (`$lib/overlay-route.ts`, con test)
dice se un path vive dentro la sovrapposizione e con quale suffisso. La usa `PageModal.resolve`
(che prima aveva la sua copia di `sectionOf`) e la usa il drawer per sapere dove si trova. Sotto
restano i due moduli puri di sempre: `SETTINGS_MODAL_SECTIONS` e `brandModalTarget`.

**Il burger.** Vive in `PageTopBar`, che non deve riclassificare nessun path: è il drawer
(`PageRailDrawer`) ad accendere `railDrawerReady` quando la rotta corrente ci vive dentro. Acceso →
il burger apre il rail; spento → la sidebar della dashboard, come prima. Due store
(`$lib/stores/rail-drawer.ts`) e non un prop perché i due lati stanno in rami diversi dell'albero:
il pannello DEVE essere montato fuori da `.main`, che ha `contain: layout` e sarebbe il blocco
contenitore di qualunque `position: fixed` al suo interno.

**Il fondo.** Il pannello del drawer usa `--paper-2` (il fondo del rail della modal), non
`--sidebar-bg`, che è `--paper-2` tinto di accento: era quello lo stacco visibile. La pagina
ospitata era già su `--paper`, cioè lo stesso fondo del dialog — misurato nel browser: mobile
`rgb(255,255,255)`/`rgb(17,17,17)`, modal identica.

**L'avatar in bianco e nero** non ha richiesto niente di nuovo in `AgentAvatar` (che è in mano ad
altri): `DEFAULT_CHAT_AGENT_AVATAR` ha già `color: 'theme'`, che lascia i colori al foglio di
stile — palla nera su chiaro, bianca su scuro. Il ritorno porta a `/app/<slug>`, cioè fuori dalla
sovrapposizione, con il chevron a sinistra.

**Tolto.** `isMobileSettingsHome` e la mappa a tutta pagina delle impostazioni su mobile
(`forceOpenMobile` non è più passato da lì: la rotta `/settings` nuda redirige lato server, quindi
quella schermata non la vedeva quasi nessuno). `SettingsSidebar` resta, ma solo su desktop.

**Nel drawer il rail scorre fino alla voce attiva**: le impostazioni sono 34 voci e si aprivano in
cima, cioè lontano da dove sei.

**Provato nel browser vero** (Playwright, 390px e 1440px, chiaro e scuro, dev server su porta
dedicata): drawer da una pagina della modal e dalle impostazioni con tutte le voci e l'attivo
acceso, ritorno in cima, chiusura al cambio voce con l'attivo che si sposta, e la controprova
desktop — modal, rail e fondi identici a prima.

### Overview: una voce nel rail, una parola sola per la stessa destinazione

La richiesta era "aggiungiamo Overview nella modal Spaces, la stessa pagina della pillola Status".
Prima di scriverla sono usciti due nodi, entrambi veri.

**Nodo 1 — il nome.** `app.home.workbench.title` diceva `Status`/`Stato`, e da quella chiave
pescano in TRE punti: la pillola in topbar (`PageTopBar.svelte`), il titolo del corpo della modal
(`workbenchTabLabel` mappa `workbench → app.home.workbench.title`) e — da ora — la voce del rail.
Aggiungere una voce etichettata "Overview" avrebbe prodotto il difetto che il commento in
`PageTopBar` vieta esplicitamente: clicchi *Overview*, si apre una modal intestata *Status*, a
quaranta pixel di distanza. Scartata l'idea di una chiave nuova per il solo rail (sarebbe stata la
seconda parola per la stessa destinazione). Il proprietario ha scelto di cambiare il VALORE della
chiave — `Overview` / `Panoramica` / `Resumen` / `Vue d'ensemble`, più `open` — così pillola,
titolo e rail si muovono insieme e nessuno può divergere.

**Nodo 2 — quale lista sono gli "Spaces".** `NAV_TEAM_SPACES` (Calendario, Libreria, Blog) sta
dietro `FEATURE_NAV_TEAM`, che è `false` in `.env` e **non esiste affatto fra le env di produzione
su Vercel**: quella lista oggi non la vede nessuno. Quello che l'utente chiama "modal Spaces" è
`PageModal`, che imposta il titolo del rail a `app.nav2.spaces` **senza guardare il flag**
(`PageModal.svelte:401`) mentre il contenuto del rail è `navGroups`, cioè i gruppi della sidebar —
col flag spento, i hub legacy (Brand / Social media / Web / Leads). Il nome "Spaces" è l'unico
pezzo della nav nuova già in produzione: da qui l'ambiguità della consegna.

**Cosa è stato fatto.** Tutte e due le liste, perché sono la stessa nav renderizzata in due chrome:

- flag OFF (quello che spedisce): un gruppo SENZA etichetta in testa a `sidebarGroups`
  (`app/[brand]/+layout.svelte`) — riga piatta, stesso trattamento di Impostazioni nella nav nuova.
  `PageModal` rende già i gruppi senza label, quindi zero righe di componente da toccare;
- flag ON: una riga in testa a `NAV_TEAM_SPACES` più l'icona in `SPACE_ICONS`, così la voce non
  sparisce il giorno che il flag si accende.

**Perché in cima.** Il workbench è l'unica pagina che *aggrega* le altre (coda di oggi, lead,
avvisi, andamento) ed è l'unica raggiunta da un chip che vive su un'altra superficie: è lettura,
non lavoro. Le altre voci sono posti dove si produce qualcosa.

**Stato attivo, senza furti.** Il rail della modal NON usa `also` — quello è roba della sola
sidebar (`navTeamItem`): confronta esatto, `item.route === route`, dove `route` viene da
`brandModalTarget`, che per `/app/<slug>/workbench` torna `workbench` e nient'altro. Nessun
prefisso, nessuna rotta sorella coinvolta. E `importerFor('workbench')` risolve, quindi la voce non
mostra la freccia "resta pagina piena".

**Nessuna porta doppia.** `/workbench` non era in nessuna lista di nav: le sole porte erano la
pillola in topbar (che esiste solo sulla home del brand), ⌘K (`app.home.workbench.open`) e il chip
"post da approvare". Il rail è la prima porta stabile, ed è la stessa pagina — nessuna rotta nuova.

**Il test.** `workbench-paths.test.ts` accettava solo chiavi `app.hub.*` / `app.nav2.*`: la regex è
stata allargata a `app.home.` proprio per NON coniare una chiave nuova, e si è aggiunto il pin
dell'ordine (`NAV_TEAM_SPACES[0].path === '/workbench'`), che è la decisione da difendere.

**Rimasto fuori, da decidere.** `app.home.workbench.failed` è la terza riga dello stesso oggetto e
dice ancora "Status couldn't be loaded." / "…caricare lo stato" in tutte e quattro le lingue: la
rinomina ne ha toccate due su tre. Si vede quando il `{#await}` del workbench va in `catch`.

**Verificato nel browser vero** (Playwright, dev server su porta dedicata, mai la 5173): modal
intestata "Spaces" con *Overview* in cima e attiva, corpo con il workbench vero, URL fermo su
`/app/<slug>` sia cliccando il rail sia cliccando la pillola — cioè la pillola porta esattamente
lì. Chiaro e scuro, 1440 e 390 (su mobile niente modal: cassetto della sidebar e pagina piena,
`<title>` "Anomalia — Overview"). Flag ON provato a parte: SPAZI = Overview, Calendario, Libreria,
Blog.

### Ogni brand, non i primi della lista: l'equità come meccanismo condiviso

**Il difetto.** Un lavoro periodico sceglieva i brand da servire così:

```ts
admin.from('brands').select('…').eq('status', 'active')
```

Nessun `order by`. Postgres non promette un ordine senza `order by`, e in pratica lo tiene stabile:
le stesse righe in cima a ogni giro. Con un audit da ~60s a brand dentro una finestra da 300s ne
passavano quattro o cinque e la function moriva — sempre gli stessi quattro o cinque. Nessun errore,
nessun allarme, il loop dall'esterno risultava "ok": si degradava.

**I numeri veri, letti in produzione il 2026-08-22** (13 brand attivi, 46 in trial):

| lavoro | cadenza | brand serviti / idonei | com'era messo |
|---|---|---|---|
| audit GEO | settimanale | 5/13 in 7 giorni | `with-love-from-brooklyn-2`, `dal-nulla`, `altro-agency` auditati **sei settimane di fila**; `kbpropertymanager` e `021` **mai**; `severoricami`, `desco-menu`, `bttrll-3` una volta in 45 giorni |
| market references | settimanale | 6/13 | 4 brand mai serviti, 3 fermi al 10 agosto |
| field watch | giornaliero | 4/13 | gli stessi 4 da sempre |
| link interni | settimanale | 4/13 | gli stessi 4 da sempre |
| crawl del sito | giornaliero | 13/13 | **sano** — ha già un cursore |
| revisione analytics | settimanale | 13/13 | **sano** — ha già un cursore |
| rank tracker | settimanale | 9/13 claimati, 0 snapshot | il cursore gira, a fermarlo è il tetto di spesa DataForSEO |

Le due righe sane sono la prova che la correzione funziona: sono gli unici due tick che avevano già
un ordinamento esplicito e un claim prima dei gate.

**Perché non era una toppa sola.** Il difetto stava in nove punti diversi con nove forme diverse:
chi non aveva `order by`, chi non aveva tetto, chi non aveva scadenza, chi contava i successi invece
dei tentativi, chi aveva un cursore scritto solo quando il lavoro riusciva. Quest'ultima variante è
la più cattiva: `library/tick` teneva il posto a un brand col sito irraggiungibile — `crawlBrandSite`
lanciava, il `.catch(() => -1)` assorbiva, nessun `last_scanned_at` veniva scritto, quindi il brand
restava "mai scansionato" e veniva riprovato **ogni singolo giorno**, bruciando 1-2 minuti di
finestra senza nemmeno consumare uno dei due slot di successo. `market/field` faceva lo stesso per
costruzione: `buildFieldPlaybook` torna `null` sotto i tre teardown, e il gate chiedeva un playbook
non nullo — un brand piccolo non poteva soddisfarlo mai.

**La forma condivisa: `loop_cursors` + `src/lib/server/loop-fairness.ts`.**

`queueForLoop(admin, loop, candidates, limit)` legge il cursore, ordina (chi non è mai stato servito
per primo, poi dal più vecchio, pareggio rotto sull'id) e taglia al tetto. `markServed(admin, loop,
brandId)` scrive il claim. Sono due funzioni separate apposta: marcare l'intera coda in una volta
sarebbe una riga in meno e un difetto in più — se la finestra finisce a metà, i brand claimati e mai
lavorati finirebbero in fondo alla coda senza aver ricevuto niente, cioè la fame di prima con un
cursore che giura il contrario. **Si claima ciò che si sta per attaccare, non ciò che si spera di
fare.**

**Da dove viene, e cosa è stato scartato.** Non dal `roundRobin` del radar (`radar.ts`), che era il
candidato ovvio: quello distribuisce equamente item già scaricati dentro UNA passata, non ha memoria,
e quindi non può riprendere da dove un tick si era fermato — che è precisamente ciò che serve quando
la flotta non entra in una finestra. Viene invece dai quattro tick che il problema lo avevano già
risolto ciascuno per conto proprio con una colonna dedicata su `brands` (`last_review_at`,
`last_crawl_at`, `last_visual_at`, `last_rank_check_at`): stesso algoritmo, storage diverso.

Scartate anche: **una colonna per loop** su `brands` (una query sola e index-scannable, ma sette
colonne nuove e una DDL per ogni lavoro futuro — è esattamente il motivo per cui i lavori senza
colonna si erano inventati altri gate); e **derivare il cursore da `loop_ticks`**, che sarebbe stato
zero migration ma poggia l'equità su una insert fire-and-forget la cui stessa migration (0199)
promette che la retention sarà «un delete per `created_at`»: potare il log azzererebbe l'equità. Il
cursore è stato, il tick è il registro.

I quattro tick già sani restano sulla loro colonna: riscrivere un cursore che in produzione gira è
rischio senza guadagno. Il nuovo è la forma per tutto il resto, e per il prossimo lavoro.

**I tick convertiti** (ordine + claim prima dei gate + budget di finestra + una riga in `loop_ticks`
per ogni `continue`):

- `geo/tick` — il caso principale, e in cascata sblocca l'agente SEO che pretende una riga di audit
- `market-references/tick`, `library/tick`, `market/field` — cursore scritto solo sui successi
- `seo/review/tick` — aveva anche `deadlineMs: 240_000` per **ogni** brand dentro una funzione da
  300s: bastava un brand lento a prendersi l'intera finestra. Ora il budget del singolo run è quello
  che *resta* (`nextRunBudgetMs`)
- `seo/keywords/tick` — nessun ordine, nessun tetto, nessuna scadenza
- `autopilot/tick` — nessun tetto e nessun ordine sulla lista dei "due". Il claim `autopilot` è un
  cursore **diverso** da `last_autopilot_run_at`, e la distinzione conta: quello dice quando il brand
  ha *prodotto* (gate di cadenza, si scrive solo sui successi, o la cadenza slitterebbe di una
  settimana a ogni fallimento), questo dice quando il tick lo ha *tentato*
- `radar/recap` — non affamato oggi (3 brand col radar acceso, ~2s l'uno), ma senza cursore né
  tetto; e un giorno tranquillo non scriveva nessuna riga, quindi su `/agents` un brand silenzioso
  era indistinguibile da uno rotto
- `seo/crawl/tick` — una riga sola: il gate di piano stava **sopra** il claim, quindi un brand senza
  Web hub non avanzava mai `last_crawl_at` e con `nullsFirst` restava fisso in uno dei tre slot di
  testa

**Lasciati stare, col perché.** `analytics/review`, `analytics/visual`, `seo/ranks` — già corretti,
e la produzione lo conferma. `custom-agents/tick`, `blog/month/work`, `radar/work`, e gli altri
drenatori `*/work` — code vere con claim-first o CAS, corretti per costruzione. `market/harvest`,
`market/trends`, `wall/sweep`, `benchmark`, `health/*`, `leads/outcomes` — non sono fan-out per
brand. `autopilot/digest` — ha già un claim condizionale corretto. `gsc/tick`, `backlinks/external`,
`geo/reprobe` — hanno lo stesso difetto ma su tabelle di coda, e i numeri dicono che oggi non morde:
1 connessione GSC attiva, 0 opportunità GEO applicate, 0 ordini backlink aperti. Segnalati, non
toccati.

**Due cose che la diagnosi diceva e i dati smentiscono.** Il `maxPerDay` del radar con default a 1
**non** è un difetto: è il budget di *contenuti* che il cliente sceglie (1-3 post al giorno, clampato
in `radarPrefsOf`). Con 4 tick al giorno il primo consuma il budget e gli altri tre non trovano nulla
da fare — che è il comportamento corretto per «al massimo un post al giorno», non tre passi sprecati.
E il cap a 40 con round-robin per fonte è la correzione del 2026-07-15, non il difetto.

**Una cosa più grande di come era stata descritta.** L'autopilot — il prodotto vero — ha raggiunto 3
brand su 13 negli ultimi 7 giorni, e 6 su 13 non hanno un solo post in 30 giorni. L'ordinamento e il
tetto lo rimettono in rotazione, ma non è detto che la fame sia l'unica causa: vanno guardati anche i
gate dentro `runAutopilotForBrand` (account collegati, coda di approvazione, crediti). Adesso però
`loop_ticks` scrive per ognuno di quei rami, quindi la domanda ha dove essere risposta.

**«Questo brand è stato servito questa settimana?»** `loop_cursors` dice **se** il tick lo ha
raggiunto, `loop_ticks` dice **cosa** ne è uscito — e prima erano indistinguibili, zero righe in
entrambi i casi. `brandRoster` ora restituisce `servedAt` e `behind` (in ritardo oltre il doppio
della cadenza dichiarata in `ROSTER_JOBS`; mai servito conta come indietro, perché è il caso peggiore
e non quello neutro). Da SQL, la flotta intera per un lavoro:

```sql
select b.slug, c.served_at
from brands b left join loop_cursors c on c.brand_id = b.id and c.loop = 'geo'
where b.status = 'active' order by c.served_at asc nulls first;
```

**Il test che mancava** (`loop-fairness.test.ts`): con una flotta più grande della finestra di un
tick, dopo N giri ogni brand è stato servito almeno una volta e nessuno due volte prima che tutti ne
abbiano avuta una. Più: un tick interrotto dalla scadenza riparte da dove era (non dall'inizio), e un
brand che non produce niente non trattiene lo slot. È il test che avrebbe intercettato tutto questo,
e nessuna delle nove rotte ne aveva uno.

**Migration `0213_loop_cursors.sql` — scritta, NON applicata.** Va applicata a mano prima del deploy:
`queueForLoop` lancia se la tabella non c'è, deliberatamente. Un cron che risponde 500 lo si vede; un
cron che degrada no — ed è tutto il punto di questo lavoro.

### Sentry non parla più da localhost, e non registra i giri di prova del founder

Due rumori diversi con la stessa firma: l'ingest di Sentry riceveva tutto quello che succede in
`npm run dev`, e in produzione registrava le sessioni dell'account del proprietario, che sta nel
prodotto tutto il giorno per provarlo.

**Il primo era peggio di uno spreco di quota.** `hooks.client.ts` aveva
`tracesSampleRate: dev ? 1.0 : 0.1`: in sviluppo *ogni* transazione partiva verso l'ingest. Non
solo il client — `instrumentation.server.ts` faceva lo stesso lato server con
`process.env.NODE_ENV !== 'production' ? 1.0 : 0.1`. Con la quota esaurita l'ingest rispondeva 429,
e quelle 429 tornavano nei log come se fossero errori dell'applicazione: un altro agente le ha già
scambiate per un guasto e ha diagnosticato la cosa sbagliata. Abbassare il campionamento non
sarebbe bastato, quindi in sviluppo Sentry **non si inizializza affatto** — in entrambi i punti,
altrimenti si spegne metà del rumore e sembra risolto.

Spegnerlo non spegne gli errori: `handleErrorWithSentry()` senza handler custom usa il suo
`defaultErrorHandler`, che fa `console.error`; e `captureException` senza client è un no-op
silenzioso, quindi `onboarding-errors.ts`, `market-errors.ts` e gli altri chiamanti continuano a
fare il resto del loro lavoro (riga sul db, mail agli ops) senza accorgersene.

**Il secondo non si poteva risolvere non inizializzando.** `bootSentry()` gira al caricamento del
modulo `hooks.client.ts`; l'identità di chi sta guardando arriva solo all'idratazione, dal root
`+layout.server.ts`. Quindi: si inizializza lo stesso, e si scartano gli eventi con
`beforeSend` / `beforeSendTransaction` / `beforeSendLog`, tutti e tre puntati su `dropIfInternal`.
Il replay è trattato a parte e prima: `attachReplay()` esce subito se il visitatore è interno,
perché il replay comincia a bufferizzare il DOM appena viene agganciato — e ci arriva alla prima
interazione o dopo 8–10 secondi, quindi molto dopo che il layout ha detto chi è.

**Chi è "interno" non è un meccanismo nuovo.** `isInternalEmail` (`$lib/server/internal-users.ts`)
esiste già e serve lo stesso scopo per PostHog, Seline e Meta CAPI. Niente variabile d'ambiente
nuova, niente email nel sorgente lato client: al browser arriva solo un booleano.

Ma il booleano è **nuovo e separato** da `analyticsOptOut`, di proposito. `analyticsOptOut` è
"ambiente non di produzione **oppure** siamo noi", e va benissimo per gli analytics. Se Sentry
avesse riusato quello, si sarebbe spento anche su ogni deploy di preview (`*.vercel.app`), cioè
esattamente dove gli errori vogliamo vederli. Quindi `+layout.server.ts` restituisce anche
`internalViewer`, e il layout lo passa a `setInternalViewer` accanto a `setAnalyticsOptOut` — nel
body dello script, non in un `$effect`, per lo stesso motivo già documentato lì (l'`onMount` dei
figli gira prima degli effect del genitore). L'`$effect` accanto serve solo a seguire un
login/logout che avviene senza ricaricare la pagina.

`sendDefaultPii: true` è rimasto com'era: ora l'unico utente identificato che sarebbe stato
allegato agli eventi interni non produce più eventi, quindi il PII che manda è quello dei clienti
veri — che è il motivo per cui l'opzione era accesa.

**Cosa resta fuori.** Un solo envelope `session` (release health) per caricamento a freddo dello
shell app: `browserSessionIntegration` lo spedisce dentro `Sentry.init`, prima che il layout possa
parlare. Misurato con Playwright sulla build di produzione, riscrivendo `internalViewer:false` →
`true` nel payload SSR e contando i tipi di envelope:

```
NORMALE  /       [session, session, event]
NORMALE  /start  [session, session, event, client_report, session, transaction, session, event]
INTERNO  /       []
INTERNO  /start  [session]
```

Sulle pagine marketing non parte nemmeno quello, perché lì l'init è differito al wake e a quel
punto il flag c'è già. Se anche quel residuo desse fastidio: togliere `BrowserSession` dalle
integrazioni di default e riaggiungerla da `setInternalViewer(false)` — segnato come `ponytail:`
in `hooks.client.ts`, non fatto perché sono due account e zero payload.

### La banner dei cookie sparisce in locale, e solo in locale

A 1280x720 `CookieBanner.svelte` (`position: fixed`, `z-index: 9999`) copre parte della CTA di
accesso e intercetta il click nei test automatici. Nascosta con `dev` da `$app/environment`, nel
markup: `{#if $showBanner && !dev}`.

Due scelte deliberate:

1. **Non in `initConsentForRegion`.** Nascondere la banner non deve voler dire "consenso dato":
   lo store `consent` in locale resta `null`, cioè lo stesso stato di chi non ha ancora scelto, e
   `blocked()` in `$lib/analytics` continua a valere. In sviluppo si gira sul percorso del
   visitatore EEA che non ha acconsentito, non su uno che nessun cliente vede. Verificato:
   `localStorage['anomalia_cookie_consent_v1']` resta `null` dopo il caricamento.
2. **`dev`, non l'hostname, non `import.meta.env` a mano.** `dev` è una costante che SvelteKit
   sostituisce a build time: è `true` solo sotto `vite dev`. Un controllo sull'host avrebbe fatto
   sparire un obbligo di legge anche in preview, o peggio in produzione se la regex fosse
   sbagliata. Provato su una build vera (`vite build` + `vite preview`): la banner c'è su `/`,
   `/login` e `/start`, e Sentry manda i suoi envelope come prima.

### Via i cinque passi dalla homepage

`From zero to growth in five steps.` non c'era piu' bisogno che ci fosse. La sezione raccontava
il prodotto come un processo in cinque tappe — il tono di quando bisognava spiegare *cosa* fosse
Anomalia — mentre la pagina, ora, lo mostra: la squadra che ti guarda, il mockup di chat con otto
casi veri, e i mestieri che si passano il lavoro. Una spiegazione a passi, sotto una dimostrazione,
non aggiunge: rallenta.

Tolta la sezione dalla home (`src/routes/[[lang=locale]]/+page.svelte`) ed eliminato il componente
`HowItWorks.svelte`, che non aveva altri consumatori — verificato prima di cancellarlo, non dopo.

Le chiavi `landing.howitworks.*` restano nei quattro cataloghi: sono inerti, e i cataloghi in questo
momento sono in mano ad altri lavori. Vanno tolte quando quella zona e' libera — non prima, o si
perde una modifica altrui per risparmiare qualche riga di JSON.

### Le quattro schermate che presentano il prodotto, fatte delle cose del prodotto

Cinque richieste del proprietario in fila sulla presentazione dell'onboarding, e il filo comune di
tutte e cinque e' lo stesso: **un'illustrazione fatta di palle e rettangoli generici promette un
prodotto generico**. Ogni disegno inventato e' stato sostituito con la cosa vera.

**1. I cinque volti, in finto 3D, che seguono il puntatore.** La prima schermata mostrava tre
facce colorate a caso con tre pillole grigie sotto. Ora mostra i CINQUE specialisti veri, nella
stessa composizione della Panoramica — e non una copia: quella composizione e' uscita da
`ChatColumn` in **`AgentAvatarStack3D`** → `src/lib/components/AgentStack3D.svelte`, perche' due
copie di una cosa gia' regolata a mano (niente sfocatura, il piu' a sinistra specchiato, il
parallasse al posto della prospettiva) divergono al primo ritocco.

A CINQUE la disposizione a piramide non regge: aggiungere una quarta faccia dietro sbilancia da
un lato e le tre in basso diventano una fila. Quindi con quattro dietro la forma cambia — due
profondita' simmetriche, un arco che sale ai lati. Misurato a schermo: tre diametri distinti
(104/64/46 px) su tre altezze distinte. E un difetto trovato nell'estrazione: con un solo
`z-index` per tutti, l'ordine del DOM dipingeva le facce LONTANE sopra le vicine — la profondita'
al contrario. Ora si disegnano dalla piu' lontana alla piu' vicina.

**2. Le tessere dei social, in orbita attorno al mockup.** Non sparse per la pagina (sarebbero
decorazione) ma strette attorno alle due finestre: dicono una cosa sola, *questo lavoro finisce
li'*. L'elenco viene da `PLATFORM_KEYS`, non ricopiato: sono **nove**, non sette — Bluesky e
Reddit sono entrati dopo. Ogni logo sta in una tessera col SUO fondo di marca e il logo bianco
sopra: TikTok, X e Threads sono neri e sulla scena nuda sparirebbero nel tema scuro, esattamente
come un bianco sparirebbe nel chiaro. E' la forma di Impostazioni › account collegati (`.glyph`),
non una terza.

Il vincolo "mai sopra le finestre" e' diventato un test, e il test ha trovato il difetto: la nona
tessera, in fondo al centro, mordeva di quattro pixel il bordo inferiore del disegno. La fascia
bassa e' sottile quanto il padding e non c'e' modo di starci senza rischiare — via, e nove in due
colonne pulite ai lati. A 390 la risposta e' diversa e non le stesse tessere rimpicciolite: la
cornice non esiste piu', e le nove si raccolgono in una fascia ordinata sotto le finestre.

**3. Una schermata nuova: il lavoro dentro i tuoi strumenti.** E' la quarta, e si e' scelto di
aggiungerla invece di gonfiare la seconda: *"il lavoro arriva finito"* e *"lavora dentro i tuoi
strumenti"* sono due affermazioni diverse, e fonderle avrebbe prodotto una schermata che dice due
cose a meta'. Quattro schermate restano dentro il "2-4" della richiesta iniziale, e l'ordine ora
racconta una storia: **chi** lavora → **cosa** ti arriva → **dove** lavora → **come va avanti**,
chiudendo sulla rassicurazione (niente esce senza il tuo si') un attimo prima di scegliere l'agente.

Le app mostrate sono quelle VERE, e la lista e' corta di proposito. Verificato nel codice, non nel
`CLAUDE.md` (che su questo e' vecchio: dice che `app_integration_registry` decide cosa vedono i
brand — quella tabella e' stata **droppata** dalla 0193). Il catalogo e' dinamico e enorme
(`connectableCatalog` filtra su `managedAuth`), quindi la schermata non prova a rappresentarlo:
mostra le QUATTRO con l'integrazione piu' profonda (Drive, Notion, GitHub, Gmail leggono davvero
dentro la base di conoscenza — `knowledge-providers.ts`), tre esempi del resto, e una tessera
"+1000" che dice che ce ne sono altre senza fingere di elencarle.

FUORI di proposito, ed e' l'informazione utile:
- **OneDrive non esiste nel prodotto** — zero occorrenze nel repo. Metterla sarebbe stata una bugia.
- **Meta Ads e Google Ads esistono ma non passano di qui**: sono account pubblicitari (Zernio,
  `ads/connect/[channel]`), dietro `FEATURE_ADS` (spento di default) e un piano Pro, e Meta Ads
  pretende prima una connessione Facebook. In onboarding avrebbero promesso una pagina che per
  quasi tutti risponde 404.
- **Google Calendar** e' collegabile solo se Composio lo restituisce con `managedAuth`: sta fra gli
  esempi, coperto dal "+1000", mai come promessa dura.

**4. Le routine, come il prodotto le rende.** L'anello tratteggiato con la spunta diceva "ciclo" e
nient'altro: non la cadenza, non che sono lavori DIVERSI, non che tornano a riferire, e soprattutto
non la cosa piu' rassicurante della schermata. Ora e' una scheda: tre righe, una per lavoro, ognuna
con la FACCIA del suo proprietario vero (`JOB_OWNERS`: content, analyst, web sono gli unici tre che
possiedono routine), una barra di lunghezza diversa, la sua cadenza a tre battute e la spunta di
quando ha riferito. Sotto, staccata da una riga, la bozza che aspetta: due bottoni, e il pieno e'
il si' dell'utente — l'unico elemento pieno della scheda. Le facce sono le STESSE della prima
schermata, quindi la quarta si lega alla prima invece di essere un disegno slegato. Nessun testo
dentro l'illustrazione: niente da tradurre quattro volte.

**5. Il testo.** La prima schermata ora dice anche che gli specialisti non sono solo quei cinque —
*"quando serve una figura che nessuno di loro copre, te la assumi su misura"* — perche' gli agenti
custom sono un pezzo grosso del prodotto e in quella schermata non c'erano. La schermata delle
integrazioni parla di CONSEGUENZE, non di capacita', nel registro gia' approvato del mockup di
homepage: *"prima le tue schede prodotto, poi l'articolo — cosi' i numeri sono quelli veri"*, non
"ci colleghiamo a Drive". Quattro lingue, scritte.

**Movimento.** Tutto CSS puro, una `@keyframes` per famiglia: le fasi le danno `--d`/`--dl` per
tessera, quindi nessun timer e nessun secondo loop su una schermata che resta a video mentre la
persona legge. Il finto 3D e' l'unico rAF, ed e' quello che `AgentAvatar` gia' faceva.
`prefers-reduced-motion`: i cinque restano fermi e composti, le tessere non galleggiano, la spunta
delle routine resta VISIBILE (che abbiano riferito e' informazione, non animazione) e il si' smette
di pulsare.

### Il passo del brand: un invito al posto di una domanda, e un bottone che era una frase

Nel ramo "non ho un sito": *"Got a website after all? Go back and let Anomalia analyze it."* era una
frase intera dentro un bottone — spiegava la conseguenza invece di nominare l'azione. Ora e' "Ho un
sito". E *"What do you post about?"* e' diventato **"Dicci di piu'"** con una **textarea** al posto
dell'input: la domanda chiusa chiedeva una riga, l'invito aperto chiede il tema, il pubblico e cosa
rende diverso il brand. `nicheHint` e `nichePlaceholder` sono stati riscritti di conseguenza —
l'hint diceva "una riga sola" ed era diventato falso. Il valore resta `creatorNiche` e viaggia dentro
`profile.about` come JSON, che gli a capo li regge: nessun consumatore a valle lo tratta come una
riga sola. La textarea usa `.ctx-area`, la stessa forma dell'altra textarea della pagina.

### Blog non si apriva mai: sei icone mai importate, e una modal che aspettava per sempre

Il proprietario segnalava che **Blog** (`/app/[brand]/site`) restava sullo scheletro di
caricamento, per sempre. Non era il server: il `load` risponde 200 in ~200ms (misurato in
browser, `cachedBrandPage` incluso). Era il client, e il difetto era latente da mesi.

`site/+page.svelte` usa `Sparkles`, `Upload`, `Calendar`, `Trash2`, `Pencil` e `Eye` nel
template, ma la riga di import ne dichiarava due (`Plus`, `ExternalLink`). Il compilatore
Svelte non se ne lamenta: un componente non dichiarato compila in un identificatore nudo,
`Sparkles(node_7, {...})`, che in ESM è un `ReferenceError` a tempo di render. Solo
`svelte-check` lo vede — e lo vedeva già: *Cannot find name 'Sparkles'*.

**Perché nessuno se n'era accorto.** Ogni icona mancante sta dentro un ramo condizionale:
`pendingReview > 0`, `data.draftCount > 0`, `unscheduled > 0`, `selectedIds.length`. Un brand
senza articoli apre la pagina senza toccarne nemmeno una. Il brand demo ha zero articoli:
per riprodurlo bisogna avere articoli veri, o iniettarli nella risposta `__data.json` lato
browser (fatto con Playwright, zero scritture sul db).

**Perché diventava un caricamento infinito e non un errore.** `PageModal` ha due esiti per il
carico: `hosted` valorizzato → mostra la pagina; `loadError` → mostra "non si è caricata" con il
link *apri a pagina intera*. Un `ReferenceError` durante il **render** non è né l'uno né l'altro:
`preloadData` era andato bene, quindi `loadError` restava `null`, ma il sottoalbero moriva prima
di stampare qualcosa. Restava il ramo `{:else}` — lo scheletro che pulsa. Nessun messaggio,
nessuna uscita, e l'utente chiuso dentro l'overlay.

**Le due correzioni, e perché servono entrambe.**

1. Le sei icone importate (`site/+page.svelte:3`). E, dalla stessa passata di `svelte-check`,
   gli altri identificatori mai importati della stessa famiglia: `ArticleChat`
   (`site/edit/[id]`, l'editor articolo), `createSupabaseBrowserClient` (`manual-posting`,
   esplodeva all'upload da dispositivo), `enhance` (`ScopePicker`, il selettore di cartelle
   Drive/pagine Notion).
2. `<svelte:boundary>` attorno alla pagina ospitata in `PageModal`. Il messaggio di errore
   diventa uno snippet (`loadFailed`) reso da entrambi i rami: rete e render finiscono nello
   stesso posto. Vale per tutte le 46 pagine ospitabili — Blog è solo quella dove si è vista
   per prima. Sta dentro `{#key h.route}`, così cambiare pagina ricrea la boundary e la resetta.

Scartato: catturare l'errore con `onerror` e scriverlo in `loadError`. Mutare stato dentro
`onerror` durante il render è il modo per prendersi uno `state_unsafe_mutation`; lo snippet
`failed` è la via nativa e non tocca stato.

Resta aperto (fuori da questa correzione, altra superficie): `DashboardMockup.svelte` usa
`perfPlatforms` e `topPosts`, che non sono mai stati dichiarati — il pannello Analytics del
mockup della landing va in `ReferenceError`. Non è un import mancante: quei dati finti non
esistono e vanno scritti.

### «No, non posso accedere a Google Calendar» — e invece poteva

Un proprietario ha chiesto in chat se l'agente potesse accedere al suo Google Calendar. Risposta:
no, non ho il tool, però posso proporti degli orari, sistemarti i 4 post pending, aggiornarti il
piano. Tutto vero tranne la prima parola: `propose_app_connection` esiste da mesi, valida il
toolkit contro il catalogo Composio intero e rende in chat una card con il bottone Connetti.

**Due cause, non una.**

La prima è quella che si vede: la regola era scritta in **un prompt solo**, il brief
dell'onboarding (`onboarding-chat.ts`, punto 8, con tanto di `GOOGLECALENDAR` e `NOTION` come
default da proporre). Nei prompt della chat normale il nome del tool non compariva mai — e i due
posti che parlavano di app non connesse dicevano l'esatto contrario: *«If not_connected,
propose_open_tab /settings/connectors»*. Cioè: manda la persona in una pagina di impostazioni, che
è il gesto che l'utente farebbe da solo se sapesse che quella pagina esiste.

La seconda è più grave e non si vedeva dai prompt: **`propose_app_connection` non stava in
`SHARED_TOOL_KEYS` né in nessuna `toolKeys`**. `pickTools` filtra per nome, quindi lo toglieva a
tutti e cinque gli specialisti; sopravviveva solo per l'agente nullo (Anomalia auto) e per
l'onboarding. Quel «non ho il tool» era letteralmente vero per l'agente che l'ha detto. Stessa
cosa nelle modalità Ask e Plan, dove `filterToolsForMode` non lo elencava — ed «puoi accedere a
Google Calendar?» è esattamente una domanda da modalità Ask.

**Dove sta adesso la regola.** In `buildConnectorsPrompt` (`composio-agent.ts`), non in `agents.ts`
e non in `system-prompt.ts`: quel blocco viene spinto nella *shared identity* di ogni prompt di
chat — ogni specialista, ogni consulto, ogni sotto-agente, ogni turno schedulato. Una regola
scritta in un prompt solo viene contraddetta dall'altro; questa è l'unico posto che li raggiunge
tutti in una volta. Il titolo del blocco passa da `## CONNECTED INTEGRATIONS` a
`## APPS & INTEGRATIONS`, perché il vecchio nome descriveva un inventario e il punto è che
l'inventario non è il confine.

**La proattività, e la misura che la tiene in piedi.** Copiare l'istruzione dell'onboarding non
andava bene: lì l'utente si aspetta di configurare, in chat no, e un agente che spara una card a
ogni turno diventa rumore che si impara a ignorare. La formulazione scelta lega la proposta a una
prova, non a un'opportunità: si propone un'app non richiesta *solo quando si può indicare il pezzo
di lavoro concreto che ha davanti e che quell'app cambierebbe* («sto scegliendo gli slot di questi
4 post; col tuo calendario eviterei i giorni in cui sei via» è una ragione, «un CRM potrebbe
servire» no). Più due limiti duri: **una** card non richiesta per turno, e **mai due volte la
stessa app** — card già nel thread, o l'utente è andato oltre, o ha detto no, e quell'app è
chiusa; si ritorna sopra solo se il lavoro si ferma davvero senza.

**Il difetto opposto era già impedito, ma andava verificato.** `loadConnectorCatalog` filtra con
`connectableCatalog` (`managedAuth` o una nostra auth config), quindi `propose_app_connection` non
può proporre un toolkit che risponderebbe 404 al click: torna `unknown_toolkit` con i
suggerimenti. Per questo il prompt può dire «provaci col nome per esteso» senza rischiare di
promettere collegamenti che non esistono. Un buco però c'era: con **zero** suggerimenti il
messaggio diceva solo «non è nel catalogo», e un modello che aveva provato `gcal` ne concludeva
che il calendario non è collegabile. Ora il caso a zero risultati dice esplicitamente di
riprovare col nome comune per esteso prima di dichiarare l'app indisponibile.

**Niente tool di ricerca del catalogo.** Valutato e scartato: `propose_app_connection` con un nome
approssimativo *è già* la ricerca — `searchCatalog` gira sul catalogo già filtrato per
connettibilità e rende i 5 slug più vicini, con match esatto sul display name (quindi
`"google calendar"` → `GOOGLECALENDAR` al primo colpo, nonostante `normalizeToolkitSlug` produca
`GOOGLE_CALENDAR`). Un `search_app_catalog` separato sarebbe un secondo round-trip per la stessa
informazione, e un secondo tool da tenere allineato.

**I social restano un'altra porta.** Instagram, Facebook, LinkedIn, TikTok, X, YouTube, Threads,
Pinterest esistono anche nel catalogo Composio, ma da noi passano da Settings → connected accounts
e dal piano a pagamento. Il blocco lo dice, o l'agente manderebbe l'utente a collegare Instagram
via Connectors — un vicolo cieco perfettamente funzionante.

### Il lavoro notturno sulla memoria non era mai partito (e la sua soglia era irraggiungibile)

`/api/v1/memory/dream` esisteva da mesi, protetto da `CRON_SECRET`, citato in tre documenti — e non
era registrato in `vercel.json`. Quindi non è **mai** girato: 1216 righe in `brand_memory` su 40
brand, **zero** promosse, **zero** decadute, 363 note di conversazione ferme nel thread dove erano
nate. La memoria di Anomalia cresceva e basta.

**Cosa avrebbe fatto il primo giro** (misurato in sola lettura sulla produzione, prima di accendere
niente): 74 righe decadute, **0** archiviate, **0** promosse, 7 archi orfani, 8 brand su 40 con una
chiamata AI di sintesi skill. Molto meno del previsto — ma il pericolo non era la prima notte: era
la quinta. Le 74 righe stanno fra 0.7 e 1.0 di confidenza, scendono di 0.1 a giro, e a 0.3 venivano
**cancellate**. Con un cron giornaliero: prime sparizioni alla notte 5, tutte entro la notte 8.

**E tutte e 74 avevano `times_used = 0`.** Non è un dettaglio: `buildMemoryContext` inietta al
massimo ~800 token di memoria, ordinati per confidence, e conta come "usata" solo la riga che
davvero è entrata nel prompt. Chi sta sotto il taglio non viene mai vista, quindi non viene mai
usata, quindi decade, quindi scende ancora nell'ordinamento — una spirale che finiva nel `delete`.
Il primo giro reale avrebbe cancellato, in una settimana, 74 memorie *colpevoli di non essere mai
state mostrate*. Sono 390 su 1216 le righe in questo stato oggi.

Quindi l'archiviazione ora ha un terzo scudo accanto a `pinned` e `skill`: **`times_used > 0`**. Una
riga mai mostrata decade fino al pavimento di 0.3 e lì si ferma, sotto la soglia di iniezione: costa
una riga in tabella, non una perdita. Una scadenza esplicita (`expires_at`) invece cancella comunque
— l'ha decisa chi ha scritto la riga.

**Il tetto per giro.** `DREAM_MAX_WRITES_PER_BRAND = 100`: decadimenti, archiviazioni e promozioni
insieme. Un arretrato si spalma su più notti invece di succedere tutto la prima. Le righe si leggono
ordinate per `updated_at` crescente, così ciò che viene toccato va in fondo alla coda e il tetto
ruota invece di ripassare sempre le stesse righe (la lezione delle fonti affamate del radar).

**La modalità di prova.** `GET /api/v1/memory/dream?dry=1` prende le identiche decisioni senza
scrivere, cancellare o chiamare l'AI, e risponde con il dettaglio per brand — comprese le chiavi che
cancellerebbe e le chiamate AI che partirebbero. È il modo di guardare un giro prima di lasciarglielo
fare, ed è il primo comando da dare dopo il deploy.

**Dove finisce il risultato.** Prima: nel JSON di risposta, cioè nei log di Vercel, cioè da nessuna
parte. Ora ogni brand su cui il giro ha toccato qualcosa lascia una riga in `agent_runs`
(`agent = 'dream'`) con i conteggi **e il nome delle chiavi cancellate**. Nessuna tabella nuova:
`agent_runs` esisteva già per le sessioni degli agenti e il suo `agent` è `text`, non un enum.

**La soglia irraggiungibile.** La promozione `session → project` scatta a `times_reinforced >= 3`, e
il massimo su tutta la tabella era **2**. Non era una soglia troppo alta: era una soglia che il
prompt stesso rendeva impossibile. `extractMemoryFromChat` diceva al modello *"Skip things already
in EXISTING MEMORY"* — gli chiedeva letteralmente di non riestrarre la chiave che avrebbe fatto
scattare il rinforzo. Abbassare la soglia avrebbe aggiustato il termometro invece della febbre (e
con i dati veri: soglia 2 → 1 riga promossa, soglia 1 → 6; comunque zero-virgola).

Quindi si è cambiata l'estrazione, non la soglia: se il turno **conferma** qualcosa che è già in
memoria, il modello lo riemette **con la stessa identica chiave**, e `writeMemory` fa il resto —
rinforzo, confidence +0.05, `times_reinforced++`. È già la regola che `learnFromCaptionEdit` dava al
modello venti righe più sotto nello stesso file (*"reuse the SAME key to reinforce a rule"*): i due
prompt dicevano il contrario l'uno dell'altro. Il raggio d'azione resta minuscolo, perché
`extractMemoryFromChat` scrive **solo** livello `session` e `writeMemory` cerca la riga esistente
dentro lo stesso `thread_id`: una conversazione può rinforzare solo la propria memoria, mai quella
di brand direttamente.

**L'orario: `30 4 * * *`.** Ogni notte, fra `health/costs` (4:00) e `ads` (5:00), un'ora e mezza
prima che `autopilot/tick` (6:00) cominci a produrre i post — così la produzione del giorno legge
una memoria già ripulita e non compete con un lavoro che rimastica la memoria di tutti i brand. Non
settimanale, anche se il codice si chiamava "weekly": un fatto confermato oggi deve essere
patrimonio del brand domani, non il martedì prossimo. Il decadimento resta 0.1 per giro, cioè sette
volte più veloce di quanto la vecchia docstring intendesse — accettabile **solo** grazie allo scudo
`times_used`, che è ciò che separa "decade" da "sparisce".

**Cosa non è stato fatto.** Nessun trattamento speciale per le note di mestiere per agente
(`brand_memory.agent`, migration 0212): oggi in produzione sono zero righe, e lo scudo `times_used`
copre già il caso che preoccupava — una nota di Motion letta di rado decade fino a 0.3 e resta lì
invece di sparire. `promoteMemoryToProject` già conserva il proprietario, quindi una nota promossa
resta di chi l'ha scritta. Niente sharding per brand: il giro è ancora sequenziale, e con 880 archi
totali sta dentro i 300s — se un giorno non ci sta, si spezza per brand id (il commento `ponytail:`
è già lì).

### L'avatar del caricamento ha una vita sua (e il morph non era mai partito)

Richiesta del proprietario: *"okay che segue il cursore, ma deve poter fare animazioni tutte sue,
tipo giravolta a 360, oppure che cambia espressione nel tempo"*. Prima l'avatar grande dell'attesa
faceva due cose: seguiva il puntatore e cambiava faccia ogni 2400ms esatti, sempre nello stesso
ordine di otto pose (`loadingFaceAt`). Un metronomo: dopo tre attese lo sai a memoria.

Il repertorio nuovo vive in `avatarBeatAt` (`src/lib/agent-avatars.ts`), pura e deterministica su
(seed, step) — il seme nasce al mount, quindi due attese non si somigliano, ma i test la pinnano
senza timer. Ogni battito decide **tre** cose: la faccia, la durata della posa, e se questa volta
tocca una mossa grande. Due regole tengono il ritmo leggibile: mai la stessa faccia due volte di
fila, mai due mosse grandi attaccate.

**Il tempo dell'attesa cambia il repertorio**, perché due secondi e novanta non sono la stessa
esperienza:

| fase | quando | pose | mosse | durata posa |
|---|---|---|---|---|
| attento | 0–9s | wide, dot, curious, focus, squint | nessuna | 1.8–3.4s |
| occupato | 9–40s | tutto il set | 28% dei battiti | 1.2–2.8s |
| annoiato | oltre 40s | sleepy, visor, squint… | 45% dei battiti | 2.4–4.4s |

Niente capriole nei primi nove secondi: una giravolta due secondi dopo l'invio è un giocattolo
rotto, non un personaggio. Dopo il minuto le pause si allungano e le palpebre si abbassano.

**Come capriola e sguardo si compongono invece di litigare.** Sono due strati diversi: lo sguardo
resta dov'era, cioè offset delle feature sulla superficie della palla (dentro l'SVG), mentre la
mossa grande è una `transform` CSS sul `<g class="face">`. Durante una giravolta la testa gira
TENENDO lo sguardo, come una testa vera. Nemmeno il respiro di `.busy` litiga: quello scala
l'`<svg>`, questo ruota il `<g>`. Le quattro mosse (`spin`, `nod`, `tilt`, `stretch`) sono keyframe
CSS che il compositor fa girare da sole e che si spengono su `animationend` — nessun secondo timer.

**Il costo**: un solo `setTimeout` alla volta, riarmato dal battito appena suonato; niente timer per
tratto; `IntersectionObserver` + `visibilitychange` fermano tutto quando l'avatar esce dallo schermo
o la scheda va in secondo piano. `prefers-reduced-motion: reduce` spegne il loop alla radice (e le
keyframe restano disattivate anche via media query, per la classe rimasta appesa).

Acceso **solo** dove serve: `alive` è un prop spento per default, e lo passa solo `ChatLiveStatus`
(l'avatar grande del turno). Sidebar e liste restano ferme.

**La `hash()` lineare.** Il primo giro usava l'hash già in casa (`h*31 + c`): su step che avanzano
di uno restituisce numeri che avanzano di uno, e in Playwright si vedeva benissimo — pause di 2642,
2704, 2766ms, +62 ogni volta. Un ritmo a scaletta è prevedibile quanto un intervallo fisso. Ora c'è
uno splitmix32 (`mix`), e un test pinna che le pause non marcino in una direzione.

### Il morph delle espressioni non è mai partito, da quando esiste

Trovato provando il ritmo, non cercato: `AgentAvatar` cancellava **ogni** `requestAnimationFrame`
del morph ~1ms dopo averlo chiesto. In 12 secondi di Playwright: dieci `req`, dieci `cancel`, zero
`run`. Il tween quindi restava congelato sul primo frame — quello in cui le feature orfane sono a
dimensione zero — e ogni cambio successivo ripartiva da lì: dopo due espressioni il volto del
caricamento aveva gli occhi invisibili. Nessun test se ne accorgeva perché la parte pura
(`avatar-morph.ts`) è giusta: era il ciclo di vita dell'effect a essere rotto.

Causa: due letture tracciate dentro l'effect che scrive `tween`.

1. `$state.snapshot(untrack(() => drawn))` — l'`untrack` avvolgeva la lettura di `drawn` ma **non**
   lo snapshot, che attraversa il proxy proprietà per proprietà: quelle letture finivano tracciate.
2. `const frame = tween` subito dopo `tween = createMorphFrame(plan)` — l'effect si iscrive allo
   stato che ha appena scritto.

In entrambi i casi l'effect si auto-invalidava, Svelte lo rimetteva in coda, e la sua cleanup
cancellava il rAF prima del primo frame. Ora entrambe le letture stanno dentro `untrack`, e il morph
gira: misurato, `t` va da 0 a 1 su ~25 frame.

### Il centraggio delle righe di sistema, misurato invece che dedotto

Segnalazione del proprietario: *"il label `10 actions taken · read talents`, quando sta chiamando le
tool call, non è centrato rispetto alla chat ma rispetto alla width max delle bubble"*. Vero, e la
causa non era il gutter: `.chat-turn > * { max-width: min(100%, 780px) }` colpisce anche
`.live-status`, che è il **contenitore** del turno vivo (`width: 100%`), non un blocco di contenuto.
Misurato a 1600px sulla pagina del thread: la stessa riga stava a **634** durante lo streaming e a
**910** — il centro vero della chat — appena il turno finiva. 276px di salto, alla fine di ogni
risposta.

Il cappello scende di un livello (`.chat-turn > .live-status { max-width: none }` +
`.live-status > *`), scritto prima di `.chat-msg-cell` e con la stessa specificità, così la misura di
lettura della bolla (75ch) continua a vincere per ordine di sorgente.

Secondo disallineamento trovato misurando: la bolla in streaming è figlia diretta di `.live-status`,
non di `.chat-turn-line`, quindi non prendeva il rientro del volto — nasceva a x=244 e finiva a
x=282, cioè la risposta scattava di 38px di lato proprio nel momento in cui si chiudeva. Ora il
rientro va a ciò che è bolla (`.chat-msg-cell`, `.reasoning-block`) e non al contenitore, che deve
restare a piena larghezza per tenere le chip centrate.

Verificato su **entrambe** le superfici (pagina del thread e colonna della Panoramica) e in una chat
vera: avatar vivo a 258.0, volto della bolla finita a 258.0 — nessun salto quando la risposta si
chiude.


### La memoria dell'agente: il mestiere, non il brand

Domanda del proprietario: *"Ogni agent, custom o default, ha una propria memory?"* No — e due dei
tre livelli c'erano già. `brand_memory` aveva `layer='project'` (la memoria del brand, 864 righe su
37 brand) e `layer='session' + thread_id` (la singola conversazione, 367 righe). Mancava la
dimensione dell'agente: `unique (brand_id, key)` era **un unico spazio dei nomi per brand**, quindi
un agente non poteva avere niente di suo — nemmeno una chiave con lo stesso nome di quella di un
collega.

La colonna nuova (`brand_memory.agent`, migration `0212_memory_agent_scope.sql`) **non** è un
archivio separato per agente: è una terza dimensione, nullable, sulla tabella che c'era.
`agent IS NULL` = memoria del brand, la leggono tutti; valorizzato = nota di **mestiere** di quel
solo agente. La grammatica è quella che il prodotto usa già (`custom:<uuid>`, `agent-owners.ts`),
non una seconda inventata qui.

**Perché il mestiere e non il brand.** Se Content impara che questo brand non dice mai "soluzione
innovativa", quel fatto deve arrivare anche a Motion e a Web: chiuderlo dentro Content renderebbe la
squadra più stupida, che è l'opposto della promessa. Quello che appartiene davvero a un agente è
*come lavora* — "su questo brand i miei caroselli rendono col prezzo alla terza slide", "sopra le
sei battute il render mi salta". Da qui le tre regole:

1. **In lettura** un agente vede la memoria del brand PIÙ la propria, mai quella dei colleghi
   (`scopeToAgent`, un solo filtro condiviso da `buildMemoryContext` e `loadMemoryEntries`).
   Senza agente — scheduler, radar, weekly recap — entra **solo** il brand.
2. **`voice`, `constraint` e `fact` non possono mai essere private**: se un agente prova a
   scriverle come sue, `memoryAgentScope` le riporta al brand. La regola sta **in codice**, non nel
   prompt: è esattamente il caso in cui un modello sbaglierebbe in silenzio, frammentando la
   conoscenza del brand una riga alla volta.
3. **La pagina Knowledge continua a mostrare tutto**, con un distintivo che dice di chi è la nota —
   il brand deve poter vedere cosa la sua squadra ha imparato. È l'unico posto con questa
   asimmetria, ed è voluta: browsing, non prompt.

**L'unicità, e la trappola.** `unique (brand_id, key)` diventa `(brand_id, agent, key)`. Ma un
indice unico su una colonna **nullable** in Postgres tratta ogni NULL come diverso da ogni altro:
scritto così, avrebbe lasciato passare due righe di brand con la stessa chiave — cioè avrebbe rotto
proprio il vincolo che sostituiva. Verificato sul database vero (PG 17.6, in transazione annullata):
indice semplice → 2 righe duplicate, `nulls not distinct` → 1 sola. È la forma usata, per l'indice
di progetto e per quello di sessione.

`add_memory` guadagna `scope='mine'` accanto a `session`/`project`, e `read_memory` legge sotto la
stessa identità. `createChatTools` e `buildSystemPrompt` ricevono chi sta rispondendo
(`custom:<uuid>` per un agente custom, risolto in `queue.ts` prima del system prompt invece che
dopo). Il livello per thread **non è stato toccato**: c'era già e funziona.

⚠️ **Il deploy non esegue le migration.** Finché la 0212 non è applicata a mano, ogni filtro su
`agent` fa tornare vuota la lettura di `brand_memory`. Applicarla PRIMA di spedire.

### Due difetti trovati, non risolti: la promozione non è mai scattata

Zero righe promosse da sessione a brand, su 367 memorie di sessione. Due cause indipendenti, che
vanno affrontate insieme o non si vede niente:

1. **Il cron non esiste.** `/api/v1/memory/dream` è implementato, protetto da `CRON_SECRET`, citato
   in `docs/18`, `docs/README` e `docs/ANALISI-PROCESSI-INTERNI-021` — e **non è in `vercel.json`**.
   `runDream` non è mai stato eseguito in produzione: non solo la promozione, anche il decadimento,
   l'archiviazione e la sintesi delle skill.
2. **La soglia è irraggiungibile.** `runDream` promuove a `times_reinforced >= 3`. Sull'intera
   tabella il massimo è **2** (1 su project, 2 su session): nessuna riga ha mai raggiunto la
   soglia, quindi anche accendendo il cron `promoted` resterebbe 0. `extractMemoryFromChat` dice al
   modello *"Skip things already in EXISTING MEMORY"*, cioè gli chiede esplicitamente di **non**
   riestrarre la chiave che rinforzerebbe.

Accendere il cron da solo non è un fix: farebbe decadere e archiviare centinaia di righe mai toccate
in 30+ giorni e partire una chiamata AI di sintesi per brand, tutto in una volta. È un lavoro a sé.

### I consulti fra agenti (`ask_to_*`) sono stati rimossi

Segnalazione del proprietario, in due tempi: *"il primo agente ha chiamato il tool ask agent UGC.
Come mai? Non stanno rispondendo quindi loro direttamente"* e poi *"adesso il first agent ha
risposto a nome di un collega"*. La seconda è la conseguenza meccanica della prima.

`ask_to_<agente>` era una consultazione **sincrona, senza stato e senza tool**: costruiva il prompt
del collega, faceva una singola chiamata di testo, e il risultato **rientrava nel turno di chi
aveva chiesto**. Il collega non poteva agire, non lasciava traccia, non era visibile. Quindi
l'unico posto dove la sua risposta poteva uscire era la bocca di chi l'aveva consultato — e se quel
collega è dentro la stanza e potrebbe parlare da sé, quella non è una citazione: è prendere il suo
posto. L'intenzione non c'entra, conta cosa vede chi legge.

Il primo progetto era filtrare i membri della stanza dai destinatari. Poi il proprietario ha
chiesto la cosa più corta — *"non ha senso tenere ask_* allora"* — e i numeri gli hanno dato
ragione: in `ai_calls`, **3 chiamate in 30 giorni**, una delle quali è proprio quella che ha
segnalato. Venti tool montati (cinque agenti per quattro colleghi) che nella pratica servivano a
produrre il difetto. Cancellare è un diff più piccolo del filtro e chiude anche il caso fuori dalle
stanze, che il filtro avrebbe lasciato aperto.

Via `ask-agent.ts` e il suo test, `askToToolKeys`/`askToToolName`, la costruzione in `pickTools`, le
righe nei prompt di `agents.ts` e `system-prompt.ts`, le voci in `chat-modes.ts`, l'etichetta chip
in `chat-parts.ts`, e la superficie `'consult'` di `HarnessSurface` — che esisteva solo per questo
(verificato, non assunto). Nessuna chiave i18n è rimasta orfana: i cataloghi non nominavano i tool.

**Cosa resta al posto loro**, e sta scritto nel prompt perché un agente che si appoggiava al
consulto deve sapere dove andare, altrimenti al primo dubbio inventa la risposta del collega — lo
stesso difetto con un'altra maschera:
- i **fatti** di un altro hub: i `read_*` condivisi, che ogni agente ha già e ha sempre avuto (era
  già scritto in cima ad `agents.ts`);
- il **giudizio** di un collega, o un lavoro che è suo: `message_agent`, che apre un thread vero e
  persistente dove lui risponde **con la propria identità e i propri strumenti**, visibile;
- dentro una **stanza**: niente di tutto questo — dici cosa serve, chiudi il turno, e la parola
  passa a lui.

### La voce di un membro della stanza appartiene solo a lui

La metà mancante della regola, e vale ovunque, non solo nelle stanze. Chi scrive può riferire quello
che un collega ha **già detto** in quel thread, attribuendoglielo ("come diceva Analyst, …"); non
può produrre parole nuove a suo nome, rispondere "da parte sua", o firmare un pezzo col suo
mestiere. Nel blocco stanza in entrambe le lingue, e nel prompt di ogni specialista accanto a
`message_agent` ("finché la risposta non arriva, non ce l'hai").

E dentro una stanza il DM verso un membro **si rifiuta**: `stripRoomPeerTools` avvolge
`message_agent` e torna `recipient_is_in_this_room` con il motivo e cosa fare invece. Il
destinatario è un parametro libero, non il nome del tool, quindi non si può togliere dallo schema:
si chiude nei due posti che il modello vede (descrizione ed esecuzione). Verso chi **non** è nella
stanza il DM resta valido — è ancora un caso legittimo, ed è il motivo per cui il tool non si
cancella e basta. Fuori dalle stanze non cambia niente.

### Il ripiego dello smistatore non è più muto

La cosa più preziosa del giro, e viene da un errore mio: misurando il router avevo concluso che
sbagliasse sempre, e invece era il mio mock a rompersi — il `catch` trasformava l'eccezione in
"parla il primo membro" senza lasciare traccia. In produzione nessuno stampa quell'errore.

E quando il primo membro è anche il generalista (`auto`), una **scelta legittima** e un **errore
inghiottito** producono la stessa identica riga nel database. Indistinguibili. Qualunque correzione
sarebbe rimasta indimostrabile.

Ora ogni uscita si firma in `ai_calls.context`, la colonna dove queste cose si guardano già —
nessuna tabella nuova: `chat:room:pick` (ha scelto) contro `chat:room:fallback:no-model` /
`:error` / `:unparsed` / `:empty`. Lista vuota deliberata e risposta illeggibile erano lo stesso
non-evento e ora sono due guasti contati separati, con l'output vero del modello nel log. Più un
`console.warn` per il dev server. Tre `logAiCall` duplicati spariti: la funzione è più corta di
prima.

**È servita subito.** Interrogando la produzione sul thread che il proprietario ha segnalato: il
router aveva girato 6 volte, tutte `ok`, e rigiocando i suoi 6 messaggi veri sul modello vero sono
usciti 6 `pick` e zero ripieghi. Cinque di quei messaggi erano domande **sul team** ("chi siete?",
"e gli altri?"), che appartengono davvero al generalista; al sesto ("ugc presentati") ha risposto
UGC. Il sistema stava facendo la cosa giusta — ma senza quelle righe non c'era modo di saperlo.

### Nella stanza si decide una voce alla volta, non un piano

Il modello era: un router decide in anticipo fino a 2 voci, eseguite in fila. Adesso il router gira
**dopo ogni voce** (`roomContinue`), vede quello che è appena stato detto, e risponde a una sola
domanda — *manca ancora qualcosa, e di chi è?* — con "nessuno" come risposta normale.

Lo rende ovvio un numero: dai costi veri, una voce costa **$0.036** di mediana e **$0.147** al p95,
una chiamata al router **$0.00005**. **Parlare costa ~700 volte decidere.** Quindi si spendono
router con generosità e voci con avarizia.

Tre freni, e il più forte non passa da nessun modello:
1. **Una voce a testa per messaggio dell'utente.** Chi ha già parlato esce dai candidati nel
   codice. Rende *impossibile* — non sconsigliato — che due agenti si scambino cortesie o che uno
   risponda a se stesso, e limita la catena alla dimensione della stanza da solo.
2. **`ROOM_MAX_VOICES_PER_MESSAGE = 3`**, contato sulle battute vere e controllato prima di
   accodare. Il caso tipico resta una voce, quindi il tetto tocca solo il peggio: da $0.29 a $0.44
   al p95, ×1.5 e non ×3. A 4 sarebbe $0.59, e la quarta battuta è quella che nessuno legge.
3. **`adds` prima di `speaker`.** Il router deve dire in poche parole *cosa* manca prima di dire
   *chi*; se non lo sa dire, `parseNextSpeaker` scarta la scelta. Un modello che non sa nominare
   cosa manca non ottiene una voce — è il freno contro le quattro battute che non dicono niente, e
   sta in tre posti (prompt, forma del JSON, parser).

Niente contatore sul job: le voci già parlate si derivano dai messaggi salvati (`loadRoomTail`, una
query che serve già a costruire le battute per il router). Un contatore si perde a un rilancio, si
duplica a un doppio drenaggio e mente dopo un turno salvato dal reaper; le battute scritte no.

**Stop ferma la catena**, ed è un requisito di pari livello agli altri: un utente che preme Stop e
vede arrivare altre due voci non pensa "si sta fermando", pensa che il prodotto non gli obbedisce.
La guardia sta prima della decisione, in entrambi i runner, così non si paga nemmeno il router per
una battuta già interrotta.

**Il silenzio, deciso**: nessuno alla **prima** voce è vietato (l'utente ha appena scritto: qualcuno
risponde, e il ripiego ora è distinguibile nel log); nessuno a una **continuazione** è normale ed è
il modo standard in cui un giro finisce. In una riga: *il silenzio è permesso esattamente quando non
è l'unico esito*. Il turno morto ha già un suo stato visibile e diverso — il banner con riprova —
quindi non si crea un "nessuna risposta" muto che gli somiglia.

**Alternativa considerata e non presa**: lasciare che A replichi a B dentro lo stesso messaggio
dell'utente. Il desiderio c'è (*"rispondendosi a loro volta tra loro"*), ma A→B→C con B che obietta
ad A **è già** una conversazione, mentre il batti-e-ribatti è la porta da cui entrano tutti i modi
in cui questa roba diventa costosa e stupida. La rilassata è pronta e scritta: un membro può
riparlare **solo se un altro ha parlato dopo di lui** — mai auto-risposta, mai ping-pong immediato,
sempre sotto il tetto. Si accende se il proprietario, guardando la cosa funzionare, dice che manca.

**Scartato anche `reply_to`** su `chat_messages`: in una chat fra umani quel campo non esiste, il
testo dice già a chi si risponde, e una colonna che nessuna interfaccia mostra è debito puro.

### La squadra in homepage guarda chi legge: 3 + 2, i destri specchiati, lo sguardo che segue

Cinque volti in una griglia da tre che andava a capo da sola (3 + 2 allineati a sinistra) e
**fermi**: la stessa squadra che dentro il prodotto segue il puntatore, sulla pagina che la
presenta stava immobile e guardava tutta nella stessa direzione — l'effetto "fila di cloni" che
`AgentStack3D` aveva già risolto per la Panoramica.

**Nessuna animazione nuova.** `AgentAvatar` ha già il rAF dello sguardo (`follow="pointer"`, con
smorzamento e saturazione `tanh`) e lo specchio alla **sorgente** (`mirror`, che nega la yaw e gli
offset delle feature invece di applicare uno `scaleX` in CSS — e che di proposito **non** specchia
`gazeX`, così una faccia voltata a sinistra continua a inseguire il puntatore vero sullo schermo).
`TeamRoster` si limita a decidere **quando** accendere quel loop e **chi** va specchiato.

- **La forma 3 + 2 con la riga sotto centrata** è una griglia a **sei** colonne dove ogni card ne
  occupa due, e la seconda riga parte dalla colonna 2 e dalla 4. Non è "quasi centrata": il centro
  di ciascuna delle due sotto cade **esattamente** sul centro del vuoto fra due delle tre sopra
  (misurato: scarto 0.00px a 1440). Una `repeat(3, 1fr)` con a-capo automatico non lo dà mai,
  perché la seconda riga riparte da sinistra.
  Le due regole di posizione sono scritte come `:nth-child(4):nth-last-child(2)` /
  `:nth-child(5):nth-last-child(1)`: valgono **solo** se gli specialisti sono cinque, quindi un
  sesto `TEAM_SPECIALIST_IDS` fa tornare la lista a tre per riga da sola invece di rompersi in
  silenzio — la stessa promessa che il commento in cima al file fa già.
- **La linea dello specchio è misurata, non dedotta dall'indice.** Un `ResizeObserver` sulla `ul`
  confronta il centro di **ogni card** con il centro della lista: a destra → `mirror`. Si guarda
  la card e non l'avatar perché l'avatar è appoggiato a sinistra dentro la card, e con quello la
  seconda card della riga inferiore cadeva a 32px dal centro, dentro qualunque tolleranza
  ragionevole — cioè veniva letta come "centrale" e restava girata a destra, che è esattamente
  l'errore che si voleva evitare. Col centro della card: la card di mezzo della riga da 3 cade
  **sulla** linea (scarto 0) e resta non specchiata, com'è giusto. E siccome è una misura, regge i
  breakpoint senza una tabella di indici da tenere allineata alla CSS: a due colonne specchia la
  colonna destra, a colonna singola non specchia nessuno (nessuno è "a destra").
- **Il loop gira solo se serve.** Un `IntersectionObserver` tiene `follow="pointer"` solo mentre la
  sezione è in vista — fuori, l'effect dentro `AgentAvatar` si smonta, listener compresi, e lo
  sguardo torna a riposo. Su una pagina pubblica un rAF che gira per nessuno è tempo di CPU che si
  paga in Core Web Vitals. (`AgentAvatar` ha già un IO suo, ma sorveglia il ciclo di `alive`, non
  lo sguardo — e quel file è di un altro lavoro in corso, quindi il cancello sta qui.)
- **Su touch non si segue niente.** `matchMedia('(pointer: fine)')`: senza puntatore fine il loop
  non parte proprio. Non è solo risparmio — `pointermove` **arriva** anche da un dito, quindi
  senza questo cancello un trascinamento lasciava i cinque congelati a fissare il punto dove il
  dito aveva staccato. Restano nella posa composta.
- **`prefers-reduced-motion`** non ha richiesto una riga: la guardia è già dentro `AgentAvatar` e
  l'inseguimento non parte. Verificato che con `reduce` i cinque siano fermi *e* composti.

Provato con Playwright (14 controlli, 1440 e 390, chiaro e scuro): la centratura misurata contro i
vuoti, due fotogrammi con il puntatore ai due lati che mostrano lo sguardo spostarsi, e il
controllo che i destri restino più a sinistra dei sinistri **anche** col puntatore a destra — cioè
che lo specchio non abbia invertito l'inseguimento.

*File: `src/lib/components/TeamRoster.svelte`. `AgentAvatar.svelte` non è stato toccato.*

### Un link con parametri, aperto in sovrapposizione, arrivava senza i suoi parametri

Da quando **tutte** le pagine del brand si aprono in `PageModal` (l'URL non cambia mai, è una
scelta di prodotto), una pagina che leggeva i propri argomenti nel client leggeva l'URL del
**browser** — cioè quello della pagina *sotto*. `openTarget` conservava `url.search` e lo passava
a `preloadData`, quindi il `load` **server** i parametri li vedeva; il client no.

Il difetto era **muto**: nessun errore, la pagina si apriva giusta e ignorava l'argomento. Un link
`/app/<slug>/knowledge?doc=X` mostrava Knowledge senza aprire il documento — la scorciatoia dalle
fonti in chat (`ChatKnowledgePanel`) puntava esattamente lì.

**L'inventario** (`$page.url.searchParams` nel client, incrociato con `BRAND_MODAL_ROUTES` e
`SETTINGS_MODAL_SECTIONS`), sei pagine rotte:

| pagina | parametri | cosa non succedeva |
|---|---|---|
| `knowledge` | `?doc=`, `?section=` | il documento non si apriva |
| `agents` | `?new=`, `?edit=` | l'editor non si apriva (deep link dal computer dell'agente) |
| `plan` | `?row=` | nessuno scroll/evidenza sulla riga |
| `site` | `?from=`, `?n=`, `?job=` | il banner "generati N articoli" non compariva |
| `settings/connected-accounts` | `?error=limit`, `?connected=` | (solo di ritorno da OAuth, che è navigazione vera) |
| `settings/ads/accounts` | `?connected=` | idem |

**La correzione è alla radice, non per pagina.** Il difetto non è di Knowledge: è che la
sovrapposizione promette di ospitare una pagina e le consegna un contesto diverso da quello che
avrebbe avuto navigandoci davvero. Stessa forma già usata per il topbar (`PAGE_META_SINK`): chi
ospita mette in contesto la query vera, chi legge chiede a **un solo posto**.

- `src/lib/page-query.ts` — `setHostedQuery(() => search)` per chi ospita, `pageQuery()` per chi
  legge. Fuori dalla modal cade su `page.url.searchParams` (`$app/state`), quindi il
  comportamento è identico: una pagina **non deve sapere** se è ospitata.
- `PageModal.svelte` dichiara `setHostedQuery(() => routeSearch)` accanto al raccoglitore del
  topbar. Una riga: da lì in poi vale per **tutte** le pagine ospitate, comprese quelle che
  nessuno ha ancora provato.
- Le sei pagine sopra passano a `const q = pageQuery()` — conversione meccanica, nessun giudizio.

**Scartata: far cambiare alla modal la query dell'URL senza cambiare il percorso**
(`history.replaceState` su `?doc=…` tenendo `/app/<slug>`). Funzionerebbe, e con zero modifiche
alle pagine. Ma incolla lo stato dell'overlay su un URL il cui percorso indica un'**altra** pagina:
un refresh, un back o un link copiato riaprono la pagina sotto con parametri che non sono i suoi —
e la home del brand con `?doc=` è una bugia. Rompe anche l'invariante provata da
`settings-modal-check.mjs` ("URL identico byte a byte"), che è il modo in cui la regola "niente
percorsi veri" resta vera invece di essere una promessa. Il contesto costa sei righe in più e non
mente.

**Prova**: `scripts/modal-query-check.mjs`, browser vero, sulla fixture `native-spine-test`.
Prova gli stessi due link **dentro e fuori** dalla modal (`knowledge?doc=<id>`, `site?from=plan&n=7`),
più il controllo negativo (senza parametro non si apre niente) e l'URL fermo. Verificato che ha i
denti: neutralizzando `pageQuery()` diventa rosso solo sui due casi in modal, e resta verde fuori.
`knowledge/+page.svelte` espone ora `data-doc-id` sulla riga del documento, che è ciò che permette
allo script di costruire il link senza indovinare.

### Via il comando "apri a pagina intera" dalla testata delle sovrapposizioni

Nessuna pagina è una destinazione: offrire di andarci contraddiceva la scelta appena presa. Tolto
il bottone `Maximize2` dalla testata (settings **e** pagine del brand: è lo stesso componente) e il
tooltip omonimo sulle voci del rail che restano pagina piena — lì la freccia `ArrowUpRight` lo
dichiara già. Nessuno stato "espanso" resta dietro: il bottone era un `<a>` puro, non c'era né
`$state` né scorciatoia da tastiera collegata. `isWide()` e `data-settings-full` **restano**: sono
un'altra cosa (la taglia del dialogo, e "questa rotta non è ospitabile → naviga davvero").

`app.settings.modalExpand` **non** diventa orfana: la usa ancora l'unica via d'uscita da un carico
fallito (`{:else if loadError}`). Toglierla da lì lascerebbe un vicolo cieco — un messaggio d'errore
senza nessun modo di vedere comunque la pagina.

### 503 chiavi, non 16: spagnolo e francese erano fermi a mesi fa

Un altro agente aveva segnalato **16 chiavi `app.shell`** mancanti in `es.json` e `fr.json`. Il
confronto completo fra i quattro cataloghi (`src/lib/i18n/locales/`, più i sotto-cataloghi `docs/`
e `tools/`) ne ha trovate **503**, identiche nelle due lingue — segno che i due file sono stati
forkati nello stesso momento e non hanno mai più recuperato. `it.json` era allineato.

Non erano stringhe di contorno: `app.media.*` (110 chiavi: tutta la libreria media e il generatore),
`chat.*` (100: modalità, allegati, slash command, etichette dei job), `app.shell.agentProposal.*` e
`app.shell.openTab*` — cioè **i momenti in cui l'agente chiede il permesso all'utente**. Un utente
spagnolo che si sentiva chiedere di collegare un'app se lo sentiva chiedere in inglese, senza
nessun errore da nessuna parte: `en` è il `fallbackLocale` (vedi `i18n/index.ts`), quindi il buco
è silenzioso per costruzione.

**Il difetto opposto è peggiore, e c'era.** Sei chiavi esistevano **solo** in `it.json` — e il
codice le usava: `gtm.tl.start`, `gtm.tl.nowMarker`, `gtm.weightsLabel` (`gtm/+page.svelte`),
`weekPlan.unplanned.title`, `weekPlan.past.title`, `weekPlan.past.body` (`plan/+page.svelte`).
Senza fallback non c'è fallback: inglese, spagnolo e francese stampavano **la chiave puntata** in
pagina. Aggiunte in tutte e tre.

Stessa classe di difetto, altra porta: `pain.postingSchedule.proof.s2` aveva `desc` in `en`/`es`/`fr`
e `label` in `it`. Le pagine `pain.*` compongono la chiave a runtime — ``$_(`${tk}.proof.s${i}.label`)``
— quindi era `it` ad avere ragione e le altre tre a stampare la chiave grezza su una pagina pubblica.
Rinominata `desc` → `label` nelle tre.

**Le traduzioni sono scritte, non passate a macchina.** Ogni blocco è stato reso guardando le chiavi
vicine nello stesso file: registro **tú** per lo spagnolo e **vous** per il francese (quelli già in
uso), i sostantivi ricorrenti ripresi da come quel file li chiama già (`rejilla` e non `cuadrícula`,
`Mo` e non `MB`, `Series`/`Rubriques` presi da `app.hub.brand.rubrics` e non dall'inglese), prezzi e
percentuali nel formato della lingua (`1.500 €` in ES, `1 500 €` e `64 %` in FR). I segnaposto e i
blocchi ICU plurale sono stati verificati uno per uno da uno script: 1006 valori, zero differenze
di segnaposto rispetto all'inglese.

### Il test che rende impossibile rifarlo

`src/lib/i18n/locales.test.ts`. Confronta gli **insiemi di chiavi appiattite** di ogni lingua con
l'inglese, per tutti e tre i cataloghi (principale, `docs/`, `tools/`), e fallisce in entrambe le
direzioni: chiavi che cadrebbero sul fallback inglese, e chiavi che l'inglese non ha (quelle che
stampano la chiave grezza ovunque). Il messaggio d'errore **elenca le chiavi**, non conta soltanto:
chi lo vedrà rosso fra sei mesi sa cosa aggiungere e dove.

Perché *appiattite*: un confronto sul solo primo livello sarebbe passato verde per tutta la deriva —
`app`, `chat` e `landing` c'erano in tutti e quattro i file dal primo giorno. Il test esisteva già
in forma parziale (`wall.i18n.test.ts` copre la tassonomia dei tag del wall in tutte le lingue): è
il modello, esteso a tutto il catalogo invece che a una sezione.

Due chiavi restano fuori, in una allowlist con il commento che dice perché: `weekPlan.planDocEdit`
(solo `it`) e `app.motionVideo.emptyHint` (solo `es`/`fr`), residui di rinomine che nessun file in
`src/` legge. Cancellarle appartiene a chi possiede quelle schermate, non a questo passaggio.

### La colonna di sinistra, guardata bene: lo stato attivo che non diceva niente, e i binari storti

Richiesta del proprietario, in due tempi. Prima: *"metti un box alle icone delle voci statiche,
come il box dell'icona del brand in basso"*. Fatto e **scartato** dopo averlo visto sul dev server —
sei quadrati in fila trasformavano la colonna in una parete di riquadri, l'occhio non atterrava più
da nessuna parte e la voce selezionata (che era l'unica cosa che quella colonna deve dire) si
perdeva in mezzo agli altri cinque. Nella stessa prova era stata spostata la barra di ricerca in
cima a tutto, sopra "Assumi un agente": anche quella annullata, la ricerca torna dov'era, sopra la
lista delle conversazioni. Restava la domanda vera — *"si può fare più carina?"* — e la risposta
sta qui sotto, in tre cose misurate nel browser, non ipotizzate.

**Lo stato attivo non diceva niente, e in chiaro non passava nemmeno AA.** La riga selezionata era
solo l'etichetta dipinta di `--accent` (#c485fe): nessun fondo, perché la base di
`Sidebar.MenuButton` forza `data-[active=true]:bg-transparent` e `navItem` glielo ripeteva pure
esplicitamente. Quel viola su carta sta a **2,58:1** — è `app.css` stesso a documentarlo, tre righe
sopra la definizione di `--accent-ink`, che esiste esattamente per questo caso e non veniva usata.
E con la sidebar stretta l'unico segnale rimasto era un'icona appena più chiara delle altre: "sei
qui" non si leggeva affatto. Ora la riga attiva ha una pastiglia in **velo d'accento**
(`--nav-on` / `--nav-on-hover`, definiti su `[data-slot='sidebar-content']`) e l'etichetta in
`--accent-ink` (5,3:1 in chiaro, 10,5:1 in scuro — la mistura parte da `--ink`, quindi segue il
tema da sola). Fondo d'accento e non grigio di proposito: un fondo grigio è quello che si usa per
l'hover, e se attivo e hover si somigliano il selezionato smette di dire qualcosa. Collassata, la
pastiglia diventa il quadrato attorno all'icona — cioè il riquadro chiesto all'inizio, ma su **una**
riga, quella che se lo merita.

Le classi stanno su `navOnClass`, cioè come **utility sulla riga**, non come regola nel blocco
`<style>`: `styles/tailwind.css` importa Tailwind con `important`, e per le dichiarazioni
`!important` l'ordine dei layer si inverte — un CSS di componente avrebbe perso contro
`data-[active=true]:bg-transparent` della base, che è esattamente l'incidente già capitato alla
lista dei thread e documentato su `threadRowClass`. Verificato nel browser, non sulla fiducia.

**Quattro binari verticali dove doveva essercene uno.** Misurato con Playwright sulla colonna vera
(240px, padding 10): icone di nav a `x=18`, avatar dei thread a 18, avatar del brand a 18, e
**l'icona della ricerca a 21** — 2px di margine più 9 di imbottitura più un'icona da 14 invece di 16.
Tre pixel, sotto un elenco di icone allineate. Ora la barra di ricerca ha margini e imbottitura
scelti per cadere sui binari delle voci (icona 18, testo 42), e l'icona è `size-4` come le altre.
Sul telefono lo stesso scarto valeva 2px al contrario: le righe dei thread e la riga del brand
usavano `px-2` dove la nav usa `px-2.5` — ora tutto parte da 30.

**Il binario destro lo occupava una freccia.** `Brand` porta un `ArrowUpRight` (va ai settings, non
a una pagina del workbench) e stava in coda alla riga: il badge `60%` finiva quindi 24px più dentro
dei conteggi tondi delle altre righe, che è il badge disallineato già segnalato dal proprietario.
La freccia è stata spostata **accanto all'etichetta**; il badge riprende `ml-auto` e tutti e tre i
trailing chiudono a `right=222`. Scartato: togliere la freccia (segnala una destinazione diversa —
i settings — e non è rumore), e cambiare forma alle pillole (il problema era la posizione, non la
forma).

**Un separatore invece di due.** In 240px c'erano due filetti più il bordo del footer. Quello fra
la nav e le conversazioni, con la sidebar stretta, disegnava un tratto **sopra il nulla**: la lista
dei thread collassata non viene resa affatto. Sostituito da spazio (`mt-4` contro gli 8px fra le
voci). Resta il filetto sotto "Assumi un agente", l'unico che recinta qualcosa — l'azione
principale della colonna.

**Visto e non toccato**, perché fuori richiesta o troppo invasivo per un ritocco: con la sidebar
stretta i badge spariscono del tutto (`group-data-[collapsible=icon]:hidden`), quindi "7 post da
approvare" diventa invisibile proprio quando la colonna serve da cruscotto; gli avatar dei thread
(34px in chiaro, neri pieni) pesano più di qualunque altra cosa nella colonna e l'occhio atterra
lì prima che sulla nav; e i grigi secondari (`--ink-faint` #86868b) sono neutri puri mentre il
fondo della sidebar ha un soffio di viola — sistemarli è un lavoro sui token globali, non su questo
file.

Provato sul dev server con Playwright: espansa e collassata, chiaro e scuro, 1440 e 390, con una
voce selezionata e due con badge. Le geometrie sopra sono lette da `getBoundingClientRect`, non
stimate a occhio.

### Le fonti knowledge si leggono in chat, non altrove

Cliccare una fonte `knowledge` sotto una risposta faceva `goto('/app/<slug>/knowledge?doc=…&section=…')`:
la conversazione spariva per leggere due paragrafi, e per tornarci serviva il tasto indietro. Era
rimasta **l'ultima** strada che portava fuori dalla chat — tre righe più sopra, nello stesso
`ChatSources.svelte`, le fonti `brand` già chiamavano `openPageModal` e non navigavano.

Ora c'è `src/lib/components/ChatKnowledgePanel.svelte`: un pannello a destra, sopra la pagina viva,
con la stessa regola di `PageModal` — **l'URL non cambia mai**, è puro stato del client.

**Riuso, non un drawer nuovo.** Il pannello è uno `Sheet` (bits-ui / shadcn) `side="right"`, la
primitiva già usata nello stesso file per la variante mobile dell'elenco fonti: Esc, click fuori,
focus trap e portale su `body` arrivano da lì invece di essere riscritti. Il contenuto viene
dall'endpoint che esisteva già, `GET /app/<brand>/knowledge/<id>` — lo stesso che usa `openDoc`
sulla pagina Knowledge — quindi niente rotta nuova e niente markdown nel payload della lista.

**Lo z-index è quello che c'era, non uno nuovo.** Lo `Sheet` porta `z-50` di Tailwind; la topbar
(`PageTopBar`) è a 30. Misurato nel browser con `elementFromPoint` sopra la barra: il punto colpito
è dentro il pannello. Nessun numero aggiunto — l'alternativa scartata era copiare il 150 di
`PageModal`, che sarebbe stato un valore inventato per un problema che non c'era.

**Il salto alla sezione va rimandato di un frame.** `headingPath` è `"A > B > C"` (lo scrive il
chunker in `knowledge.ts`): si cerca l'ultimo segmento fra gli heading resi, si evidenzia e ci si
scorre sopra. Con l'`$effect` che leggeva il DOM subito, `querySelectorAll` trovava **zero**
heading: quando `html` cambia, l'effetto scatta prima che `{@html}` abbia committato i nodi, e la
sezione non veniva evidenziata mai. Un `requestAnimationFrame` risolve, e il difetto è stato visto
solo guardando — le asserzioni sull'apertura passavano già tutte.

**Le fonti `memory` passano dalla stessa cura, per un'altra porta.** Un ricordo non ha markdown da
mostrare: nel pannello ci sarebbe stato un guscio vuoto. Facevano anche loro un `goto` secco sulla
pagina Knowledge; ora chiamano `openPageModal` come le fonti `brand`, che ospita la pagina Knowledge
vera in overlay senza cambiare URL, e navigano solo se la modal dice di no (mobile). Zero codice
nuovo per rimuovere lo stesso difetto.

**Cercato e non trovato:** link markdown verso `/app/<slug>/knowledge?doc=…` generati dal modello.
Non ne esistono — `?doc=` compare solo in `ChatSources.svelte` e nella `+page.svelte` di Knowledge
che lo legge. Non c'è niente da intercettare.

Il pannello è per **leggere**: l'editor markdown, i chunk e la gestione delle fonti restano sulla
pagina Knowledge, raggiungibile dal link "Apri in Knowledge" in testata (che è anche la via d'uscita
per chi vuole modificare). Stringhe sotto `chat.docPanel.*` in tutte e quattro le lingue.

`scripts/chat-knowledge-panel-check.mjs` semina il documento e il messaggio sul brand fixture e
guida un browser vero: pannello aperto, URL fermo, hit-test sopra la topbar, sezione evidenziata,
Esc e click fuori — in chiaro e scuro, a 1440 e a 390.

### Foto e video in chat, senza che debbano essere post

Reso muto `read_posts` restava scoperto il gesto opposto: far vedere un media **perché lo si
vuole far vedere**, quando quel media non è un post e non lo diventerà — un fotogramma tirato
fuori da una clip per discuterne, tre varianti fra cui scegliere, un video appena generato da
valutare. L'unica strada era `![alt](url)` nel markdown: una immagine sola, tagliata a 220px,
nessun video, nessuna griglia, nessun ingrandimento.

Ora c'è `show_media`: fino a 8 elementi per chiamata, foto e video **insieme**, una didascalia
facoltativa ciascuno. Uno solo esce grande, due o più in griglia (quattro esatti vanno 2×2, non
tre più un orfano), i video con i **controlli** e senza autoplay, click per ingrandire.

- **Nessuna macchina nuova.** Il payload viaggia come `preview`/`ideas`/`team`: normalizzatore
  client-safe in `src/lib/chat-media.ts`, `part.media` scritto da `assistantContentFromSteps`,
  e le due surface (ChatColumn e la chat a pagina piena) lo pescano per tool call. Lo zoom è
  `ChatImageLightbox`, che sapeva già fare video con i controlli e la navigazione fra slide.
- **Non è un artefatto, e si è guardato prima di scrivere.** Un artefatto è un file che l'agente
  CARICA (byte, riga nel database, download), e non ha `kind: 'video'`. Qui i byte sono già nel
  nostro storage: rifarne una copia per mostrarli sarebbe stato un archivio in più per ogni
  fotogramma guardato.
- **Da dove viene l'URL, che è la parte che conta.** Un agente che ha appena letto una pagina web
  ha in mano stringhe che non ha scelto lui: incorporarle significa far caricare al browser
  dell'utente una risorsa scelta da terzi — un pixel di tracciamento con IP e referrer, nel caso
  benigno. Si accetta SOLO il nostro storage (host del progetto Supabase +
  `/storage/v1/object/...`, pubblico o firmato), e il rifiuto dice all'agente cosa fare invece:
  `publish_artifact`. SVG, HTML e PDF non passano nemmeno da noi — stessa ragione per cui
  `inferArtifactKind` degrada SVG e HTML a `code`.
- **Chiusa la porta di servizio che restava aperta.** `renderMd` incorporava QUALUNQUE URL in un
  `<img>`: la stessa falla, per un percorso diverso. Ora un'immagine markdown si incorpora solo se
  è nostra, altrimenti resta un link — visibile, cliccabile, non caricato. Ed è anche la risposta
  a "due modi equivalenti per la stessa cosa": il markdown è il ripiego, `show_media` la strada.
- **I prompt, tutti e tre** (`agents.ts`, `system-prompt.ts`, il brief di onboarding): tre strade
  che non si confondono — `read_posts show_to_user` per i post da guardare, le anteprime
  automatiche su ciò che si crea, `show_media` per tutto il resto.

### Una pagina d'errore che è del prodotto, non del framework

Non esisteva **nessun** `+error.svelte` nel repo: ogni 404 — e ogni 500, ogni 403 — mostrava la
schermata di default di SvelteKit, fondo bianco e "404 Not Found" in nero. Su un prodotto che si
presenta come "il tuo reparto marketing, già assunto", era la schermata che diceva il contrario.

Ora c'è `src/routes/+error.svelte`, e **uno solo**. La tentazione era aggiungerne un secondo sotto
`src/routes/app/` per rendere l'errore dentro la shell (topbar + sidebar) invece che a pagina
intera: scartata per due motivi verificati nel runtime, non ipotizzati.

1. Per una URL che non matcha nessuna rotta, `respond_with_error` (in `@sveltejs/kit`) costruisce
   un branch di **due nodi**: `nodes[0]` = layout radice, `nodes[1]` = error radice. Un
   `app/+error.svelte` non verrebbe quindi *mai* montato per un 404 — il file esisterebbe e non
   servirebbe a niente.
2. L'errore più comune dentro l'app è il `404 'Brand not found'` di
   `app/[brand]/+layout.server.ts`: nasce **nel layout stesso** che disegna topbar e sidebar, quindi
   la sua boundary è comunque il livello sopra. Renderlo dentro una shell che non ha caricato niente
   sarebbe peggio di una pagina intera.

**La destinazione dipende dalla sessione, non dall'URL.** `$page.data.session` arriva dal
`+layout.server.ts` radice — e *arriva davvero* anche in stato d'errore, perché `respond_with_error`
esegue `load_server_data` + `load_data` sul nodo 0 prima di renderizzare l'error. È il punto che
andava verificato e non assunto: se il dato non ci fosse, il bottone avrebbe promesso `/app` a un
visitatore anonimo per poi sbatterlo sul login. Il fallback è `/` (localizzato via `localePath`:
un 404 su `/it/...` torna su `/it`), e la sessione porta a `/app`, che poi smista da solo verso il
brand giusto o l'onboarding.

Un solo bottone, non due: chi si è perso dentro l'app vuole tornare nell'app, un visitatore vuole la
home pubblica, e far scegliere significa non aver deciso. Il secondo bottone ("Riprova") compare
solo sopra il 500, dove ricaricare è davvero un'azione sensata.

**Il testo cambia con lo stato**: 404 → "non c'è", 401/403 → "non è tua", tutto il resto → "si è
rotto da parte nostra". `$page.error.message` non viene mostrato **mai**: è testo interno, e su un
500 in produzione è esattamente ciò che non deve finire sotto gli occhi di un visitatore. Le stringhe
sono nei cataloghi di tutte e quattro le lingue (`en`, `it`, `es`, `fr` — non due), sotto `error.*`.

**L'aspetto** non inventa un linguaggio nuovo: token di `app.css` (`--paper-2`, `--line`, `--serif`,
`--heading-weight`), le classi `.btn`/`.btn-primary` già globali, e l'`AgentAvatar` — l'elemento di
casa più riconoscibile — a 72px con `follow="pointer"`, faccia `curious` sul 404, `squint` sul 403,
`sad` sul 500. Niente guard aggiuntivo per `prefers-reduced-motion`: l'avatar lo gestisce già
internamente (l'inseguimento dello sguardo non parte proprio). Le classi sono prefissate `err-`
perché `app.css` definisce `.card` e `.body` come classi **globali** — la prima versione ereditava
per sbaglio bordo, ombra e un `:hover` che alzava la card di 4px.

**Provato sul dev server vivo**, non solo compilato: 404 anonimo → bottone `/` → atterra su `/`;
404 autenticato su `/app/<brand-inesistente>` (che è il vero `Brand not found`) → bottone `/app` →
atterra su `/app/onboarding`. Chiaro e scuro, 1440px e 390px, nessuno scroll orizzontale.


### Il mockup della homepage: chiedere la chiave, e finire il lavoro

Richiesta del proprietario: *"nella homepage manca un usecase in cui l'ai chiede di connettere
instagram, e un'altra in cui chiede di connettere google drive. Idem una chat di gruppo"* — nel
mockup, non nel prodotto.

**Cosa c'era prima.** `HomeChatMockup.svelte` mostrava cinque thread, cinque mestieri, e un
commento in testa che diceva *"Niente chat di gruppo: il roster c'è ma è spento (GROUP_CHATS
vuoto), quindi non si mostra"*. Le stanze intanto sono state finite (`chat/room.ts`), e le due cose
che il prodotto fa quando gli manca un pezzo — chiedere un canale, chiedere dei documenti — non si
vedevano da nessuna parte: chi guarda la homepage vedeva solo agenti che hanno già tutto.

**Tre casi nuovi, otto in totale.** In ordine di sidebar: `content`, `room`, `connect`, `drive`,
`motion`, `web`, `analyst`, `ugc`.

- **`connect` (Instagram).** Il canale. Ci sono le bozze, manca il posto dove pubblicarle e i
  numeri da leggere. La battuta centrale è la riga `propose_open_tab` — quella vera di
  `ChatColumn.svelte`: evento di sistema, centrato, motivo sopra e azione in accent sotto — verso
  Impostazioni › Account collegati. **I social non passano da Composio**: si autorizzano lì, ed è
  per questo che questo caso NON usa la card di connessione dell'altro. Poi l'agente riprende da
  solo: reel in coda, ultimi 30 giorni scaricati.
- **`drive` (Google Drive).** La conoscenza. La battuta centrale è la card vera di
  `ChatConnectCard.svelte` (`propose_app_connection` → Composio → `brand_documents`): logo, nome,
  pillola ghost, motivo rientrato di 26px sotto. Il logo è `siGoogledrive` da `simple-icons`, già
  in dipendenza e già usata così in `settings/platforms.ts` — nessun asset nuovo. L'agente chiede
  per **sapere**, non per fare: l'alternativa a leggere le schede prodotto è inventarsele.
- **`room` (chat di gruppo).** Tre mestieri, una richiesta: l'Analyst dà il vincolo dai numeri, il
  Motion Specialist lo prende e costruisce, il Content Creator scrive la caption sulla domanda
  dopo. Due voci sul primo messaggio (`ROOM_MAX_SPEAKERS = 2`), una sul secondo, sequenziali. Nel
  thread **non c'è nessuna riga "è rimasto zitto"**: `room.ts` è esplicito sul fatto che il
  silenzio non lascia messaggi, e un mockup che la mostrasse mentirebbe. In sidebar e in
  intestazione la stanza è `AgentAvatarStack layout="cluster"` — il componente che già esiste — e
  il nome è l'elenco dei membri, come fa `threadIdentity`.

**Le misure che sono cambiate, e perché.**

- Riquadro **560 → 640px**. Restava fisso e uguale per tutti i casi (era quello il punto), ma con
  otto righe la sola lista chiede ~390px: a 560 sarebbe stata la *sidebar* a dover scorrere, cioè
  tre casi su otto nascosti sotto la piega. A 640 la sidebar sta intera e a scorrere resta solo la
  conversazione, come prima. Verificato: su desktop, in quattro lingue, nessuno degli otto thread
  ha bisogno di scorrere.
- Avatar di riga **30 → 34px**, come `DashboardSidebar.svelte`. Non è un gusto: nel cluster una
  faccia prende il 47% del lato, quindi solo da 34 in su le tre facce restano da 16px — la misura
  sotto la quale l'arco della bocca sparisce (il commento in `AgentAvatarStack.svelte` lo dice).
  Costa 8px in tutta la colonna, perché l'altezza di riga era già dettata dalle due righe di testo.
- Su schermo stretto il nome della stanza (tre nomi in fila) mandava a capo l'intestazione e
  allargava la pillola fino a mangiare tutta la riga scorrevole: tetto a 20ch sulla pillola e
  troncamento su una riga sola nell'intestazione.
- `TIMES` (array parallelo indicizzato per posizione) è diventato un campo `time` sul caso: con
  otto voci da riordinare era una bomba a orologeria.

**Testo.** Tutte le battute nuove in `landing.chat.cases.{room,connect,drive}` nelle **quattro**
lingue (en, it, es, fr), scritte una per una. Le due etichette d'azione delle card stanno in
`landing.chat.openSettings` / `landing.chat.connectDrive` e non nelle chiavi vere di `app.shell`:
`openTabCta` e `openTabOpened` **non esistono in es e fr** (16 chiavi di `app.shell` mancano in
entrambi), quindi riusarle avrebbe messo inglese sulla homepage spagnola e francese.

### Si sceglie un mestiere, non il generalista: Anomalia esce dalle scelte

Decisione di prodotto del proprietario, in due frasi: *"ha senso togliere 'anomalia' come agent, e
lasciare gli altri, e all'inizio, nell'onboarding, l'utente vede diverse pagine di presentazione,
per poi andare in una pagina in cui sceglie da che agent partire"* e *"idem anche gli agenti non
devono più poter comunicare con l'agent anomalia"*.

**Il problema misurato.** In produzione **128 thread su 169 (76%) hanno `agent = null`**, cioè
Anomalia — e 108 di quelli hanno messaggi dentro. Non perché qualcuno l'avesse scelta: era il
default del composer (`DEFAULT_AGENT_ID = 'auto'`), il valore del campo "A", e l'agente del thread
di setup dell'onboarding. La squadra di cinque specialisti esisteva da settimane e la stragrande
maggioranza degli utenti non ne incontrava mai uno: atterrava sul generalista e ci restava.

**Anomalia = coordinatore invisibile.** Non sparisce dal sistema, sparisce dalle *scelte offerte*:

- **fuori** dal picker del composer, dal campo "A", dalla card della squadra (`show_team`), dalla
  palette dei comandi, dalla sezione squadra della homepage e dal picker "chi esegue" delle routine;
- **resta** l'identità dei thread che ce l'hanno già (`normalizeAgentId(null) → 'auto'` invariato —
  cambiarlo avrebbe dirottato 128 conversazioni aperte su uno specialista, con altri tool e un
  altro prompt, senza dirlo a nessuno), il ripiego di `resolveAgent`, e la voce che lo smistatore di
  una stanza può ancora scegliere quando la richiesta non è di nessun mestiere (`ROOM_GENERALIST`
  in `room.ts` non è stato toccato: cambia la selezionabilità lato utente, non la capacità tecnica).

Il seam è `agentMetaForBrand(webHubEnabled, current)`: la lista la esclude sempre, tranne quando è
*già lei* l'agente selezionato — altrimenti riaprire una conversazione vecchia mostrerebbe un picker
senza selezione. Due default distinti al posto di uno: `DEFAULT_AGENT_ID` ('auto') è l'identità di
ciò che esiste, `NEW_CHAT_AGENT_ID` ('content') è con chi parte una conversazione nuova.

**L'onboarding: tre schermate e una scelta.** Il wizard non atterra più muto nella chat di setup.
Appena il brand esiste arrivano tre schermate a concetto singolo — la squadra di cinque mestieri, il
lavoro che arriva finito (non consigli), le routine che vanno avanti da sole e la regola che niente
si pubblica senza il sì — e poi *"Da chi parti"*: un agente grande alla volta con nome, descrizione
e i puntini del carosello, "Inizia la chat" e l'azione secondaria "Creane uno mio". La scelta apre
una chat nuova con quell'agente via `/chat/new?agent=`, che non crea nessuna riga: il thread nasce
al primo messaggio, come ogni altra chat del prodotto.

Il thread di setup resta com'era, con `agent = null`: il suo brief chiede `run_seo_geo_audit`,
`produce_week`, `propose_app_connection` e `show_team` insieme — nessuno dei cinque mestieri ha
quel set, e `pickTools` lo taglierebbe. È il caso letterale per cui il coordinatore esiste.

La scelta viene ricordata (`localStorage`, `anomalia:first-agent:<slug>`) e diventa il destinatario
di default del campo "A" per quel brand: chiedere una scelta e ignorarla al primo composer sarebbe
peggio che non chiederla. Nessuna migration — una preferenza di partenza per un composer non vale
una colonna.

**I DM fra agenti.** `message_agent` rifiutava già `auto` (non è in `AGENT_IDS`), ma con *"Unknown
agent"*, che invita a riprovare con un'altra grafia invece di cambiare strada. Ora il rifiuto è
esplicito e dice cosa fare: mandarlo allo specialista competente, o farlo da sé.

**I cron.** Verificati: `JOB_OWNERS` non ha nessun lavoro su `auto` (content/analyst/web coprono
tutti e nove), e in produzione non esiste nessuna riga `custom_agent_schedules` con proprietario
`team:auto`. Il test del roster ora lo impedisce anche in futuro: `auto` è uscito dalla lista di
proprietari ammessi.

**Il difetto trovato strada facendo.** Segnalato dal proprietario: scegliendo Motion nel campo "A"
il thread nasceva comunque Content. Non era il campo — era un ordine di effetti. L'effetto che
ripristina i destinatari al rimontaggio girava per primo e metteva l'agente giusto; subito dopo il
ramo "nessun thread" lo riscriveva con la costante. I chip dicevano Motion, `createThread` riceveva
Content, e nessuno dei due schermi mentiva abbastanza da far sospettare l'altro. La correzione non è
un riordino di dichiarazioni (regge finché nessuno aggiunge un `$effect`): la regola
"destinatari → agente del thread" è uscita da `ChatColumn` in `$lib/chat-recipients.ts`, pura e
provata, e la usano entrambi i rami.

**Provato nel browser, sul dev server vivo**: onboarding "non ho un sito" → tre schermate →
carosello fino a Motion → "Inizia la chat" → Panoramica col campo "A" su Motion, zero errori JS; e
sulla Panoramica, destinatario singolo Motion → `POST /chat/threads {"agent":"motion"}`.

### Nella stanza risponde chi c'entra, uno alla volta, e si vede chi sta scrivendo

Segnalazione del proprietario: *"nelle chat di gruppo continua a rispondere sempre e solo il primo
agent scelto, mai gli altri"*. Il sintomo era reale e la causa erano due cose che si sommavano,
entrambe nello smistatore (`pickRoomSpeakers` / `roomBeat`, `chat/room.ts`).

**1. Il router non vedeva la conversazione.** `roomBeat` accettava un parametro `recent` fin dal
primo giorno, ma `chat/+server.ts` non gliel'ha mai passato: lo smistatore riceveva solo l'ultimo
messaggio dell'utente. Su una richiesta esplicita ("fammi un reel") funzionava; su un messaggio
corto — "sì, fallo", "no, più corto", "e i numeri?" — non c'è nessun mestiere da riconoscere, e la
decisione cadeva sul ripiego. Che era il primo membro. Cioè: appena la conversazione entrava nel
vivo, rispondeva sempre lo stesso.

Ora `roomBeat` carica da sé le ultime 6 battute (`roomRecentLines`) in righe `Nome: testo`, con la
firma `chat_messages.name` risolta al nome del membro — `motion` da solo non direbbe niente al
router, "Motion Specialist" sì. Sei righe, 200 caratteri l'una: serve il filo del discorso, non la
storia. La query sta dentro `roomBeat` e non in `+server.ts` perché lì la history si carica molto
più in basso, dopo il system prompt, e allo smistatore serve prima — spostarla avrebbe voluto dire
rimaneggiare l'ordine di tutto il POST per due righe di contesto.

**2. Il prompt del router diceva di scegliere il primo.** C'era scritto, letteralmente: *"Se il
messaggio è generico, saluta o chiede alla stanza in generale, scegli il primo della lista (è il
padrone di casa)"*. Con il router cieco sul contesto, "generico" era quasi ogni follow-up. Ora la
regola dominante è leggere le ultime battute e parlare se il messaggio risponde a *te*; l'ordine
della lista è dichiarato esplicitamente **non** una preferenza (è solo l'ordine con cui l'utente ha
composto la stanza), e il primo membro è l'ultimissimo ripiego, dopo il generalista.

Verificato sul modello vero (Luna fast, lo stesso di produzione), stanza Anomalia + Content +
Motion + Analyst: "ciao a tutti" → Anomalia, "fammi un reel" → Motion, "come sta andando l'ultimo
post?" → Analyst, "scrivi la caption" → Content, "sì, fallo" dopo una proposta di Motion → Motion,
"e questi numeri reggono?" dopo Motion → Analyst, "no, più corto" dopo Content → Content, "fammi il
reel e dimmi se regge sui numeri" → Motion + Analyst. Quattro voci diverse, e i follow-up corti che
restano su chi aveva la palla: prima erano otto volte il primo membro.

### L'agente sa di stare in una stanza, e con chi

`roomSystemBlock` esisteva ed era già montato (turno interattivo in `chat/+server.ts`, seconda voce
come `brief` del job accodato) — ma diceva quattro cose su sei. Mancavano le due che si vedono da
fuori quando non ci sono: che si scrive **uno alla volta e tutti leggono tutto**, e che **tacere o
rispondere corto è legittimo** quando il messaggio non è per te. Aggiunte a entrambe le lingue,
insieme al motivo del passaggio di mano ("farglielo male al posto suo costa all'utente più del
passaggio di mano"), che è ciò che trasforma una regola in una scelta.

Due cose che il blocco continua a NON fare, e sono scritte nel commento perché è lì che si
rompono:
- **Non è un secondo instradatore.** Chi parla lo decide `pickRoomSpeakers`, una volta, prima del
  turno. Se un membro potesse convocarne un altro, due specialisti si rimbalzerebbero la palla a
  spese dell'utente, e nessun tetto scritto in un prompt reggerebbe.
- **Non ha una lista di membri sua.** Nomi e aree escono da `RoomMember` (`roomRoster`), la stessa
  fonte del router e delle firme di `roomRecentLines`: un elenco duplicato è un elenco che diverge.
  Un custom agent compare quindi col nome che l'utente gli ha dato, non col mestiere sottostante.

Costa: entra in ogni turno di ogni stanza. Per questo l'area di un membro resta una riga (per i
custom agent, la prima riga del brief tagliata a 160 caratteri) e non il brief intero.

Provato sul modello vero: a *"fammi il reel del lancio, e dimmi anche quanto ha reso l'ultimo
carosello"*, Motion risponde *"Il rendimento dell'ultimo carosello è competenza dell'Analyst: gli
lascio il dato da recuperare separatamente"* invece di improvvisare numeri. A "ciao, tutto bene?"
risponde con una riga.

### Le due voci non si sovrappongono — e non è servito un lock nuovo

Verificato prima di scrivere qualsiasi cosa: la seconda voce si accoda dentro `onFinish`, **dopo**
`saveMessages` e **prima** dell'update `status: 'done'`. In quella finestra il job della prima voce
è ancora `running`, e `processNextQueuedChatJob` salta ogni thread che ha un `chat_response`
pending/running (`threadHasActiveChatResponse` → `if (busy) continue`). Il `kick` del drenaggio
parte solo dopo la chiusura. La serializzazione è quindi una proprietà dell'**ordine di tre
scritture**, non di un meccanismo: invertire le ultime due farebbe partire la seconda voce sopra la
prima, e non se ne accorgerebbe nessuno finché un utente non vede due agenti scrivere insieme.

Nessun codice aggiunto: due test che bloccano quell'ordine nel sorgente e il `continue` sul thread
occupato. È il tipo di invariante che si perde in un merge, non in un refactor.

### L'avatar del caricamento è chi sta scrivendo adesso

La riga di progresso vestiva l'identità del **thread**. In una stanza il thread non ne ha una:
mostrava il volto del primo membro anche mentre rispondeva il terzo. Ora la firma della voce
viaggia con il turno e la riga viva se la mette addosso.

- **Prima voce → header `X-Chat-Speaker`.** Non un evento nello stream: la riga di caricamento
  compare *prima* del primo token (un modello che ragiona pensa anche 30s), quindi l'identità deve
  essere già arrivata quando l'avatar si accende. Altrimenti si vedrebbe il volto sbagliato e poi
  un salto a metà turno. `X-Chat-Job-Id` viaggiava già così: stesso canale, zero meccanica nuova.
- **Seconda voce e riprese → `speaker` dal job.** Esposto (da solo, non tutto `input_params`) su
  `?job_id=`, `?active_job=1` e sull'`activeJob` del load: anche un ricaricamento a metà seconda
  voce dipinge il volto giusto al primo paint.
- **`roomMemberAvatar`** in `thread-identity.ts`, gemello di `roomMemberName`: lista risolta dal
  server → avatar fisso dello specialista → neutro. Mai un volto rotto, mai un buco durante un
  turno. Serve anche alle bolle già salvate, che ora portano il volto della loro battuta.
- Il cambio **morfa** senza codice nuovo: è la stessa istanza di `AgentAvatar` a cambiare props,
  quindi i tratti si interpolano e il colore sfuma nei suoi 420ms.

**Scartato: tenere l'istanza dell'avatar viva fra le due voci.** Fra la prima e la seconda atterra
la bolla salvata del primo turno (`finalizeCompletedSession`: fold → `dismissSession` →
`reattachActiveChatJob`), quindi la riga si smonta e si rimonta. Farla sopravvivere voleva dire
rimettere le mani sul percorso che il commento in loco marca come sorgente del bug della bolla
doppia — per guadagnare un morph in un punto dove il confine fra due turni *è* l'informazione
("uno alla volta"). Dentro una riga montata il cambio morfa già.

### La topbar mostra i membri, non uno di loro

`pageMeta` ha ora `avatars`, riempito dal layout del brand quando `room_agents` ha ≥2 chiavi (gli
avatar arrivano già risolti dal server via `roomAvatars`: niente ricalcolo lato client). Il topbar
li disegna con `AgentAvatarStack layout="row"` — la resa che il componente ha già, non una nuova —
ridefinendo solo `--sidebar: var(--paper)` sul proprio wrapper, perché l'anello che stacca le palle
sovrapposte è dipinto nel fondo di *chi le ospita*, e nel topbar è la carta, non la sidebar.

- **Il titolo resta il join con virgola** di `threadIdentity`: è la stessa stringa della riga in
  sidebar, e due superfici che dicono la stessa cosa devono dirla con la stessa regola. "A, B e C"
  avrebbe voluto una congiunzione per lingua in quattro cataloghi per zero informazione in più; il
  titolo ha già `nowrap` + ellissi dentro un contenitore `min-width: 0`, quindi si accorcia invece
  di sfondare.
- **Confronto per chiavi, non per identità dell'array.** Chi scrive `setPageMeta` lo fa da un
  `$effect` che si rilancia a ogni refresh della lista thread e ricostruisce la pila ogni volta:
  senza `stackKey`, quattro avatar animati si ridipingevano di continuo.
- Su mobile le palle scendono a 20px: quattro da 26 si mangiavano il titolo, e il titolo è quello
  che dice *dove* sei.
- `ChatThread` non dichiarava `room_agents` benché il server lo mandi da sempre (`select('*')`):
  aggiunto: era l'unico pezzo mancante del tipo, e `threadIdentity` lo legge da prima di oggi.

### Il silenzio totale della stanza: no, e sta scritto perché

Il silenzio è **per membro**: in una stanza da quattro tre non parlano, ed è il caso normale
(1 router + 1 voce). Ma una lista vuota dal router **non** diventa "nessuno risponde": una persona
che ha appena scritto e non riceve niente non legge "hanno scelto di tacere", legge un prodotto
rotto — e non ha modo di distinguerlo da un turno morto. Ricade sul padrone di casa, esattamente
come un router andato giù. Resta un `ponytail:` sul punto: se un giorno vogliamo il silenzio vero,
serve anche una riga in chat che dica che nessuno ha preso la parola.

### Un'idea dirompente non è una quota (correzione alla correzione qui sotto)

Stamattina, riparando il banco che riproponeva sempre le stesse due idee, nella sezione di prompt
è finito scritto che *"questo lavoro deve lasciare almeno UNA idea NUOVA nel banco"* — DUE se il
banco era quasi vuoto. Poche ore dopo, un obiettivo di chat sulla produzione di un post grafico si
è decomposto così:

```
c3: At least two new disruptive ideas are saved in the banco
```

accanto ai due criteri veri (il post in bozza, la grafica on-brand). Il proprietario: *"Perché gli
dice almeno due idee disruptive? È l'agent nel caso ad aggiungerle, non deve raggiungere un minimo
né salvarne per forza."*

Due difetti in uno, e il secondo è peggio del primo:

1. **Il riempimento.** Il banco esiste perché le idee migliori escono di lato e si perdono. Un
   obbligo di depositarne due produce due idee inventate per soddisfare un contatore — cioè
   esattamente il riempitivo che il banco doveva evitare. Il riciclo era un difetto; il
   riempimento è lo stesso difetto con più passaggi.
2. **Il criterio fantasma.** L'agente legge il system prompt e ci ricava i criteri di `set_goal`.
   Una frase imperativa nel prompt non resta un orientamento del mestiere: diventa una casella da
   spuntare, e un lavoro risulta *incompleto* per la mancanza di due idee che nessuno aveva
   chiesto.

Ora la sezione **invita e non obbliga**: se lavorando nasce un'idea che passa i tre test la si
salva, perché è così che sopravvive alla fine del thread — e la frase dice a voce alta che non è
una quota, che un lavoro senza idee laterali è normale e che un'idea inventata per riempire il
banco vale meno di zero. Via entrambe le varianti (una a banco pieno, due a banco quasi vuoto), e
via il ramo `thin` che alzava la soglia sotto le tre idee. Stessa ammorbidita nei cinque prompt
corretti insieme a quello: `disruptive.ts`, week planner, planner UGC, media generator, motion.

- **La rotazione resta e non c'entra.** Il difetto delle due idee all'infinito era nel dato —
  ordine per `score` su un banco che non si muoveva mai — e la correzione sta nel dato:
  `last_shown_at`. Togliere l'obbligo dal prompt non lo riporta indietro, ed è la prova che la
  regola "la varietà non dipende dalla buona volontà del modello" era quella giusta.
- **Un test che vieta il ritorno della quota**: su banco vuoto, con un'idea sola e con nove, la
  sezione nomina `save_disruptive_idea` e non contiene mai `almeno UNA/DUE` né `deve lasciare`.
  Un invito si scrive in mille modi, una quota in pochi: si pinnano quelli.
- **Il changelog pubblico è stato corretto, non ampliato.** La riga di stamattina diceva *"every
  piece of work has to leave a new idea behind"*: era la promessa sbagliata, e riscriverla vale
  più che aggiungerne una nuova sotto.

**E poi quella vera, che era lì da prima.** Cercando altre frasi della stessa forma ne è saltata
fuori una peggiore di quella appena tolta, perché non l'avevo scritta stamattina e perché sta nel
system prompt di **ogni** agente (`disruptiveSystemSection`):

> `REGOLA OPERATIVA: … almeno UNA delle proposte deve essere costruita su un CONTRASTO`

Stessa meccanica: l'agente ricava i criteri di `set_goal` dal prompt che sta leggendo, e "almeno
UNA … deve" è contabile, quindi spuntabile. Un obiettivo su un post grafico poteva risultare
incompleto per una proposta-contrasto che nessuno aveva chiesto.

Il rischio nel correggerla era l'opposto di quello di stamattina: ammorbidire finché il prodotto
torna a proporre tre varianti tutte prudenti. **La forza resta, cambia la forma** — da elemento da
consegnare a metro di giudizio:

- `disruptiveSystemSection` → *"COME SI GIUDICA IL TUO LAVORO: … cerca fra le tue proposte quella
  costruita su un CONTRASTO … Se stai per consegnare tre varianti tutte prudenti e intercambiabili,
  il lavoro non è buono per quanto sia corretto"*. Il giudizio è sul lavoro, non su una cosa in più
  da produrre.
- `disruptiveBriefSection` → l'intestazione `CONTRASTO OBBLIGATORIO` diventa `IL CONTRASTO — è il
  metro con cui si giudica questo lavoro, non un elemento in più da consegnare`.
- Week planner: `almeno UN seed deve essere costruito su una leva di contrasto` → *"fra i seed
  cercane uno … e se escono tutti prudenti e intercambiabili la settimana non è buona"*.
- Planner UGC: `At least ONE clip … must be the disruptive one` → *"Look for the clip … a batch
  where every clip is safe and interchangeable is a weak batch, however correct"*. La meccanica
  (`set contrast_device`) resta identica: era l'unica parte davvero operativa di quella frase.
- **Il motion resta com'è** (`motion-video/agent.ts`, "you MUST apply every issue…"): file conteso,
  e quel MUST riguarda un QC da applicare, non una quota di proposte.

**Il divieto è su una famiglia di parole, non su una frase.** `no quota an agent can turn into a
goal criterion` (`lib/disruptive.test.ts`) passa le tre sezioni raggiungibili senza database e
verifica che nessuna contenga `almeno UN…`, `at least ONE…`, `CONTRASTO OBBLIGATORIO` o
`deve essere costruita`. Un test su una sezione sola è un invito a riscrivere la quota nell'altra.
Nella stessa suite, la controprova: le sezioni devono ancora dire che un lavoro di varianti
`intercambiabili` non è buono — la dottrina non deve sparire insieme alla quota. Il ban su
`obbligatorio` in generale è stato scartato: `break_the_ritual` *descrive* "il rituale obbligatorio
della categoria", ed è la parola giusta lì.

**Il seed del week planner non è testabile da lì**: la sua frase vive in un template literal dentro
`runWeekPlannerAgent`, che ha bisogno di un database per girare. Coperta la parte che eredita da
`disruptiveBriefSection`, non la riga sua.

**La rincorsa non si vince frase per frase.** Se un criterio d'obiettivo può nascere da una regola
di mestiere invece che da quello che l'utente ha chiesto, ammorbidire i prompt uno per uno è una
rincorsa infinita: la guardia giusta è strutturale e sta in `chat/goal.ts` — un criterio dovrebbe
poter nascere solo da ciò che è stato chiesto, non da come l'agente è stato istruito a lavorare.
Segnalato a chi ha quel file; qui restano le frasi.

### Il banco idee gira, e la card in chat sparisce

Il proprietario ha visto la stessa cosa per giorni: *"l'ai usa continuamente le stesse identiche
2 idee"*. Non era il modello a essere pigro. `buildDisruptiveIdeasSection` metteva nel prompt le
prime otto idee vive ordinate `score desc`, e nessun agente ha mai avuto un modo per dire "questa
l'ho girata" — i tool erano due, `read_disruptive_ideas` e `save_disruptive_idea`. Quindi ogni
riga restava `new` per sempre, l'ordine non cambiava mai, e le due col punteggio più alto (85 e
82) stavano in cima a ogni singolo prompt. Sopra quell'elenco immobile c'era scritto *"Ripescare
batte reinventare"*: l'istruzione a riciclare, in chiaro.

**La rotazione sta nel dato, non nel prompt.** È la decisione che conta. Un tool per marcare
l'idea usata, da solo, avrebbe rimesso il difetto sul tavolo il giorno in cui il modello si
dimentica di chiamarlo — e i modelli si dimenticano. Ogni lettura destinata a un MODELLO
(`buildDisruptiveIdeasSection` e `read_disruptive_ideas`, entrambe con `rotate: true`) registra
`last_shown_at`, e l'ordine diventa: mai mostrate prima, poi le più vecchie di vista, col
punteggio DENTRO i gruppi e non sopra. Il banco gira anche se nessuno marca niente.

- **Due colonne nuove** (`0211_disruptive_ideas_rotation.sql`): `last_shown_at`, `shown_count`, un
  indice per l'ordine di rotazione e `bump_disruptive_idea_shown(uuid[], uuid)` — stessa forma di
  `bump_brand_memory_usage` (0110), stessa ragione: `shown_count + 1` fatto con read-modify-write
  perde conteggi appena due generazioni si sovrappongono, e i prompt si assemblano in parallelo.
  La funzione prende anche il `brand_id` perché è `security definer` (deve scrivere pure quando la
  lettura arriva dal client admin dell'API) e senza quel vincolo un id indovinato sporcherebbe il
  contatore di un altro brand.
- **La scrittura non può far fallire la lettura.** `recordIdeasShown` è telemetria: errore o
  eccezione finiscono in un `console.error` e la lista torna comunque. Se il bump si perde, il
  banco gira un giro più tardi — non è una lettura sbagliata.
- **La pagina Idee e la CLI restano ordinate per punteggio.** `rotate` è un'opzione, non il nuovo
  default: davanti a una persona il meglio sta in cima, il turno di ciascuno non interessa a
  nessuno.
- **`mark_idea_used`, il terzo tool.** Accetta il TITOLO oltre all'id, perché è quello che il
  modello ha davvero in mano: la sezione di prompt gli mostra i titoli (vedi `formatIdeaLine`),
  non gli uuid, e un tool che pretende un id da una sezione che non lo contiene è un tool che non
  verrà chiamato mai. Passa da `updateDisruptiveIdea`, che già sapeva scrivere `status: 'used'` e
  valorizzare `used_at`: nessuna seconda strada per la stessa cosa. Va a tutti gli stessi
  consumatori degli altri due (`SHARED_TOOL_KEYS`, week planner, planner UGC, media generator,
  motion).
- **Il banco è un PAVIMENTO, non un soffitto.** La sezione di prompt è riscritta: si può ripescare
  — e allora si marca — ma ogni lavoro deve comunque lasciare almeno UNA idea nuova nel banco, e
  la frase lo dice esplicitamente *anche quando il banco è pieno*, perché il rischio corretto è
  precisamente l'agente che pesca e non deposita mai. Banco quasi vuoto (< 3) → la pressione
  raddoppia: almeno due. Stessa correzione nei prompt che ripetevano "ripescare vale più che
  inventare" — `disruptive.ts`, week planner, UGC, media, motion: due istruzioni opposte
  avrebbero rimesso il riciclo il turno dopo.
- **Il test che mancava**, ed è quello che avrebbe intercettato il difetto: due letture consecutive
  della sezione, su un banco di dodici idee con punteggi decrescenti, non restituiscono la stessa
  cima. Il fake Supabase adesso implementa davvero `order`/`limit` e l'`rpc` — senza quello il
  test passava per finta.

**E la card sparisce dalla chat.** `ChatIdeasCard` mostrava le idee dentro il thread ("Disruptive
ideas / Idea bank"): non serve e non è bella, il banco ha già la sua pagina. Tolta dalle tre
superfici (`ChatColumn`, `ChatLiveStatus`, la pagina del thread) e con lei tutto quello che
restava orfano: `ideasByCall`, `ideasFromToolOutput`, `ChatIdeaItem` e i loro test, il campo
`ideas` che `persistence.ts` scriveva sulla parte per farla sopravvivere alla compattazione del
partial, e il prop `brandSlug` di `ChatLiveStatus`, che esisteva solo per il link della card.
La pagina `/app/[brand]/ideas` e l'endpoint API non si toccano: è la card in chat che sparisce,
non il banco. Il chip del tool e la riga "N fonti usate" restano come sono.

**Da applicare a mano prima di spedire: `0211_disruptive_ideas_rotation.sql`.** I deploy non
eseguono le migration, e `last_shown_at`/`shown_count` entrano in `COLS`, la select condivisa: con
la migration non applicata *ogni* lettura di `disruptive_ideas` torna vuota, non solo la sezione
di prompt.

### Leggere i post non è mostrarli

Ogni `read_posts` in chat sputava fino a 12 `PostCard` sotto la risposta: `previewFromOutput`
(`chat/persistence.ts`) costruiva le anteprime per quel tool in modo incondizionato, e i prompt
peggioravano la cosa — `agents.ts` e `system-prompt.ts` istruivano l'agente a *chiamare*
`read_posts` proprio per far vedere le immagini. Risultato: ogni lettura di contesto — quella che
serve all'agente per sapere cosa esiste prima di rispondere — sfondava la conversazione con una
vetrina che nessuno aveva chiesto.

Ora leggere è un gesto privato e mostrare è una decisione: `read_posts` prende un
`show_to_user?: boolean` (default falso) e le anteprime si costruiscono solo quando la chiamata
l'ha chiesto.

- **Il flag si legge dall'input, non dall'output.** `assistantContentFromSteps` mette già
  `input` accanto a `output` sulla parte `tool-call` salvata, quindi `previewFromOutput` riceve
  l'input della stessa chiamata e decide. Nessuno stato duplicato nel risultato del tool, niente
  campo in più che il modello si rilegge nel contesto.
- **Le altre anteprime restano automatiche.** `create_post`, `cross_post`, `generate_image`,
  `design_graphic`, `replace_source`, `write_source`: lì la card è il lavoro appena fatto, non
  l'effetto collaterale di una lettura. Nessun flag, nessun cambiamento.
- **La riga "fonti usate" non c'entra e resta** (`chat-sources.ts`): "N post" è testo, ed è il
  modo giusto di dire "ho guardato i post" senza mostrarli.
- **I prompt allineati, tutti e tre.** `agents.ts` (blocco SHOWING POSTS & IMAGES), il
  `system-prompt.ts` generale e il brief di onboarding (`onboarding-chat.ts`, che diceva "i post
  si mostrano con read_posts"): due istruzioni opposte avrebbero rimesso la vetrina il turno dopo.
- Un solo punto di costruzione (`previewFromOutput`) serve tutte le superfici — chat brand, chat
  del post, il worker `respond/run` — quindi la guardia è una sola. Lo stream non porta anteprime:
  compaiono solo dopo il salvataggio, quindi non c'era niente da toccare lato client.

### Il campo "A" sopra il composer, e una topbar in meno

La home è solo la chat da quando il workbench è finito in una modal, e sopra quella chat restava
un'intestazione che ripeteva il nome della pagina: titolo e sottotitolo (`app.home.overview.title`
/ `.subtitle`) tolti — su QUESTA pagina soltanto, con `clearPageMeta()`. Le altre pagine tengono
la loro, e le due chiavi restano nei cataloghi: sono orfane, non sbagliate.

Al loro posto, sopra la casella, un campo **"A"** (`ChatRecipients.svelte`): un riquadro staccato
ma della stessa famiglia visiva del composer — stessa superficie, stesso raggio, stessa ombra — con
i destinatari come chip (avatar + nome + ×) e un `+` che apre l'elenco. Sotto il cursore il chip
cambia espressione: `hoverFaceFor` (già usato da sidebar e `AgentAvatarStack`) e il morph che
`AgentAvatar` fa da solo. Nessuna seconda animazione, nessuna seconda mappa di volti.

- **Non è una macchina nuova.** Le chiavi che escono di qui sono quelle del picker (`content`,
  `custom:<uuid>`), e `applyRecipients` in `ChatColumn` le traduce nei tre pezzi che il file già
  usava: uno solo → `agentSel`/`customAgentSel`, due o più → `roomSel`, cioè `room_agents` scritto
  al primo messaggio da `ensureThread` → `createThread`. Il tetto (4) e la validazione restano di
  là (`parseRoomAgents`, `ROOM_MAX_MEMBERS`): qui il 4 è solo il limite visivo.
- **Anomalia lascia il posto.** `auto` non è in `AGENT_IDS`, quindi non può essere membro di una
  stanza: scegliere uno specialista quando c'è solo Anomalia la sostituisce, e sceglierla di nuovo
  scioglie la stanza. Toglierli tutti si può: il campo dice "Risponde Anomalia" ed è la verità,
  perché la ricaduta è `auto`.
- **Con la stanza, `agent` è il PRIMO membro.** È la ricaduta se il server rifiuta la stanza: mai
  l'agente scelto un attimo prima e poi tolto dai destinatari.
- **Un solo comando per una sola scelta.** Sulla home il picker agenti dentro la barra dei
  controlli sparisce (`agentOptions={null}` a `ChatPrompt`, che è già il modo con cui quel blocco
  non si disegna): due controlli identici a due centimetri di distanza sono peggio di uno. Fuori
  dalla home — pagina thread, thread vuoto — il picker è esattamente quello di prima.
- **Il flag.** A `GROUP_CHATS` spento il campo funziona lo stesso con UN destinatario e scegliere
  sostituisce: nessuna spunta, nessun conto, nessuna promessa che il server rifiuterebbe. Acceso,
  da 2 a 4 e il menu resta aperto mentre si sceglie.
- L'elenco si apre verso l'ALTO come gli altri menu del composer: il campo sta a metà schermo e un
  elenco che scende finisce tagliato dal bordo della finestra. Ricerca a digitazione oltre le 8
  voci — sotto, scorrere è più veloce che scrivere.

### I divisori nel transcript: il giorno, e dove eri rimasto

Due righe di servizio fra le bolle, entrambe nella grammatica già adottata dagli altri widget del
transcript (`ChatToolChips`, `ChatSources`): testo piccolo e centrato, nessuna cornice.

- **Divisore di giorno.** Compare in cima al primo gruppo e a ogni cambio di giorno. Le fasce sono
  le STESSE di `threadTimeLabel` in sidebar (oggi / ieri / entro la settimana / prima), con l'ora
  accodata come nel mockup di riferimento: "Oggi 12:56", "Ieri 09:14", "lunedì 15:20",
  "12 mar 09:00". Nomi di giorno e mese li scrive `Intl` con `$locale`, quindi i cataloghi non
  crescono: bastano `chat.groupToday` e `chat.groupYesterday`, che c'erano già in tutte e quattro
  le lingue. Fuso: quello del browser, come la sidebar — `brands.timezone` serve a programmare le
  pubblicazioni, non a dire a chi legge che ora era in un fuso non suo. Scartata una terza
  convenzione oraria.
- **Divisore "Nuovi messaggi".** Una volta per thread, prima della prima risposta non letta, nel
  colore dei badge numerici della sidebar (`--accent`, come `.chat-unread-badge`), con due filetti
  smorzati ai lati. I filetti solo qui: il giorno è un orario, il confine dei non letti è il
  punto in cui si riprende a leggere. Il confine viene dallo STESSO criterio del badge
  (`loadUnreadCounts`, 0207): risposte `assistant` con del testo, scritte dopo
  `chat_thread_reads.last_read_at`. Contare anche i messaggi dell'utente avrebbe fatto dire 3 alla
  sidebar e 5 alla chat.
- **Congelamento.** Il confine è una fotografia scattata dal SERVER all'apertura, prima che
  l'apertura stessa sposti il segnalibro: la load della pagina thread lo restituisce come
  `lastReadAt`, la GET del transcript come `last_read_at`. In `ChatColumn` il `markThreadRead` è
  stato spostato DOPO la fetch (prima correva contro la propria GET e il divisore non sarebbe
  comparso mai); il pallino si spegne comunque subito con `clearUnread`. Le risposte che arrivano
  mentre l'utente è dentro segnano letto sul server ma non toccano il valore congelato, quindi il
  divisore non scivola in fondo a ogni messaggio.
- **La pagina del thread non segnava letto affatto.** Nessun `markThreadRead` da nessuna parte: il
  badge si spegneva solo quando l'utente scriveva, e il divisore sarebbe rimasto fermo a mesi fa.
  Aggiunto all'apertura e sul live sync, come già faceva `ChatColumn`.
- La logica sta in `src/lib/chat-day-groups.ts` (puro, `now` iniettabile) e il markup in
  `ChatDivider.svelte`, montati da entrambe le superfici: due raggruppamenti separati prima o poi
  divergono. `role="separator"` con `aria-label`, token veri (`--ink-faint`, `--accent`) quindi il
  ratchet di `ui-tokens.test.ts` resta verde. Senza la 0207 applicata `loadLastReads` torna `{}`:
  nessun divisore, nessun errore.


### L'autopilot fermo da 30 giorni: un enum vuoto, e un `pending` che non scadeva mai

Istruttoria sui dati di produzione: zero post prodotti in 30 giorni sull'intera flotta. Due cause
distinte, non una.

- **1–6 agosto — `media_mode.enum[2]: cannot be empty`.** Ogni run moriva sullo stesso 400 di
  Gemini. `STRATEGY_SCHEMA` in `content-preview.ts` dichiarava
  `enum: ['use_as_is', 'composite', '']`: la stringa vuota serviva a dire «nessun asset di
  libreria», ma un enum di JSON Schema non la ammette e Gemini rifiuta la richiesta **intera** —
  quindi non falliva `media_mode`, falliva la pianificazione. Già corretto per altra via in
  `61207e05` (valore tolto dall'enum, campo tolto da `required`, descrizione che dice di ometterlo):
  qui si aggiunge la rete che mancava. `src/lib/server/model-enums.test.ts` scandisce OGNI `enum:`
  del repo — letterale e costruito per spread da una costante (`enum: [...CONTENT_FORMATS]`) — e
  fallisce se un valore è vuoto. Non guarda `media_mode`: il prossimo enum vuoto non si chiamerà
  così. Scartato il sanitizer a runtime: i 16 punti che passano `responseSchema` non hanno un
  wrapper comune, e un enum vuoto ora non passa la CI.
- **Dal 25 giugno — la guardia dell'overlap che si autobloccava.** `runAutopilotForBrand` crea la
  riga `scheduler_runs` in `pending` *prima* di lavorare, e il tick salta un brand che ha una riga
  `pending`. Ma la function muore a 300s e la riga resta `pending` per sempre: da quel momento quel
  brand viene saltato a **ogni** giro, e il salto avveniva prima di qualunque scrittura. Risultato:
  sette brand fermi (`altro-agency` dal 25/6, `021` dal 28/6, `dal-nulla` dal 7/8), `scheduler_runs`
  vuota dall'8 agosto, zero `loop_ticks`, `autopilot_failure_count` a 0 e campanella pulita. Il cron
  girava benissimo: i log Vercel del 22/8 alle 06:01 sono sette righe «pending run in flight —
  skipping». Ora il tick seppellisce i `pending` più vecchi di un'ora chiudendoli come `failed`
  (che è la verità: un run ucciso a metà finestra), conta come in-flight solo quelli dentro la
  finestra, e alza `autopilot_failure_count` — cioè riusa l'avviso `autopilot-failing` /
  `autopilot-disabled` che la campanella già sa mostrare (`src/lib/warnings.ts`) e, a tre di fila,
  il watchdog che scrive l'opt-out visibile sul roster. Un run riuscito riazzera il contatore, così
  un timeout isolato non fa rumore. E il `continue` dell'overlap scrive finalmente un `loop_tick`
  (`reason: 'in_flight'`): era l'unico salto del repo a violare la regola di `loop-ticks.ts`,
  «ogni `continue` scrive una riga», ed è esattamente il salto che ha reso invisibile lo stallo.

Nessun meccanismo nuovo di notifica: il centro avvisi e il roster c'erano già, mancava chi li
alimentasse.

### La squadra come squadra: DM fra agenti, roster unico, routine

Sessione multi-agente (undici deleghe). Il filo: rendere leggibile e vero il modello "agente = chi,
routine = cosa fa ogni tot", e togliere cornici a tutto ciò che in chat non è un messaggio.

- **DM agente⇄agente** (`agent-dm-tools.ts`, `chat-dm.ts`, `queue.ts`): `message_agent(to, message,
  await)` apre un thread privato persistente per COPPIA (marker `room_agents = {dm:[a,b], names}`,
  oggetto invece dell'array delle room → tutto il codice room lo ignora gratis, nessuna migration).
  Async: la risposta del destinatario è un turno in coda col suo scope e cap 15 step; con
  `await:true` rientra dal mailbox di metà turno, mai spin-wait. View-only imposto lato server
  (POST su thread dm → 403). Due bug trovati dal proprietario e chiusi: (1) il destinatario
  salutava l'utente — il brief DM stava in CODA al system prompt, sconfitto dalla massa del prompt
  di brand; ora il blocco DM è in TESTA, il marker del thread è l'autorità (un turno su thread DM
  nasce DM da qualunque provenienza) e l'ultimo messaggio arriva al modello taggato col mittente;
  (2) il mittente ripeteva il testo in chat — l'output del tool non porta più il body, la
  description dice che il chip racconta già l'invio. Le DM NON compaiono in sidebar (solo chat con
  l'utente): si raggiungono dal chip del turno.
- **Roster unificato** (`agent-owners.ts`, `job-roster.ts`, `team-ignition.ts`, `/agents`): i 9 job
  non sono più agenti, sono routine di proprietà dei 6 specialisti veri (`JOB_OWNERS`, totalità
  garantita a compile time). Un thread per AGENTE (`surface='team'`, indice unico 0199 → get-or-
  create senza race), ogni routine ci scrive prefissata col suo nome. I vecchi `job:<key>` restano
  leggibili come alias (volto del proprietario + nome routine). I turni promossi (analytics,
  strategy) ora girano con identità e tool dell'analyst.
- **Onboarding senza paywall** (`connect-tools.ts`, `ChatConnectCard.svelte`, `onboarding-chat.ts`):
  nuovo criterio del goal — chiedi le app dell'utente e proponi 1-2 connessioni con la card in
  chat (Connect Link Composio, mai un token nostro; reconcile prima di rispondere, claim al focus).
  `offer_upgrade` resta solo su domanda esplicita di prezzi.
- **Device login GitHub** (`sandbox-device-login.ts`, `ChatDeviceLoginCard.svelte`): l'agente avvia
  il device flow, la card mostra il codice, l'utente autorizza dal suo browser, il token finisce
  SOLO dentro la VM (`runs/<runId>/.github.env`, chmod 600) e muore col lease. Mai nel transcript,
  in DB o nei log (test che lo pinna). VM aperta solo dalla chiamata del tool (lazy `ensure`), tool
  riservato all'orchestratore. Serve `GITHUB_DEVICE_CLIENT_ID` (OAuth App con device flow).
- **Qualità post/UGC/motion**: `CAPTION_FAILURE_MODES` + rilevatori deterministici
  (`detectCaptionTells`, `detectCtaEcho`) che il copy chief DEVE correggere; cattura delle
  correzioni manuali in `applyPostEdits` → `content_prefs.captionEditPairs` (prompt invariato a
  zero edit); QC immagini che legge il testo renderizzato lettera per lettera; dimensione `anatomy`
  nella review video; ricettario transizioni provate a compilazione + rilevatore che guarda la
  composizione vera; regole audio (ducking, voci mai sovrapposte, durata come obiettivo).
- **UI della chat, giro minimal**: azioni messaggio in un solo bottone su hover con info modello/
  tempo/token dentro; tool call → riga "N azioni fatte" centrata + dialog/bottom sheet; fonti →
  "N fonti usate" con tutte le fonti nel dialog; goal → riga con dettagli a espansione, centrata;
  chip DM con avatar del destinatario; open-tab, idee, artefatti, coda: cornici via. Tipografia
  rifatta alla radice: `body { letter-spacing: -0.05em }` (valore display) era ereditato dal testo
  chat; ora `0.01em`, line-height 1.6, misura 75ch, e il markdown della thread page — che era CSS
  MORTO (scritto senza `:global()` su contenuto `{@html}`) — vive nel foglio condiviso con le
  altre due superfici.
- **Avatar**: morph geometrico vero fra espressioni (`avatar-morph.ts` interpola i PARAMETRI e
  riproietta; dot≡capsule e arc con bend continuo eliminano i fallback), ciclo espressioni estratto
  in `loadingFaceAt` (2.4s) con test che lo pinna, gaze dell'overview riusato quando l'avatar è in
  caricamento. Riga live: avatar 28px, tempo ed etichetta a comparsa su hover, blocco "thinking"
  sostituito dal ragionamento in stream.
- **Espressione a riposo = quella dell'agente scelto** (`chatFaceForPhase(phase, resting)`,
  `composerIdentity`): a riposo l'avatar grande di overview e chat mostrava `CHAT_FACE_BY_PHASE.idle`
  ('wide') per chiunque, quindi Motion e Analyst — che in `BUILTIN_AGENT_AVATARS` hanno già la loro
  faccia — si presentavano col volto di Anomalia finché non partiva un turno; il colore invece era
  già giusto, quindi si vedevano cinque palle colorate con la stessa espressione. Ora la fase `idle`
  prende la faccia di CHI risponde (`restingWho = threadWho ?? activeAgent`) e le altre fasi restano
  espressioni del turno. La risoluzione era duplicata: `activeAgent` in ChatColumn rileggeva
  `BUILTIN_AGENT_AVATARS` a mano e su un id sconosciuto stampava la chiave i18n nuda — ora delega a
  `composerIdentity`, un wrapper di `threadIdentity` che passa una lista di UNO perché il fallback
  `agents[0]` (pensato per righe dove `agents` è solo l'agente del thread) vestirebbe Anomalia col
  primo agente custom dell'utente. Scartato: una terza funzione di risoluzione, e toccare la faccia
  derivata dall'id in sidebar (è varietà voluta, non un bug). Il cambio agente morfa già da solo (la
  `face` è un prop reattivo di `AgentAvatar`); aggiunta solo la transizione CSS di colore a 420ms
  (= `MORPH_MS`), o la palla scattava mentre gli occhi scivolavano.
- **Sidebar**: selettore brand fuso nella riga in fondo (45 utenti su 47 hanno UN brand — il top
  della sidebar costava troppo per un'azione che quasi nessuno fa); menu riordinato per gerarchia
  (brand → identità cliccabile → crediti su una riga → azioni → preferenze su una riga → esci), 3
  divider invece di 6, ingranaggio duplicato rimosso. Pallino verde di presenza sull'avatar al
  posto del punto viola nella meta. Topbar chat: solo agente, via il sottotitolo.
- **Skill di default (`default-skills.ts`)**: la libreria di skill per brand esisteva ma era VUOTA —
  0 skill su 1.181 righe di memoria in produzione, zero letture, e `synthesizeSkills` (il "dream"
  settimanale che promuove le ripetizioni) non è mai scattato. Le skill di default non erano mai
  state costruite. Ora quattro, nate dai difetti misurati (voce troncata, scene ferme, testo
  illeggibile sugli screenshot, nessun meccanismo di transizione), scritte IN CODICE e non nel DB:
  seminarle per brand voleva dire N copie che invecchiano e consumano il cap di 20. Livello globale
  ottenuto per convenzione (id `builtin:*` fusi a runtime nell'indice e in `read_memory`), zero
  migration. Costo misurato: ~92 token di trigger, e solo per gli agenti che scrivono sorgente
  Remotion; il corpo (~4.000) si paga solo quando l'agente lo apre. Ogni skill dichiara il proprio
  gate — tre sono verificate in codice, la quarta (leggibilità) è dichiarata `qc_review` perché
  nessun check statico vede i pixel. Buco trovato per strada: l'agente motion della CHAT scrive
  sorgente citando un ricettario che non ha nel prompt (sta solo nello studio) — le skill chiudono
  esattamente quello. E la skill ufficiale Remotion NON va installata verbatim: insegna moduli che
  il nostro compile-gate rifiuta.
- **`STAGGER_REVEAL`, undicesima voce del ricettario** — nata scartando 60fps.design: dietro il
  loro abbonamento ci sono NOVE costanti (timing 0.25/0.45/0.7, damping 0.72/0.5, stagger
  0/0.04/0.09) sostituite dentro sette snippet SwiftUI, i "keyframes" sono thumbnail a 1s, e il
  loro generatore emette moto lineare che `findLinearMotion` rifiuta. La fonte giusta era la doc
  UFFICIALE Remotion via context7 (già nel `.mcp.json` del repo): stessa tecnica, nostro framework,
  zero licenza. Preso il ritardo per-elemento, ma a CLOCK SPOSTATO (`interpolate(frame - delay)`)
  invece di una `Sequence from` per elemento, così l'elemento resta montato e la deriva di gruppo lo
  muove anche fuori dalla sua finestra — è ciò che gli fa passare il rilevatore di stasi. Numeri
  nostri e motivati: lo sfalsamento è funzione di N e della durata del beat (la cascata chiude entro
  metà beat), cap 0,35s (oltre si legge come lag) e floor 0,15s (sotto, le entrate si fondono).
  `detectWowMechanisms` riconosce `stagger` solo con marker PIÙ codice dietro, e i test bocciano le
  due imitazioni: sfalsamento a zero e coda ferma.
- **Gate audio sui motion: un video non può più finire a metà frase** (`motion-video/voice-gate.ts`,
  `server/motion-video/voice-gate.ts`). Caso reale del 21/8: script di 6 battute, take TTS con 3
  pause, il modello ha tagliato 4 pezzi indovinando — beat 4 e 5 muti, pezzo 3 troncato a metà
  parola, 6,28s di voce su 22,5s di video. E la craft review **non è mai girata** su quel render
  (zero chiamate, zero righe di punteggio): sotto i 90s di budget saltava in silenzio. Ora tre
  cose. (1) Un gate aritmetico sui campioni, zero modello e zero costo: coda del pezzo silenziosa
  o no (taglio dentro una parola), pezzo che eccede il suo beat, ultima voce almeno mezzo secondo
  prima della fine, copertura del take sotto il 60% = battute buttate. Agganciato dentro
  `renderMotionMp4` PRIMA di aprire la VM — unico punto dove nasce un MP4, quindi copre agente,
  chat e rotta per costruzione, e fallire non costa sandbox. Il rimedio è la regola di `craft.ts`
  diventata codice: si allunga il video, MAI si taglia la voce. (2) Sotto i 90s il giudice salta
  ancora (non c'è tempo) ma non in silenzio: accoda `motion_video_qc` e il video torna
  `under_review` — lo stato onesto è "in verifica", non "pronto". (3) Un verdetto fix/kill accoda
  comunque il giro fuori banda, che RICOMPONE il sorgente invece di ripagare una generazione.
- **Falla chiusa nella sandbox: il token GitHub era leggibile in chiaro** (`sandbox.ts`,
  `sandbox-tools.ts`, `sandbox-device-login.ts`). Il token del device login vive in
  `runs/<runId>/.github.env`, cioè DENTRO il perimetro consentito, e i due tool che leggono non
  passavano nemmeno da `rejectPath`: avevano una copia in linea più debole. Quindi
  `sandbox_read_file` lo restituiva in chiaro, `sandbox_save_output` poteva pubblicarlo come card
  in chat o ingerirlo nella conoscenza del brand, e `sandbox_exec` (`cat .github.env`) lo mandava
  al modello e dentro la traccia salvata. Il `cwd` non era controllato affatto (`cwd:"../.."`
  piantava la shell nella home). Fix a due meccanismi: UN solo guardrail (`isSecretPath` per
  SEGMENTO, non per prefisso) attraversato da read/write/save/screenshot/cwd — le copie in linea
  erano la causa radice, non la lista dei path — e la cancellazione del VALORE in uscita
  (`onSecret`: device_code e access_token cancellati da stdout/stderr, content e testo salvato,
  prima del record e prima del return). Verdetto onesto: in questa microVM non esiste un posto
  leggibile da `gh` e non dall'agente (stesso processo, stesso utente, sudo senza password), quindi
  il file resta sourceable e si difende il valore, non il contenitore. Resta esposto e dichiarato:
  un token TRASFORMATO prima di stamparlo (`base64`) passa lo scrub, i salvataggi binari non sono
  scrubbati, e in profilo `research` sarebbe esfiltrabile via rete (mitigato: il tool è montato
  solo in `compute`). I profili browser persistenti in arrivo, se stanno sotto `.anomalia/`, sono
  già coperti.
- **Motion: le reference ora si GUARDANO davvero** (`reference-tools.ts`): il sospetto del
  proprietario era fondato e i dati lo provano — su 14 giorni **4 studi su 7** sono stati chiamati
  dal modello con `watch:"spec_only"`, cioè zero pixel: il compositore scriveva la TSX senza aver
  mai visto la reference, e nell'ultima generazione reale ENTRAMBI gli studi erano spec_only. Ora
  `spec_only` non è più una dieta che il modello può scegliere: su una sessione con vision viene
  alzato a `frames` (con `watch_upgraded` nel risultato), e resta testuale solo per i caller senza
  vision. Il canale dei pixel era già a due vie (tool result + re-iniezione per-step) e il provider
  è Google diretto, quindi reggeva: mancava solo che qualcuno lo usasse.
  Confermato anche il resto: le 4 ricette nuove (scroll di parole, parola che zooma, scena che
  collassa in un punto, slide con inerzia) sono moduli Remotion che il test COMPILA ed ESEGUE, e i
  due gate (wow + stasi) bocciano in codice la composizione annacquata del trailer del 21/08 —
  scala 1→0,94 col marker giusto — mentre la gemella vera passa.
- **Riconciliazione della fatturazione** (`billing-reconcile.ts`, cron `0 3 * * *`): ogni notte
  confronta Stripe col database. Corregge da sola solo ciò che non muove un euro (piano decaduto
  dopo una cancellazione vecchia di 24h+, brand riattivato se l'abbonamento paga, tier allineato) e
  **solo quando il piano si ricava dal PREZZO**, mai da `metadata.plan` — che è il campo che il
  portale d'upgrade riscrive. Tutto il resto lo SEGNALA nella campanella esistente
  (`upsertAgentNotice`, nuovo `bypassCap`: un allarme sui soldi non deve sparire perché il brand
  aveva già cinque note). `resolveSubscriptionPlan()` ora dichiara la fonte (`price|metadata|
  unknown`) e `LEGACY_PRICE_TO_PLAN` recupera i 15 prezzi fuori catalogo ancora vivi: 11 abbonamenti
  su 15 risolvono dal prezzo invece di 8.
  **La migration 0141 NON va applicata**: è stata scritta sul corpo di 0075 quando in produzione la
  funzione era già passata per cinque modifiche mai finite nel repo, quindi `create or replace`
  cancellerebbe 10 mappature vive per aggiungerne 3. Intestazione ⚠️ messa in cima al file e
  procedura sicura nel rapporto (leggere il corpo vero dal DB, unire, verificare zero piani mossi).
  Trappola imparata a spese nostre: `SubSnapshot` porta ora l'importo dell'ULTIMA FATTURA accanto al
  listino — un coupon al 100% lascia il listino a 49 e la fattura a 0, ed è l'errore che ha quasi
  fatto passare per "in addebito" due abbonamenti gratuiti.
- **Palette di comando e scorciatoie** (`shortcuts.ts`, `CommandPalette.svelte`,
  `chat/search/+server.ts`): ⌘K cerca in un campo solo fra pagine, sezioni settings, agenti, chat e
  MESSAGGI, e Invio apre in overlay senza cambiare URL. I risultati vengono dalle fonti vive (la nav
  della sidebar, `BRAND_MODAL_ROUTES`, `SETTINGS_MODAL_GROUPS`, i thread già in memoria), mai da
  liste scritte a mano — un test fallisce se un bersaglio esce dalla nav. Scorciatoie: registro
  UNICO che genera anche la scheda `?`, quindi non può divergere; sequenze `g`+lettera per le
  sezioni invece di combinazioni con modificatori (⌘L/⌘D/⌘T sono del browser, ⌥+lettera scrive
  caratteri veri su macOS, Ctrl+lettera è il set Emacs nei campi di testo). Ricerca messaggi
  misurata con EXPLAIN ANALYZE: 21ms sul colpo, 37ms nel caso peggiore, index scan sull'indice 0043
  — nessuna migration necessaria. Bug trovato solo dal browser: con la palette aperta ma il fuoco
  non ancora nel campo, la `n` di "calendar" faceva partire "nuova chat" e navigava via.
- **Homepage**: hero centrata nel viewport (`100dvh` + padding simmetrico della barra fissa — solo
  sopra avrebbe spostato il centro 28px sotto la metà), mockup della chat ad altezza FISSA 560px
  con la sola conversazione che scorre (prima cambiando caso d'uso la pagina saltava), video
  YouTube allineato alla larghezza del mockup. Nota: la pagina NON ha una max-width unica (1440 /
  1200 / 940 in tre punti hardcodati di `landing.css`) — debito segnalato, non risolto qui.
  Conseguenza dichiarata del centramento: della sezione successiva non si intravede più nulla.
- **Il ciclo di vita delle routine si scrive da solo** (`chat-routine-event.ts`,
  `ChatRoutineEventRow.svelte`): creata / modificata / spenta / riaccesa / eliminata diventano una
  riga di sistema centrata nel transcript, col dialog che porta proprietario, cadenza, prossimo
  giro, chi l'ha fatto e il brief integrale. Nasce dai tool (`create_scheduled_agent`,
  `set_scheduled_agent_enabled`, e il nuovo `update_scheduled_agent`: prima la chat poteva solo
  cancellare e ricreare, perdendo id, storia e proprietario). Il prima→dopo si calcola sui valori
  NORMALIZZATI, e un cambio nullo viene rifiutato invece di scrivere una riga vuota. Escluso dai
  turni non presidiati: un turno notturno che si riscrive il brief da solo si cambia il mandato
  senza testimoni. Le azioni fatte dalla pagina `/agents` NON generano righe: il transcript è il
  verbale di una conversazione, e un interruttore girato altrove non è mai successo in chat.
- **Ogni pagina come overlay** (`PageModal.svelte`, ex SettingsModal): 46 rotte del brand su 64 e 34
  sezioni settings si aprono sopra la pagina viva, che resta montata sotto (provato nel browser:
  URL fermo byte a byte, nodo sottostante ancora nel DOM, nessun ricaricamento). Due difetti
  trovati solo dal browser: una guardia disarmava la modal quando eri GIÀ su una pagina ospitabile
  (dalla home funzionava, da `/calendar` no — il test era stretto quanto il bug); e `PageHead`
  scriveva su uno stato GLOBALE, quindi la pagina ospitata riscriveva titolo, sottotitolo, CTA e
  avatar del topbar sotto, e allo smontaggio lo azzerava. Risolto col contesto: `PAGE_META_SINK`
  fornito da PageModal, `PageHead` scrive lì quando è ospitato — zero modifiche alle 46 pagine — e
  l'intestazione della modal mostra il titolo VERO della pagina invece di un'etichetta dedotta.
  `document.title` non passa da PageHead (`svelte:head` va in `document.head` da qualunque punto):
  lì un MutationObserver tiene fermo il titolo finché la modal è aperta.
- **Remix degli annunci, senza toccare i pixel altrui** (`meta-ad-library.ts`, `ads-remix.ts`,
  `agent-urls.ts`): il parser leggeva `cards[]`/`images[]` e mai `snapshot.videos[]`, quindi per un
  annuncio VIDEO `videoUrl` era sempre null e nella Ads Library player e `review_video` erano morti
  su ogni risultato. Ora si guardano tutte le creatività, non solo la prima. Il giro completo:
  l'mp4 del competitor entra in `breakdown_reference_video` e ne esce SOLO TESTO (timeline secondo
  per secondo); la clip si produce con prodotti, persone e media DEL CLIENTE, dalla stessa coda
  dell'UGC Creator (quindi stessa review e stessa approvazione), e il brief chiude finalmente lo
  status `converted` dichiarato dalla 0156 e mai scritto. Il vincolo è strutturale su tre strati:
  l'URL altrui non ha una colonna dove persistere, `onlyOwnMediaUrls()` filtra ogni lista di
  reference per host (fbcdn, cdninstagram, tiktokcdn, licdn…), e un test passa materiale sporco e
  asserisce che non sopravviva. Gli URL arrivano al modello con il PERMESSO nel dato
  (`use: inspect_only | reference | open` + i tool che li accettano davvero), non nella descrizione
  del tool. Due buchi trovati chiudendo il giro: `research_meta_ads` non era in nessuna toolKeys
  (ogni specialista lo perdeva) e la chat non aveva `breakdown_reference_video` — cioè l'unica cosa
  che l'agente poteva fare di un mp4 di terzi era quella sbagliata. E un test pinna le chiavi esatte
  del payload Seedance: kie ignora in silenzio i campi sconosciuti, quindi un typo pagherebbe un
  video sbagliato senza errori.
- **Settings come modal ibrida** (`SettingsModal.svelte`): shallow routing (`pushState` +
  `preloadData`) che OSPITA la pagina reale — zero delle 37 pagine riscritte; 12 sezioni leggere in
  modal, le pesanti restano pagine piene, mobile bypassa. Un test pinna la classificazione: una
  pagina settings nuova senza tier non compila il verde.
- **App native**: OAuth fatto dal web che consegna la sessione alla shell (loopback RFC 8252 per
  desktop, fragment `anomalia://` per mobile, state ai due capi, consegna dopo click umano); login
  password che restava su "Connessione…" — causa vera: `@capacitor/preferences` estende un
  `window.Capacitor` congelato dal contextBridge e lancia, la sessione non si salvava; ora il
  desktop usa `localStorage`. Sonda permanente `npm run probe:login`.

### Migration applicata a mano in produzione

`0209_chat_room_agents` (colonna `chat_threads.room_agents` + indice parziale): senza, le DM
degradano con un messaggio chiaro. Il deploy non applica le migration: questa è stata applicata
via MCP durante la sessione.

## 2026-08-22

### Il runtime del turno: mai più "Thinking" muto, follow-up in corsa, Auto che scala

Batch dal test serale del 2026-08-21 (thread `d2d3ce48` e onboarding `rakazo`). La diagnosi sui
job reali ha ribaltato l'ipotesi iniziale: i turni "morti" (`heartbeat lost`) NON erano morti —
tutti e tre hanno poi finito e salvato la risposta. Il heartbeat si era fermato >90s (event loop
bloccato / macchina in sospensione / dev server sotto carico) e il reaper, corretto nel dubitare,
li ha chiusi; il vero danno era la UI: un turno in coda scriveva `partial` sempre VUOTO (il
beacon batteva con `{text:''}`), quindi la chat mostrava "Thinking" senza mai un segno di vita —
per l'onboarding, dal primo secondo.

- **Mirror di progresso sui turni in coda** (queue.ts): `onStepFinish` accumula testo e tool in
  `livePartial`, il heartbeat lo scrive. Il polling del client (già esistente) ora vede il lavoro
  crescere; un turno che muore ha qualcosa da salvare (prima `contentFromFailedTurn` riceveva
  `partial: null`).
- **Riconciliazione post-reap** (queue.ts + chat/+server.ts): un turno che finisce e trova la sua
  riga `failed` la riporta `done` e supersede il messaggio salvato dal reaper (l'id ora viaggia in
  `chat_jobs.result.salvaged_message_id`, scritto da partial-persist). Era l'origine delle bolle
  doppie (rakazo: salvataggio 20:50 + risposta piena 20:54).
- **Cron di dev** (queue.ts, solo `dev`): il drain+reap ogni 60s che in produzione fa il cron
  Vercel — in locale non esisteva niente: un kick perso lasciava un job `pending` per sempre.
- **Fallimento visibile** (thread +page.server/+page.svelte): se l'ultima cosa successa sul
  thread è un turno fallito senza risposta, la pagina mostra il banner d'errore esistente con
  Riprova — non un thread che tace. Riusa `chat.error`/`chat.retry`, zero stringhe nuove.
- **Tier dei seed** (BUG 2): un turno accodato senza tier finiva su `env.CHAT_TIER`. Ora
  `enqueueQueuedChatTurn` scrive sempre `tier` (default `'auto'`) e il drain risolve `'auto'`,
  mai il default d'ambiente.
- **Auto→Pro sulle richieste di produzione** (model.ts, `isHeavyProductionAsk`): regex it/en
  deterministica (verbo di produzione + soggetto, o termine forte: motion/ugc/render/trailer/
  carousel); solo `auto` scala, i tier espliciti mai, i turni schedulati mai, senza chiave kie
  mai. Il tier risolto finisce su `chat_messages.tier`: la UI dice cosa ha girato davvero.
- **Mailbox di metà turno** (mid-turn-mailbox.ts, F2): un messaggio inviato durante la
  generazione viene reclamato al confine di step (`prepareStep`, claim atomico pending→done, un
  solo consumatore), salvato subito nel transcript e appeso al contesto dello step. Continuazioni,
  schedulati e messaggi con documenti restano turni interi; un messaggio dopo l'ultimo step resta
  `pending` e gira come turno normale. La textarea del composer non è più `disabled` in streaming.
- **`temperature` via dai reasoning model** (BUG 4): `temperature: undefined` nei `callOptions`
  kie (Luna/Grok/Terra/Sol), spanto DOPO il default 0.4 dei call site — la toglie dal filo senza
  toccare Gemini/DeepSeek.
- **`cut_voiceover` con url inventati** (BUG 3, output-tools.ts): validazione di forma prima del
  fetch (nostro storage + `/voiceover/`); url invalido con take vero → si taglia quello e lo si
  dichiara (`url_warning`); lettura 400/404 → la risposta allega `take_url` reale. Mai lasciare
  il modello a ricostruire url a memoria.
- **`[unread]` warn una volta per processo** (BUG 5) — la tabella ora esiste, ma il degrado non
  deve più inondare i log.
- **Onboarding sotto obiettivo esplicito** (F3, onboarding-chat.ts): il brief ora apre con
  `set_goal` — (1) ricerca brand a fondo, (2) team AI completo per categorie team/distribuzione/
  vendite, (3) utente guidato al passo successivo.

Scartato: distinguere lato reaper un turno vivo col heartbeat in stallo da uno morto (non
osservabile dal DB); la riconciliazione post-finish è la forma onesta. Scartato un classificatore
a modello per l'escalation: costo per turno per una decisione che una regex prende uguale.

## 2026-08-21

### La chat vestita meglio mentre lavora: card obiettivo, avatar giusti, testo più leggibile

Cinque difetti raccolti dall'uso serale, tutti di forma (il runtime del turno bloccato su
"Thinking" ha un altro autore in questa sessione).

**La card dell'obiettivo.** `goalTurnNotice` (goal.ts) chiude il turno appendendo un paragrafo
`_Goal not reached yet — 4/6 done, still open: …_` come testo semplice — e `renderMd` non rende
il corsivo con underscore singoli, quindi a schermo arrivava il muro di testo con gli underscore
crudi. La scelta è stata NON cambiare il server (quel testo vive anche nel transcript del modello
e nella CLI, e i thread vecchi ormai lo contengono): un parser unico lato renderer
(`src/lib/goal-status.ts`, con test sui quattro template en/it) stacca il notice dalla coda del
blocco e lo consegna a `ChatGoalStatusCard` — anello di avanzamento, criteri aperti con le loro
parole, riga di stato (riprendo in background con shimmer / resta aperto / fermo, dimmi tu /
raggiunto). Un paragrafo goal-simile che il parser non riconosce viene comunque convertito in
corsivo vero: gli underscore crudi non tornano. Etichette nuove in `chat.goal.turn` ×4 lingue.
Scartata l'emissione di un marker JSON dal server: avrebbe richiesto comunque il parser legacy, e
avrebbe sporcato CLI e contesto del modello.

**L'avatar in streaming col colore dell'agente del thread.** ChatColumn passava sempre l'agente
del composer (neutro sui thread `job:`/custom), la pagina thread non passava nulla. Ora entrambe
risolvono con `threadIdentity()` (la stessa della sidebar): ChatColumn preferisce l'identità
fissa del thread e ripiega sul composer, la pagina thread usa la riga dello store (che porta gli
avatar dei custom agent) con `data.thread` come fallback al primo paint. I workbench tengono la
loro identità, il pannello agente già passava la sua.

**Il loop del volto ha una sola sorgente.** Il ciclo di espressioni durante il turno era inlined
in ChatLiveStatus; ora è la prop `cycle` di `AgentAvatar` (stesso `LOADING_FACE_CYCLE`), e la
riga del thread in sidebar la usa quando `busyThreadIds` la dà occupata — l'avatar stesso anima,
non solo il pallino. Con `prefers-reduced-motion` il volto resta fermo e parla il pallino.

**Il tempo a filo.** `.ua-time` (ChatMessageActions) ha 6px di padding pensati per quando sta
dopo i bottoni; durante lo streaming è l'unico contenuto della riga e quel padding lo staccava
dal bordo del testo. `.ua-time:first-child { padding-left: 0 }`.

**Testo chat +1px su desktop.** 13.5→14.5px sopra i 768px (chat-messages.css); mobile resta 15px,
line-height 1.55 è unitless e compone da sé.

### Chat di gruppo: le fondazioni, e la card che si può chiudere

Letta l'app agenti di xAI (Grok Bot) come riferimento. Due cose ne escono.

**Le stanze.** Un thread può contenere più agenti (`chat_threads.room_agents`, migration 0209,
jsonb e non una tabella di join: non c'è stato per membro da tenere, e `getThread` fa già
`select('*')`, quindi la colonna arriva gratis e non entra in nessuna select condivisa
esplicita — il modo in cui una migration non applicata ha già azzerato letture in passato).
Chi risponde lo decide `room.ts`: **il silenzio si decide PRIMA del turno, non dentro.** Da loro
il membro che non ha niente da dire posta "staying quiet" — un turno intero pagato per tacere,
per N membri a ogni messaggio. Da noi una chiamata corta su `compactionModel()` (Luna fast, o
Gemini Flash) legge la roster e sceglie chi parla: costo di una stanza = 1 smistamento + 1 voce,
2 solo se la richiesta è davvero a cavallo di due mestieri (`ROOM_MAX_SPEAKERS`). Ogni voce gira
col SUO prompt e i SUOI tool — `pickTools` è già per-agente, quindi la stanza non ha richiesto un
runtime nuovo. Sequenziale, mai parallelo: il lock per turno esiste già e la seconda voce deve
leggere quello che ha appena scritto la prima.

L'attribuzione riusa `chat_messages.name`, che su una riga assistant è sempre stato vuoto (porta
il nome del tool solo sulle righe `tool`, e `messagesFromRow` non lo guarda) — una colonna nuova
sarebbe finita in tre select esplicite, con il rischio noto. Tutto dietro `GROUP_CHATS`, spento:
senza flag e senza migration ogni thread si comporta esattamente come prima, un agente solo.
Fermato prima dell'esecuzione della seconda voce: serve un `agent` forzato in `input_params` di
`enqueueQueuedChatTurn`, e queue.ts ha un altro autore in questo momento. Le due cuciture esatte
sono nominate in `roomBeat`.

**La card delle domande.** `ask_user_questions` era già interattiva e più avanti della loro
(sequenziale su più domande, progresso salvato, risposta riconosciuta al ricaricamento). Mancava
la chiarezza e la via d'uscita: opzioni piccole in fila, e nessun modo di chiudere una domanda che
non interessa se non rispondendo. Ora le opzioni poche e corte sono impilate a tutta larghezza
(la scelta binaria vera, e il bersaglio grande da telefono), la domanda è più leggibile, e c'è una
× che chiude la card senza mandare niente al modello — locale al browser, come il resto del
progresso: la domanda è già nello storico, chiuderla non riscrive un messaggio.

### La sessione grande: la squadra al posto dei cron, la chat su Luna, e il conto dei provider

Chiusura di una sessione multi-agente (~40 interventi, ~300 file). I pezzi singoli hanno le loro
sezioni, qui e sotto; questa tira le somme per tema, con le decisioni che li tengono insieme.

**La squadra di agenti.** I lavori ricorrenti erano cron invisibili con un solo interruttore
tutto-o-niente, `autopilot_enabled` — ritirato. Ora sono un roster (`job-roster.ts`) con un
opt-out per brand e per lavoro (`brand_job_optouts`, migration 0207/0208), e due regole pagate da
bug veri: **assenza = acceso** (una migration non applicata non spegne niente — i deploy non
applicano le migration, quindi è la condizione normale per ore a ogni rilascio), e **"spento
dall'utente" non è "non è girato"** (il gate scrive comunque `loop_ticks` con `user_off`, così il
doctor e i log distinguono la scelta dal guasto). La pagina `/custom` diventa `/agents`.
L'accensione è un atto del checkout: `igniteBrandTeam` (`team-ignition.ts`), idempotente sui
webhook Stripe che si ripetono, crea i thread degli agenti con presentazioni statiche — al
checkout costi e latenza sono il posto peggiore per una generazione — e chiude il difetto
documentato del brand Pro rimasto mesi con la macchina mai accesa. Stratega e Analista sono
promossi a turni pieni; ogni turno schedulato passa dal perimetro unico di `unattended.ts`, che
toglie SOLO i tool il cui significato richiede una persona nella stanza (domande, offerte,
agenti che assumono agenti, identità visiva del brand) e chiude il buco noto degli agenti custom
schedulati che giravano col set completo dell'orchestratore. Il roster è dietro il piano a
pagamento.

**La chat.** Fast e Auto passano da Gemini 3.7 Flash a GPT 5.6 Luna via kie Codex, dopo averlo
MISURATO con sonde live — il commento in `kie.ts` diceva l'opposto: primo token in 1.8–3.2 s
contro i 4.7 s di Google, tool-loop e immagini corretti, $0.056/$0.339 per 1M contro $1.50/$7.50
(~96% in meno). Gemini resta solo come ripiego per chiave mancante: la chat non deve mai fallire
del tutto. Attorno al modello, la chat diventa il posto dove la squadra vive: sidebar in stile
messaging con gli agenti in cima, identità del thread nella topbar (`thread-identity.ts`), badge
di non letto (`chat_thread_reads` + `unread.ts`, migration 0207), notifiche nei due sensi
(`notification-tools.ts`: gli agenti scrivono quando il lavoro è pronto, e gli si risponde nel
loro thread), e il contratto di etica del lavoro nel prompt di sistema — il lavoro si finisce, non
si dichiara finito.

**Provider e costi.** `model-routing.ts` sostituisce cinque interruttori nati in cinque momenti
diversi con una sintassi sola su due assi che non si collassano mai: `FAMIGLIA@ENDPOINT`
(`AI_ROUTE_TEXT=gemini@kie` è "famiglia Gemini, servita da kie"). Le capability del registro sono
fatti misurati, non righe di listino: ogni `false` corrisponde a una regressione vista dal vivo
(quattro esclusioni sul trasporto kie, fra cui la cache che kie rifattura a prezzo pieno — su un
turno molto cacheato kie costa DI PIÙ). La fatturazione passa al 100% del listino per tutti i
modelli — via lo sconto per-piano su Flash e Nano Banana Pro — e con quello cade il "valore API"
dal pricing: rimosso, non corretto, perché a listino pieno il numero onesto (€25 pagati per
€18,48 di valore) argomentava contro di noi sulla nostra stessa pagina. DeepSeek aggiornato al
listino del 2026-08-21 tenendo la tariffa PEAK: la finestra a doppio prezzo si sovrappone quasi
per intero ai nostri cron, meglio sovrastimare che addebitare metà del vero. La riscrittura della
musica su Lyria 3 e il grounding spostato su Exa hanno le loro sezioni.

**L'audit dei fix.** Il filo è lo stesso della review su main: guasti resi silenziosi da un
ripiego. Il trio di sicurezza sulla pubblicazione; la cancellazione Zernio propagata a tutti e sei
i percorsi di delete (un post cancellato da qualunque superficie deve cancellare anche la
pubblicazione già programmata dal partner, o esce postumo); `cross_post`; `toModelOutput` che
allegava le immagini come `file-data` — che l'OpenAI-compat di Luna mappa su documento, non su
immagine, quindi il modello "recensiva" immagini mai viste — corretto su due superfici in
sessione e su `image-agent.ts` in chiusura; l'orchestratore UGC che segnava `rendered` una clip
fallita (patch e render su una già-resa si rifiutavano a vicenda in cerchio); i muri di credito
mancanti, con l'avviso all'80% deduplicato perché ora lo interroga ogni scheda aperta ogni 45 s;
e il loop caldo fermato da un loop-guard che riconosce il turno che non avanza più invece di
fatturarlo all'infinito.

**Onboarding.** Dal form a schermate alla chat: un campo solo (il sito), la schermata dei social
rimossa, il resto è una conversazione (`onboarding-chat.ts`) che raccoglie ciò che prima
chiedevano i passi del wizard.

**Build.** Le funzioni Vercel da 11 a 5, −517 MB: su Vercel ogni valore distinto di `maxDuration`
fa emettere ad adapter-vercel una funzione INTERA (~90 MB di node_modules ricopiati), quindi gli
scaglioni ammessi sono tre — 300, 800, 1800 — e rimettere un tetto "preciso" non rende una rotta
più sicura, aggiunge 90 MB. Sourcemap spente (−72 MB di `.map` serviti dalla CDN che niente al
mondo leggeva: nessun SENTRY_AUTH_TOKEN, nessun upload, nessun `sourceMappingURL`);
`simple-icons` bundlato nel server per non farne copiare due entry da 5 MB in ogni funzione; cron
tagliati dove il ritmo non pagava (market trends ogni 4 ore, wall sweep lun/mer/ven).

**Fondamenta.** `src/lib/contracts/` (i contratti dei tool con il loro test), `src/lib/testkit/`
(il finto Supabase condiviso invece di dieci mock divergenti), e `ui-tokens.ts`: l'elenco
tipizzato dei token CSS che esistono davvero, col debito esistente congelato in una lista di 98
stray che può solo diminuire — un token inventato dentro un fallback di `var()` è un test rosso,
non più un bug in produzione su tema scuro.

Verifica di chiusura: 339 file di test, 3644 test verdi in run sequenziale; typecheck runtime
pulito; build Vercel verificata (exit 0, 115 s, 5 funzioni / 445 MB).

### Il computer dell'agente: il pannello a destra della chat

Accanto alla chat di un thread con identità (agente del roster `job:*`, custom, o Anomalia)
c'è ora un pannello — `AgentComputerPanel.svelte`, montato dalla pagina thread e attivato da un
bottone nel topbar globale (`pageTopActions`). È **assemblaggio, non invenzione**: ogni sezione
legge dati che esistevano già.

- **Identità** — `threadIdentity` (stessa risoluzione di sidebar/topbar), la riga di cadenza
  (`app.roster.job.<key>.cadence` per i job, `agentScheduleSummary` per i custom) e
  l'interruttore on/off. STESSO archivio della pagina /agents: due nuove action sulla pagina
  thread (`toggleJob`, `toggleRoutine`) che chiamano le funzioni condivise `setJobEnabled` /
  `setCustomAgentScheduleEnabled` — nessuna logica duplicata.
- **Attività** — la card "mini finestra": il turno in streaming riusa `ChatLiveStatus` (non un
  secondo renderer), i job in sottofondo riusano le etichette già in pagina, i render video
  attivi arrivano da `video_renders` (stati rendering/finishing) con minuti trascorsi, e da
  fermo si mostra l'ultimo report del thread VERBATIM (i report dei job sono già deterministici
  in team-ignition — nessun parser oltre lo split delle righe). Per i job anche gli ultimi 5
  `loop_ticks` con lo stesso vocabolario di /agents (`app.roster.state/reason.*`).
- **Routine** — per i custom la loro riga di `custom_agent_schedules` (prossimo/ultimo giro,
  `last_error` come codice tradotto) e "+ Nuova routine" che apre l'editor esistente su
  /agents via il nuovo deep link `?edit=<id>`; per i job la cadenza (read-only) e il rimando a
  creare un agente custom.
- **Intervieni** — NIENTE finto take-control: non abbiamo schermo live/VNC e non lo costruiamo
  (no-new-infra). "Apri dove sta lavorando" risolve in ordine: render attivo → /motion-video,
  ultimo post in anteprima → /calendar?post=, ultimo piano proposto → /plans/:id, altrimenti la
  home del mestiere (analytics → /analytics, strategist → /gtm, producer → /plan, radar →
  /leads, ecc.).

Dati dal solo `+page.server.ts` della pagina thread (`loadAgentPanel`): letture piccole,
ognuna degrada a null/vuoto se una tabella manca (0207/0208 non applicate → il gate risponde
"acceso", il pannello mostra meno, la pagina non erra). Sopra ~1100px è una colonna affiancata
(340px); sotto diventa lo `Sheet` già in uso nell'app. Stringhe nuove in `chat.computer.*` nei
quattro cataloghi, inserite chirurgicamente (nessuna riscrittura dei file).

Da 14 giorni **ogni** generazione musicale falliva: `ai_calls` mostrava 100% di `music` con
`Unexpected server response: 404`, perché Google ha ritirato `lyria-realtime-exp` — il modello
websocket su cui `generateMusicBed` apriva una sessione live, raccoglieva chunk PCM e la fermava a
mano. Il rimpiazzo è **Lyria 3** (`lyria-3-clip-preview`) sulla nuova **Interactions API**:
richiesta-risposta, un POST a `/v1beta/interactions` con `{ model, input }`, e la risposta porta la
clip come MP3 base64 in `steps[] → content[] → { type:'audio' }`. Verificato con un probe reale
prima di scrivere il codice: ~12.6 s di latenza, MP3 44.1 kHz stereo a 192 kbps, ~30.8 s di durata.

Decisioni:

- **Tutta la macchina live è cancellata**: connect/callbacks/chunks/stop/close, il timer
  `(seconds+30)`, la promessa-sessione tenuta per il `finally`. L'annullamento è un normale
  `AbortSignal` sulla fetch (più un timeout a 120 s). La simmetria del registro sopravvive:
  generazione fallita una riga, caricamento fallito una riga, successo una riga.
- **L'MP3 si carica com'è** (`music/<uuid>.mp3`): la VM renderizza via `<Audio src>` e Remotion
  suona MP3 senza transcodifica. Il formato si verifica sui BYTE (magic ID3/frame-sync), non sul
  mime dichiarato — `musicFromInteraction` è esportata e testata sulla forma reale della risposta.
- **La clip è sempre ~30 s**, qualunque `seconds` si chieda. Niente `lyria-3-pro-preview` di
  default (canzoni di minuti per un letto da 20 s è spreco; resta raggiungibile via
  `GEMINI_MUSIC_MODEL`): per i video più lunghi il tool `generate_music` dice all'agente di mettere
  `loop` sull'`<Audio>`, che Remotion supporta nativamente. Scartata l'alternativa di concatenare
  MP3 lato server.
- **Prezzo a clip, non a token**: $0.04/clip (listino pubblicato, letto il 2026-08-21), loggato via
  `flatCostUsd` — nessuna riga nuova in `RATES`, che già dichiara che un modello sconosciuto resta
  a costo null invece di essere prezzato a caso.

Provato end-to-end contro lo storage del brand anomalia: la funzione riscritta ha generato e
caricato un letto reale al primo colpo.

### Review su main: cinque difetti, e quattro erano invisibili perché nessuno falliva

Review tecnica sugli ultimi cinque commit. Il filo comune non è la sciatteria: è che **ogni difetto
aveva un ripiego che lo rendeva silenzioso**. Un fallback che salva, un default che copre, un
`?? auto` che disegna comunque qualcosa. Il ripiego è la cosa che trasforma un guasto in un
degrado, e un degrado nessuno lo segnala.

**Il primo, e il più grosso, è la suite di test.** `npx vitest run` su main dava
`14 file falliti, 20 test rossi`. Non erano regressioni: sei file non si CARICAVANO perché
`@remotion/shapes`, `@remotion/paths`, `@remotion/transitions` e `remotion` stanno in
`package.json` e nel lock ma non erano in `node_modules`. `npm install` e sono tornati verdi. Vale
la pena scriverlo perché è il modo in cui una suite smette di essere un segnale: chi committa vede
rosso, sa che "è il solito remotion", e da lì in poi non guarda più nemmeno i rossi veri. E i rossi
veri c'erano, tre:

- `publish-digest.test.ts` chiamava `buildDailyDigest` senza `day`, quindi la finestra la calcolava
  `new Date()`, e poi asseriva `2026-08-11`. Passava soltanto il giorno in cui è stato scritto. Ora
  il giorno è esplicito.
- `week-planner-agent.test.ts` e `gtm-strategy-agent.test.ts` verificavano un default leggendo il
  `.env` dello sviluppatore, dove entrambi i flag sono `false`. Non testavano il codice, testavano
  la macchina. Ora `$env/dynamic/private` è mockato a `{}`.

### Le facce degli agenti: cinque avatar identici, e la chiave che era rimasta indietro

`3192f660` ha rinominato i cinque agenti (`publish`/`brand`/`grow` → `content`/`ugc`/`motion`/
`analyst`) aggiornando `agent-icons.ts` e il registro server. `BUILTIN_AGENT_AVATARS` in
`agent-avatars.ts` è rimasto sui vecchi id — e siccome ogni lettura è scritta
`BUILTIN_AGENT_AVATARS[id] ?? BUILTIN_AGENT_AVATARS.auto`, non si è rotto niente: ogni agente ha
semplicemente cominciato a disegnare l'avatar di `auto`. Quattro superfici (menu del composer,
bottone del composer, sticker delle espressioni, elenco thread nella sidebar) hanno smesso di
distinguere gli agenti **senza un errore, senza un log, senza un test rosso**.

Il `??` è la ragione per cui è passato inosservato, ed è anche il motivo per cui non lo tolgo: un
id sconosciuto deve disegnare qualcosa. Quello che mancava era il test di parità, che ora c'è in
`agents.registry.test.ts` — il picker offre esattamente `AGENT_IDS`, ogni id ha un colore suo, e
ogni id legacy si risolve in un agente che esiste.

### `render_stills` non è una scrittura, e senza quella riga il `verify` non verificava

`subagents.ts` decide cosa vede un sotto-agente in sola lettura con un elenco di PREFISSI
(`read_`, `list_`, `grep_`, `search_`, …) più poche eccezioni nominate. `render_stills` — l'unico
modo di VEDERE una composizione, perché i tool sul sorgente controllano la sintassi e non eseguono
il codice — non comincia per nessuno di quei prefissi e non era fra le eccezioni. Quindi il ruolo
`verify` sulla pagina Motion riceveva il TSX come testo e nient'altro: leggeva, non poteva
guardare, e chiudeva in pochi secondi con un verdetto che non aveva modo di essere falso.

Aggiunto a `READ_ONLY_EXTRA` accanto a `capture_website`, che è la stessa categoria: costa una
macchina, non tocca il brand. Il tetto di render per turno c'era già.

Vale la pena notare la forma dell'errore, perché si ripeterà: **una regola per prefisso è una
regola che si rompe quando arriva un nome che non l'ha mai conosciuta.** Non c'è modo di
accorgersene guardando `subagents.ts`; ci si accorge guardando un verificatore che risponde troppo
in fretta.

### Il muro di riferimenti: nessun match non vuol dire "ecco i migliori"

`rankIndex` in `posts-design.ts` fa un match lessicale del brief contro le parole dei post, che
sono in inglese. Un brief scritto in italiano non tocca niente: ogni entry resta a zero, l'unico
criterio che sopravvive è `capturedAt`, e **ogni brief riceve la stessa identica cima del muro**.
Misurato sul corpus vero (463 post): `"un lancio prodotto per una gelateria artigianale"` e la
query vuota restituiscono gli stessi sei riferimenti, nello stesso ordine. Da lì il sintomo che si
vedeva dal prodotto — l'agente che studia sempre lo stesso video.

Il punteggio zero ovunque non è una classifica, è un "non lo so". Ora, in quel caso e solo in
quello, la finestra ruota su un'impronta del brief: deterministico (lo stesso brief rivede gli
stessi riferimenti, e la cache regge), ma briefs diversi partono da punti diversi. Il muro è
curato per intero, quindi ogni finestra è una finestra di riferimenti buoni; la freschezza vale
meno della varietà quando il punteggio non dice niente.

Resta noto e non corretto: con `only_video` la lista torna più corta del limite chiesto, perché
`is_video` si conosce solo per gli 8 arricchiti e i restanti vengono scartati come "non video"
invece che come "non lo so". Sei chiesti, tre consegnati, in silenzio.

### `cut_voiceover` faceva una fetch server-side su un url che arriva da un modello

`cutVoiceOver` accetta un `url` opzionale dal tool e lo scarica. L'url arriva da un modello, cioè
in ultima analisi da testo che l'utente — o una pagina che l'agente ha letto — può influenzare, e
una fetch dal nostro server verso un indirizzo arbitrario è una richiesta fatta da dentro la nostra
rete. Ora si accetta solo un url dello storage `media` di questo workspace, che è anche l'unica
cosa che questo tool ha senso di ritagliare.

### Istruzioni: i livelli audio, le voci che non si accavallano, e la durata che serve al video

Tre regole nelle craft specs e nel prompt della pagina Motion, tutte nate da video veri:

- **Il letto musicale porta SEMPRE un `volume` esplicito.** Il default di `<Audio>` è 1, cioè la
  musica a volume pieno sopra il parlato: non scriverlo non era "lasciare il default", era
  scegliere il peggiore. Con voce 0.15–0.25, senza voce fino a 0.5, e un controllo dei livelli
  prima del render su ogni traccia non-voce.
- **Le clip di voce non si sovrappongono, nemmeno di un fotogramma.** Con `TransitionSeries` i beat
  CONDIVIDONO i frame della transizione, quindi una clip messa all'inizio del beat successivo parte
  sopra la battuta precedente. La regola ora dice l'aritmetica, non l'intenzione.
- **La durata totale è un obiettivo, non un tetto.** `durationRule` in `motion-video/agent.ts`
  chiedeva di rientrare nel preset; adesso dice che se una battuta non ci sta si alza
  `durationInFrames` e lo si dichiara. Tagliare l'audio per far tornare un numero è l'unico
  scambio che non si fa.

## 2026-08-21

### Anche la chat renderizza: `render_motion_video`, e la fine di due sistemi separati
La domanda era semplice — "anche la chat sa fare un motion video con codice, audio e voce?" — e la
risposta era no, per un difetto mio di poche ore prima: `MOTION_CRAFT_SPECS` è **condiviso** fra la
pagina Motion e l'agente motion della chat, ci avevo scritto "voce e musica sono accese di default,
chiama `generate_voiceover`", e quei tool li avevo montati solo sulla pagina. Il modello leggeva un
obbligo che non poteva eseguire.

E dietro, la domanda vera: **se una superficie sì e l'altra no, cosa avevamo unificato?**
`agent-base.ts` aveva unificato l'INFRASTRUTTURA — delegare, la macchina, l'obiettivo, gli
artefatti, le guardie di `finish`. Non le CAPACITÀ: cosa una superficie sa fabbricare. Finché le
capacità erano davvero diverse andava bene; si è rotto quando ho scritto un prompt condiviso che
dava per scontate capacità condivise.

- **`output-tools.ts`** (era `audio-tools.ts`, e il nome mentiva già): voce, musica e il file
  finito stanno insieme perché sono la stessa cosa vista da tre lati — ciò che il video DIVENTA,
  contro il sorgente che lo descrive. E vanno montati insieme: una superficie che scrive il TSX e
  non sa renderlo consegna codice, non video; una che conia la voce e non sa renderla consegna un
  MP4 muto.
- **`render_motion_video`** produce l'MP4 con `renderMotionMp4` e — la parte che lo rende visibile —
  attacca l'url alla riga come `preview_url`: senza, il file sta nello storage e la galleria mostra
  una tessera vuota. È anche l'unico percorso che porta l'audio, perché l'encoder del browser
  scarta i `<Audio>` remoti in silenzio.
- **Render di controllo e render finale restano due cose.** `render_stills` è per mentre si lavora,
  costa poco e mostra fotogrammi; il render finito costa una VM e un minuto. Confonderli
  significherebbe accendere una macchina a ogni verifica, quindi le specs lo dicono per esteso.

**Il test che mancava, e che vale più della correzione.** `agents.registry.test.ts` esiste per
questa classe di errore ma guardava in una sola direzione: che ogni tool PROMESSO dal registro
esistesse. Non che il PROMPT non promettesse tool assenti dalla superficie. Aggiunto l'inverso —
ogni nome di tool citato dalle craft specs dev'essere in mano all'agente motion — e verificato
togliendo i due tool che diventasse rosso davvero:
`expected [ 'generate_voiceover' ] to deeply equal []`. Un prompt condiviso è un contratto: se
nomina un tool, chi lo legge deve averlo.

### Un agente solo sotto quattro superfici, e i motion video che parlano
Nove commit che si tengono insieme. Il filo è uno: le cose che rendono un modello un AGENTE —
delegare, avere una macchina, darsi un obiettivo, non potersi dichiarare finito da solo — erano
scritte più volte, in modo diverso, e in una superficie su quattro non c'erano affatto.

**`agent-base.ts`.** Motion, UGC e Media generator montano la stessa base: sotto-agenti, sandbox,
obiettivo, artefatti, e le guardie condivise di `finish`. Motion perde 95 righe nette; il Media
generator, che non aveva niente, prende tutto in una chiamata. **La chat resta fuori**, provata e
misurata: usava `attach` e `close` — cioè ciò che aveva già con `withSubagentTools` e
`withSandboxTools` — e nient'altro, perché non ha un tool `finish` e i blocchi di prompt le
arrivano da `agents.ts`. Quei due wrapper *sono* già l'astrazione condivisa; la duplicazione vera
stava altrove.

**La review non è più un consiglio.** La prima versione lasciava la delega facoltativa. Provata su
un video vero: il modello aveva `delegate_task` in mano, 64 step di budget e tempo in abbondanza, e
non l'ha chiamato nemmeno una volta — ha renderizzato, si è riletto il codice e ha detto che andava
bene. Stessa lezione di `easing.ts`: vale la regola che il codice verifica, non quella che il
prompt raccomanda. Ora `finish` è rifiutato finché non è girata **davvero** una run `verify`,
contata da `onRun` e non dichiarata dall'agente.

**La pagina UGC diventa agentica.** Il solo pezzo agentico era la pianificazione, e finiva prima
che esistesse una clip. Ora `runOneUgcClip` è estratta (483 righe verbatim, con l'audit del diff) e
un produttore decide: `read_plan`, `patch_clip`, `render_clip`, `render_pending`. Le tre cose che
una pipeline non poteva fare: rifare la clip 7 e basta, correggere il copione **prima** di ripagare
la resa, e scrivere i copioni in parallelo con `compose`.

**Il ruolo `compose`, e perché non è `execute` in parallelo.** Cinque esecutori sullo stesso file
fanno cinque scritture, l'ultimo vince, e gli altri quattro hanno lavorato per niente **senza che
nessuno se ne accorga** — ognuno ha ricevuto "fatto" dal proprio tool. Quindi il ruolo che si
parallelizza non scrive: consegna il pezzo nel rapporto, e monta uno solo.

**I motion video parlano.** `generate_voiceover` fa UNA registrazione di tutto il copione e la
taglia sui silenzi: due generazioni separate non danno la stessa voce nemmeno con lo stesso
`voiceName`, e sei beat diventerebbero sei persone. Ogni pezzo torna con la durata reale, in
secondi e in fotogrammi, perché il beat si dimensiona sull'audio e non viceversa. Voce e musica
sono **accese di default**; l'opt-out si onora senza discutere.

**E l'MP4 con audio si rende nella VM**, perché `@remotion/web-renderer` muxa solo `inline-audio`:
un `<Audio src="https://…">` veniva scartato in silenzio, il Player suonava la voce in anteprima e
il file esportato usciva muto. `sourceHasAudio` biforca — senza audio resta il browser, gratis — e
il tempo di macchina si addebita al brand a secondi, nello stesso registro di tutto il resto
(`ai_calls`, `flatCostUsd`), **anche sui fallimenti**: la VM è stata accesa comunque, e non
addebitarli sarebbe un invito a riprovare all'infinito gratis.

**Craft.** I mockup UI erano una riga generica: ora desktop, **tagliati** oltre almeno un bordo
(una finestra intera dentro il frame legge come la foto di un'app, non come uno schermo),
ricostruiti in codice guardando quello vero, e con un'azione che ha un **risultato** — un click
senza conseguenza non dimostra niente. Sull'UGC, `CAMERA:` era una riga per tutta la clip: gli shot
cambiavano cosa succede e mai come è ripreso. Ora ogni beat porta il proprio campo, solo sui
formati multi-scena, e due campi uguali di fila vengono deduplicati perché si leggono come un jump
cut.

**Due difetti trovati strada facendo.** `[]` è truthy: un perimetro di scrittura vuoto significava
"nessuna scrittura" invece di "usa lo scope dell'hub", e ogni `execute` delegato dalla chat sarebbe
tornato senza tool. E nel Media generator l'overflow stava sullo stesso elemento che porta
`pointer-events: none`: un contenitore che non riceve eventi puntatore non è un bersaglio di
scroll, quindi la rotellina finiva sulla griglia sotto e il riquadro di stato non scorreva.

### Il casting prima delle scene, e due cause diverse dietro allo stesso "non ha restituito niente"
Prova su brand vero: ogni scena dello storyboard usciva con **una persona e un prodotto diversi**. Il commento nel codice diceva che la cover entrava come riferimento per tenere volto e stanza; il codice passava i riferimenti generici e non la cover. Cinque frame resi in isolamento dallo stesso testo non sono un film, sono cinque film — la coerenza fra i frame non è una proprietà del testo, è una proprietà delle **immagini** che il testo si porta dietro.

- **Si gira prima il casting**: un ritratto della persona (`buildUgcCastPortraitPrompt`) e, quando serve, uno still del prodotto (`buildUgcProductStillPrompt`). Se il brand ha già un talent o le foto del prodotto non si genera niente — una foto vera vale più di un ritratto inventato
- **Quelle immagini entrano in OGNI frame successivo e nella cover**, e la cover a sua volta entra come riferimento negli shot dopo il primo: è ciò che tiene la stessa faccia, lo stesso oggetto e la stessa stanza da uno shot all'altro
- **Il ritratto e lo still finiscono nella griglia** come gli altri frame

E la diagnosi delle rese fallite, che era cieca:

- `createJob` **buttava via il corpo dell'errore** di Kie: un rifiuto in 200ms usciva come "il render non ha restituito niente", indistinguibile da una chiave scaduta o da un modello in manutenzione. Adesso status e corpo finiscono nei log
- Stessa cosa per l'altra metà: un task **accettato e poi fallito** (o scaduto) ora dice quale task, in che stato e con che motivo. Sono due cause diverse dietro allo stesso messaggio, e senza distinguerle si cerca l'errore nel posto sbagliato — è successo in questa sessione
- **Il tetto di reference NON è cinque.** Avevo dedotto un limite dell'API da un singolo rifiuto; sondando `createTask` direttamente, sei reference vengono accettate anche con durata 15 e audio attivo. Il commento adesso lo dice, così nessuno ri-deduce un limite che non esiste

### Cosa può importare un video: da due moduli a dodici, e la lista adesso vive in un posto solo
`ALLOWED_MODULES` in `compile.ts` erano `react` e `remotion`, punto. Non è mai stata una scelta di
sicurezza ragionata fino in fondo: era il minimo per far girare il player, ed è rimasto lì. La
conseguenza si leggeva **dentro le craft specs**, che chiedevano "slide con sovrapposizione" e
"iris che si apre e diventa la maschera della scena dopo" — cioè, parola per parola,
`@remotion/transitions` — e obbligavano il modello a rifarle a mano con `interpolate` e `clipPath`
a ogni video. Una transizione riscritta da zero ogni volta è una transizione che ogni volta esce un
po' diversa e un po' peggio.

Adesso passano dodici specificatori: `@remotion/shapes` (Circle, Rect, Star, Pie — invece di
`d="M…"` scritto a mano), `@remotion/paths` (`evolvePath`, cioè una linea o un segno di spunta che
si disegna da solo), `@remotion/transitions` con `TransitionSeries` e **sette presentazioni scelte
una per una**: slide, iris, wipe, clock-wipe, flip, fade, none.

- **I sotto-export si ammettono singolarmente**, non a pacchetto. `@remotion/transitions/slide`
  passa, `@remotion/transitions/film-burn` no — insieme a `zoom-blur`, `dreamy-zoom`, `crosswarp`,
  `ripple`, `cross-zoom`, `book-flip`, `swap`: sono l'effetto per sé stesso contro cui le craft
  specs argomentano per intero, e alcune si portano dietro degli shader. C'è un test che lo verifica
- **Fuori restano** `three` (mezzo mega per una cosa che il prompt dell'hub dichiara fuori
  perimetro — questi video NON sono 3D), `@remotion/google-fonts` (centinaia di sotto-export, uno
  per famiglia: una allowlist per stringa non sa esprimerlo, e i font li carica già il renderer) e
  `@remotion/media-utils` (fa rete, e qui non c'è audio). npm arbitrario nel browser di chi guarda
  non è sul tavolo: qui stanno solo moduli che importiamo staticamente noi e che finiscono nel
  bundle alla build
- **`modules.ts` è la lista, e la leggono in tre**: il gate + il require di `compile.ts`, il
  `package.json` del progetto di render nella VM, e il contratto TSX nel prompt. Scritta due volte
  sarebbe divergiuta al primo cambio, e la divergenza peggiore è silenziosa: un video che si vede in
  anteprima e fallisce il render, con il modello che legge quell'errore come un difetto del proprio
  codice e riscrive la scena per "aggiustarla"
- Il tipo `Record<MotionAllowedModule, unknown>` fa fallire la **build** se un nome entra nella
  lista e non nel require: l'alternativa è un modulo ammesso dal gate che poi torna `undefined`

**Il caret sui pacchetti Remotion era una bomba a orologeria, ed è esplosa durante questa modifica.**
Con `^4.0.498` su tutti, npm aveva risolto `remotion` a 4.0.506 e i tre pacchetti nuovi a 4.0.498, e
se li era annidati. Remotion **lancia** su disallineamento (*"Multiple versions of Remotion
detected"*): il compile moriva all'import, prima di arrivare a un qualsiasi video. Tutti i pacchetti
Remotion sono ora pinnati **esatti** alla stessa versione, e `modules.test.ts` confronta la costante
con `VERSION` di `remotion`: se divergono, il test cade prima della build.

**Verificato rendendo davvero, non solo tipizzando**: un TSX con `TransitionSeries`, `slide()`,
`iris()`, `Star` e `evolvePath` — installato dal `package.json` che genera il nostro codice — rende
un PNG corretto, e il fotogramma preso a metà transizione mostra lo slide in corso. Poi la build
client completa: il chunk che porta tutto il percorso di compile pesa 348 KB, sulla rotta del
workbench e non nell'entry.

### La macchina in mano a chi parla, e gli artefatti che sulla pagina Motion non partivano
Due cose piccole con lo stesso odore: una capacità che c'era, montata in un posto solo, e quindi di
fatto assente dove serviva.

**`publish_artifact` era già sulla pagina Motion, e falliva ogni volta.** Sta in
`SHARED_TOOL_KEYS`, `pickTools` lo prende, `studioChatTools` non lo esclude — quindi il modello lo
vedeva nello schema. Ma `createChatTools` riceveva il thread come `undefined`, e il primo rigo del
tool è `if (!threadId) return { error: 'No thread…' }`. Un tool che c'è, che occupa contesto e che
rifiuta sempre è peggio di un tool che manca: il modello lo prova, legge l'errore e improvvisa.

Il thread esisteva già — `openSurfaceTurn` ne apre uno per ogni giro della pagina Motion, ed è
dove la risposta viene scritta — semplicemente non arrivava fino ai tool. Ora passa dalla route,
dalla slice di continuazione (`designer-work.ts`: senza, gli artefatti smettevano di funzionare a
metà lavoro) e dentro a `studioChatTools`, ai tool della sandbox e ai sotto-agenti.

**Il terminale lo raggiungeva solo un delegato.** `createSandboxTools` aveva **un** chiamante in
tutto il repo: il ruolo `sandbox` in subagents.ts. Quindi due comandi al volo costavano una delega
intera — un modello in più, un contesto in più, e un rapporto scritto per riportare indietro un
numero. `withSandboxTools` monta la shell sull'orchestratore, in chat interattiva e in coda.

- **Resta `compute`, e non è una svista.** `research` apre internet, e "internet aperto + i dati del
  brand su disco" è esattamente la combinazione che il sotto-agente tiene separata con `brand_data`
  (vedi il commento su quell'opzione). Chi deve leggere il web continua a delegare
- **`close()` va chiamata, quindi la funzione la restituisce.** La VM è del brand e la spegne il
  suo timeout, ma i file di *quella* run restano finché non li rilascia qualcuno: due giri dello
  stesso brand finirebbero a leggersi i file a vicenda. Chiusa in `onFinish` e in `onError`, sia in
  chat sia nel loop Motion
- **`agents.registry.test.ts` ora costruisce anche questi**: il test esiste per accorgersi di un
  nome promesso e mai consegnato, ed è il test che ha fatto notare il buco appena i cinque nomi
  sono entrati in `SHARED_TOOL_KEYS`

### L'agente Motion guarda i propri fotogrammi: render vero in una microVM
Il giro era: il modello scrive TSX, `compileMotionSource` lo transpila con sucrase **in questo
processo**, e se non esplode si considera fatto. Poi l'MP4 lo rende il browser dell'utente
(`qc.ts`: *"The MP4 itself is client-rendered; the server only patches Remotion TSX"*). Due
conseguenze che si vedevano nei video:

1. **Sucrase non esegue niente.** Prende sintassi e import e si ferma. Un `undefined.map`, una
   `<Sequence>` che finisce prima di iniziare, un `<Img>` che 403a, un layout che va in overflow al
   frame 47: tutto passa la compilazione, e il primo a scoprirlo è chi apre l'anteprima.
2. **Il modello giudicava il proprio codice, non i propri fotogrammi.** La QC di craft legge il
   TSX. Un agente che scrive video e non ne ha mai visto uno è la definizione del problema.

`render_stills` rende davvero, in una microVM, e i PNG tornano **attaccati al risultato del tool**
via `toModelOutput` — stesso meccanismo di `study_motion_reference`, rivolto verso l'interno. Chi
ha scritto la scena è chi la guarda.

- **`research` e non `compute`**, che è la decisione vera. Un video di questo prodotto è pieno di
  `<Img src="https://…">`: still di Nano Banana, foto della libreria, il logo. Con la rete chiusa
  il render riuscirebbe **e i fotogrammi tornerebbero bucati** — il modo peggiore di fallire,
  perché sembra funzionare. In cambio la regola che qui non si negozia: su una run di render **i
  dati del brand non entrano nella VM**. Ci entra il TSX, che l'abbiamo scritto noi
- **Il progetto di render vive in `.anomalia/motion-render`**, non nella directory della run:
  `remotion` + `@remotion/cli` sono ~570 MB di `node_modules`, e `release()` cancella i dati della
  run ma non l'ambiente della macchina. Si installa una volta per VM; ogni render riscrive solo
  `src/Video.tsx`
- **Lo scaffold è stato verificato rendendo davvero** su remotion 4.0.498 — `Root` costruito dagli
  export del contratto, `<Series>` con `offset` negativo, PNG 1080×1080 corretto — invece di
  spedire un'invocazione della CLI scritta a memoria
- **I fotogrammi di default saltano il primo e l'ultimo**: sono i due che un difetto di animazione
  NON mostra, perché all'inizio non si è mosso niente e alla fine è già tutto a posto
- **Un frame che non rende è un difetto vero**, non un problema del tool: fallirà allo stesso modo
  nel browser dell'utente. L'errore torna testuale, ed è la prima volta che questo agente vede un
  errore di runtime del proprio codice
- Tetti: 4 fotogrammi per chiamata, 3 render per turno, e un minimo di tempo residuo sotto il
  quale non si apre nemmeno la VM

E i cinque tool generici della sandbox (`sandbox_exec`, `write_file`, `read_file`, `browse`,
`save_output`) entrano nel loop in modalità `compute`: un terminale per quando la cosa giusta è
eseguire qualcosa invece di ragionarci sopra. Chi deve leggere il web delega un sotto-agente
`sandbox` con `network: research`, come prima.

### La pagina Motion orchestra invece di eseguire: delega, e un ruolo che si parallelizza
La chat aveva i sotto-agenti da mesi (`chat/subagents.ts`), la pagina Motion no — pur essendo la
superficie dove il lavoro si spezza meglio, perché un video è fatto di scene e una scena si scrive
senza vedere le altre. Finora studiare i riferimenti, scrivere sei beat e poi rileggerli col fiato
corto era **la stessa finestra di contesto e lo stesso tetto di step**.

**Il ruolo `compose`, e perché non è `execute` in parallelo.** `execute` non si parallelizza:
cinque esecutori sulla stessa sorgente TSX fanno cinque `replace_source` sullo stesso file,
l'ultimo vince, e gli altri quattro hanno lavorato per niente **senza che nessuno se ne accorga** —
ognuno ha ricevuto "fatto" dal proprio tool. È un lost update, e non si chiude con un prompt più
severo. Quindi il ruolo che si parallelizza **non scrive**: consegna il proprio pezzo dentro il
rapporto (`PIECE` / `ASSUMPTIONS` / `NEEDS`) e il montaggio resta a uno solo, l'orchestratore. Da
cui la regola pratica: se due pezzi non si possono scrivere indipendentemente, non sono due
`compose`, sono un `execute`.

- **`run_parallel_tasks`** — N sotto-agenti insieme su pezzi diversi, con `shared_context` che è
  l'unico contratto fra loro (non si vedono). Quattro corsie di concorrenza: oltre si guadagna poco
  wall-clock e si rischia un rate limit a metà, che qui costa doppio perché i pezzi già pronti non
  servono a niente senza gli altri. `execute` è escluso dallo schema apposta
- Sta accanto a `run_task_pipeline`, che è l'altra metà e non è intercambiabile: la pipeline mette
  in **fila** ruoli diversi sullo stesso lavoro, questo mette in **parallelo** lo stesso ruolo su
  pezzi diversi
- **`finish` e `set_title` in `NEVER_FOR_SUBAGENTS`.** La chat non ha `finish`, ma dieci loop di
  superficie sì: un delegato che lo trovava chiudeva il turno di chi l'aveva chiamato

**Montare la delega fuori dalla chat**, che è il pezzo che non era previsto:

- **`hubToolKeys`** — qui i tool si chiamano `replace_source`, in chat `replace_motion_source`.
  Lo scope per hub (`AGENTS[agent].toolKeys`) tagliava ogni scrittura, e ogni `execute` sarebbe
  tornato a mani vuote
- **I nomi dei tool si leggono a ogni run, non alla costruzione.** La pagina Motion mette i propri
  tool e quelli di delega nello **stesso** oggetto, e quell'oggetto si riempie dopo la factory:
  leggerlo subito dava una mappa vuota
- `remainingMs` arriva fino in fondo da `run-turn.ts`: `deadlineReached` ferma il loop fra due
  step, ma un sotto-agente deve sapere **prima di partire** se ha il tempo di finire

**E la struttura, senza la quale non c'era niente da parallelizzare.** Il contratto ora impone
`<Series>` con un `<Series.Sequence>` per beat. Non è una preferenza di stile: un componente unico
che fa i conti sui frame non ha giunzioni, quindi nessun pezzo è scrivibile, rivedibile o
sostituibile senza toccare tutto il resto — e dentro una `Sequence` `useCurrentFrame()` riparte da
zero, che è esattamente ciò che rende un beat delegabile. Con il resto preso dalla skill Remotion
installata ieri: durate in secondi × `fps`, `offset` negativo per la finestra di sovrapposizione che
le regole di transizione già chiedevano, `premountFor` su ogni sequenza con un `<Img>` (montata al
suo primo fotogramma, un'immagine remota è ancora in caricamento e la scena si apre su un buco), e
`extrapolate*: 'clamp'` — `interpolate` non clampa di default, quindi un'opacità che doveva
fermarsi a 1 continua a salire.

### La skill Remotion ufficiale in `.agents/skills`, presa da monte e non dal mirror
Richiesta: `npx skillfish add ukesjtu/lumina-a11y remotion-best-practices`. Quel path esiste, ma
`lumina-a11y` è un'estensione per l'accessibilità che si è vendorata dentro una copia della skill
**ufficiale di Remotion** (`remotion-dev/skills`), senza attribuzione e ferma a una revisione
vecchia: 31 file piatti sotto `rules/`, frontmatter senza `version`. Monte oggi è alla `4.0.514` —
un router `SKILL.md` che smista su sotto-reference (`remotion-markup/`, `remotion-create/`,
`remotion-render/`, `remotion-saas/`, …), aggiornato l'altro ieri, versionato sulle release di
Remotion. Installata quella: stessa skill, ma la sorgente da cui `skillfish update` può davvero
aggiornare.

- **Va in `.agents/skills/remotion-best-practices/`**, dove stanno già `anomalia` e `composio`
- **Il tracking è `.skillfish.json` dentro la cartella della skill**, non `skills-lock.json`.
  Quest'ultimo lo scriveva una versione precedente di skillfish; la 1.0.39 legge il manifest per
  cartella (`readManifest` in `commands/update.js`) e il vecchio lockfile non lo guarda più.
  `skills-lock.json` resta com'è — le sue due voci non corrispondono comunque più all'hash dei
  propri file
- **Non è passata da `skillfish add`**: `api.github.com` risponde 403 dal proxy dell'ambiente per
  qualsiasi repo fuori scope, quindi la CLI muore su 401. Copiata dal clone di
  `remotion-dev/skills`, tree `0b09ff5`

**Cosa serve davvero a noi, e cosa no.** La skill parla al modello che scrive codice *in questo
repo*, non all'agente Motion che gira in produzione: quello ha la sua conoscenza in
`motion-video/agent.ts` e compila in una sandbox che accetta **solo `react` e `remotion`**
(`compile.ts`, `ALLOWED_MODULES`). Quindi maps, ffmpeg, mediabunny, three.js, tailwind, lottie,
Lambda, Studio e CLI — la maggior parte del peso — restano fuori dal nostro perimetro.
Applicabile è `remotion-markup/`: `<Sequence>` / `<Series>` (che nel nostro prompt non compaiono
proprio), `premountFor`, il tempo scritto in secondi per `fps`, le config di `spring()`,
`extrapolateLeft/Right: 'clamp'` — e `effects.md`, `light-leaks.md`, `text-highlights.md`,
`multi-scene-video.md`, che parlano la stessa lingua delle nostre craft specs.

**Una divergenza da non "correggere".** `timing.md` presenta `Easing.linear` come default e offre
un menu di curve. Da noi `easing.ts` impone `Easing.bezier(0.87, 0, 0.13, 1)` su ogni
`interpolate` e `findLinearMotion` fa fallire il turno. La skill è consultiva, il nostro check è
vincolante: vince il check.

### La cover tornava a essere l'ancora, e le immagini UGC passano a Nano Banana Pro
Prova su un brand vero, formato unboxing: la clip usciva senza somigliare al frame che avevamo appena reso. Due difetti, uno dei quali introdotto dalla modifica precedente.

- **Kie tratta `first_frame_url` e le reference image come MUTUAMENTE ESCLUSIVI** (`video.ts`: `if (useRefs) … else first_frame_url`). Passando i frame di scena facevo cadere la cover, cioè toglievo l'ancoraggio più forte per sostituirlo con dei riferimenti consultivi. Ora, quando si entra in modalità reference, **la cover entra per prima** e il prompt lo dichiara: *"@Image 1 is the OPENING FRAME: the clip starts exactly here"*. Senza frame di scena e senza volto, il percorso resta quello di sempre: cover come primo fotogramma
- **Le immagini del batch UGC erano rese col modello flash.** `UGC_COVER_MODEL` (Nano Banana Pro) esisteva, con tanto di commento sul perché il primo frame ha bisogno del Pro — e lo usava solo il percorso dei post, non l'UGC Creator, che chiamava `renderPostImage` senza modello e cadeva sul default
- **Un frame per stacco, non due in tutto**: uno storyboard che si ferma a metà lascia gli ultimi shot senza riferimento, ed è lì che il modello inventa un'altra stanza
- **I frame di scena finiscono nella griglia** come la cover. Prima esistevano solo dentro la richiesta: per chi guardava, un video che cambia scena quattro volte era stato fatto con una immagine sola

### Le direttive Seedance 2.5 nel prompt UGC, e le reference nell'ordine giusto
Preso dalla [guida Higgsfield](https://higgsfield.ai/blog/seedance-2-5-prompting-guide) e dal catalogo AtlasCloud (CC BY 4.0), adattato come `docs/35-marketing-doctrine`: la dottrina diventa codice testato, non un link in un documento. Dettaglio in `docs/43-seedance-prompting.md`.

- **`GLOBAL STYLE` in testa, `POSITIVE LOCKS` in coda**: una regola visiva prima di tutto, l'elenco delle esclusioni per ultimo. È la forma che il modello rispetta — saltare una sezione non degrada l'output, lo fa fallire in modo prevedibile
- **Shot numerati con intervallo** (`SHOT 3 (6-9s): …`) e lo stacco **dichiarato**. Qui divergiamo dalla guida di proposito: `Hard cut.` solo dove il formato cambia davvero scena, mentre su un talking head in ripresa unica il prompt dichiara l'opposto — *one continuous take*. Uno stacco suggerito a un video che non deve averne è un difetto, non una feature
- **`ACTING`**: reazioni con mezzo battito di ritardo, battito di ciglia naturale, sorrisi che crescono invece di comparire interi, volume più basso come chi sa di essere ripreso. È la nota che più di ogni altra toglie il sapore di spot
- **`PHYSICS` con progressione monotòna**: ciò che è aperto resta aperto, ciò che è consumato non torna intero. Con un prodotto in mano è il difetto che si nota per primo
- **`ENDING` sulla persona**, mai un packshot in chiusura: estende alla fine la regola che avevamo solo sull'inizio
- **`CONSISTENCY LOCKS`** concreti: cinque dita per mano, chi sta sullo sfondo non cambia posto né vestiti, la direzione di scena non si ribalta

E le immagini di riferimento, che finora erano una sola:

- **Il volto va al modello video**, non solo a Nano Banana. L'identità arrivava di seconda mano dentro la cover; ora il ritratto del talent è reference esplicita, ed è ciò che tiene la faccia uguale per tutta la clip
- **Fino a due frame di scena** oltre alla cover, **solo per i formati multi-scena** (unboxing, confronto, tutorial, un-giorno-con, green screen, TikTok Shop). Su una ripresa unica costerebbero rese e inviterebbero a tagli indesiderati. `buildUgcStoryboardFrames` esisteva da mesi e non lo chiamava nessuno
- Ogni riga di `REFERENCES` dice **cosa controlla** quell'immagine: un frame successivo è "lo stesso video più avanti", non un personaggio nuovo. Senza quella riga il modello lo tratta come una seconda persona

### Le chat dell'UGC che sparivano: la risposta la scriveva solo la prima slice
Thread `631719c7`: un messaggio dell'utente, zero risposta. Il job corrispondente è girato **sette minuti e quaranta**, ha pianificato, letto il brand, salvato un'idea, reso tre clip e le ha passate in QC — tutto nel `partial` della riga, niente nel thread.

La causa è strutturale, non un errore di rete: `closeSurfaceTurn` viveva **solo** dentro il `consumeSseStream` della richiesta HTTP originale. Un batch che supera la slice viene troncato e prosegue in un job di continuazione, cioè in un'altra invocazione: quando il lavoro finisce, la richiesta che avrebbe dovuto scriverne il resoconto è morta da minuti. Batch corto (una clip, 30 secondi) → salvato; batch lungo → thread con il solo prompt. Ed è esattamente il pattern segnalato: "alcune volte".

- **Ogni slice scrive la propria parte** (`designer-work.ts`): la continuazione chiude il proprio turno con lo stato del suo mirror, invece di lasciare il thread a metà
- **Il `threadId` viaggia negli `inputParams`** del job di continuazione — senza, la slice successiva non sa in quale thread scrivere. Vale sia per UGC sia per Motion Video, che aveva la stessa identica perdita e nessuno l'aveva ancora vista

### Il pannello della chat in overlay si scorre davvero
Il pannello di UGC Creator e Media Generator aveva `overflow-y: auto` e `pointer-events: none`: scrollabile via codice, bloccato per chi lo usa. E in tutti e tre i workbench l'auto-scroll inseguiva il fondo a ogni chunk, quindi anche dove il pannello si poteva scorrere, il pezzo di stream successivo riportava giù — che dall'esterno è indistinguibile da "non si scrolla".

- `pointer-events: auto` sul pannello (il contenitore resta trasparente ai click, la griglia sotto si continua a usare), più `overscroll-behavior: contain` e lo scroll inerziale su iOS
- **`nearBottom`** (`src/lib/chat-scroll.ts`): si insegue il fondo solo se l'utente è già lì, con 48px di tolleranza per lo scroll smussato. Se è scorso in su per rileggere il piano, ci resta

### Le idee dirompenti si vedono in chat, non solo nel banco
`save_disruptive_idea` tornava `{success, id, title}` e la chat lo rendeva come un chip qualsiasi: l'idea che l'agente aveva appena avuto esisteva in due posti dove nessuno guarda — la riga di un tool result e la pagina Idee. Il momento in cui vale è mentre l'utente sta leggendo la risposta.

- **`ChatIdeasCard`**: riquadro con elenco numerato, nell'ordine in cui le cose sono successe. Per ogni idea: titolo, cosa si vede, la leva di contrasto, il formato, chi si infastidisce, il punteggio. Leva e "chi infastidisce" sono i due campi che distinguono un'idea da uno slogan, quindi stanno in card e non in un tooltip
- **Sia in cronologia sia in diretta**: la card compare mentre il turno gira (`ChatLiveStatus`, quindi anche nell'UGC Creator e nel Media Generator) e resta rileggendo il thread
- **`ideasByCall` deduplica sul turno**: l'agente che legge il banco e poi ci salva la stessa idea la mostrerebbe due volte. Vince la prima occorrenza, così l'ordine resta quello reale
- **Il campo `ideas` viaggia nel `tool_calls` JSON** accanto a `preview` e `plan`, e non è ridondanza: il partial di un turno lungo butta gli output dei tool: senza campo dedicato la card sparirebbe dalla chat proprio nei turni che ne producono di più
- `save_disruptive_idea` ora restituisce l'idea intera, non solo l'id — serve alla card e serve al modello

### Le curve del motion: expo in-out ovunque, e "mai lineare" smette di essere una preghiera
La regola c'era già nelle craft specs — "extreme ease-in-out, not linear" — e non è bastata, per una ragione che il prompt non poteva risolvere da solo: **in Remotion un `interpolate(...)` senza il campo `easing` È lineare**. Il modo comune di spedire movimento a velocità costante non è scrivere `Easing.linear`: è dimenticarsi l'opzione. Un modello che ha letto "mai linear" e poi omette l'easing è convinto di aver obbedito.

- **`Easing.bezier(0.87, 0, 0.13, 1)` su ogni movimento** (`src/lib/motion-video/easing.ts`): quasi piatta alle estremità, ripidissima in mezzo. L'elemento esce piano dal punto di partenza, attraversa di scatto, si posa senza frenata. Estrema nella percorrenza, graduale agli estremi
- **L'overshoot resta, ma è un altro mestiere**: `Easing.bezier(0.16, 1.18, 0.28, 1)` (o una molla poco smorzata) va sull'ULTIMA posa di un'entrata, dove serve il micro-rimbalzo. Percorrenza = expo in-out, atterraggio = overshoot. Prima era la stessa curva a fare entrambi, e infatti ogni traversata aveva un rimbalzo che non c'entrava
- **`findLinearMotion` lo verifica invece di chiederlo**, e `finish` lo rifiuta con le righe esatte — stessa guardia, stesso budget di rifiuti della regola sulle rifiniture. È la terza volta che una regola vissuta solo nel prompt passa inosservata finché qualcuno non legge il database: questa nasce già in codice
- **Il seed insegna la cosa giusta**: `ease` per i movimenti, `settle` per l'entrata del CTA. È esattamente il canale da cui si era propagato il `borderRadius: 999`
- Il giudice di craft nomina il difetto per nome — "lineare", non "un po' meccanico"

### La pagina Idee non si costruisce più il brand da sola
Il brand lo ha già risolto il layout, e ogni altra pagina dell'hub lo prende da `parent()`. La pagina Idee rifaceva la query con `.eq('slug').maybeSingle()` — e in questo database **gli slug non sono unici** (lo stesso brand creato due volte): su un brand duplicato quella riga non risponde, fallisce, e la pagina diventa un 404 senza spiegazione. Ora legge dal layout, con la query di riserva ordinata e limitata a uno.

## 2026-08-20

### Il diario degli obiettivi: lo stato finale non dice se la funzione funziona
`chat_goals` tiene com'è andata a finire, ed è abbastanza per la card in chat e per il prompt del turno dopo. Non è abbastanza per l'unica domanda che vale la pena farsi su una funzione appena nata: **funziona?**

Un obiettivo chiuso come raggiunto può esserlo stato al primo colpo o dopo tre riprese. Uno restituito alla persona può essersi fermato perché era impossibile o perché l'agente girava a vuoto. Lo stato finale schiaccia tutto in una parola sola, e cancella per sovrascrittura proprio la storia che serviva a capire — mentre la funzione è nuova e nessuno sa ancora se la soglia dei quattro giri è generosa o stretta.

Due registri, non uno:

- **`[Goal] …` nello stream della funzione**: una riga per evento, sempre nello stesso ordine (`kind`, `reason`, `progress`, `laps`, `depth`, `queued`). Costa zero e serve a capire *un* caso mentre è ancora caldo
- **`chat_goal_events`**, in sola aggiunta: una riga per ogni cosa che succede a un obiettivo. I contatori sono **colonne** e non payload — le domande vere sono aggregate, e una query che deve aprire un jsonb per ogni riga è una query che nessuno scrive due volte. `reason` usa lo stesso vocabolario di `decideGoalContinuation`, che è ciò che rende confrontabili due righe scritte a un mese di distanza

Quattro eventi: `opened`, `updated` — solo quando qualcosa si muove davvero, perché un `done` su un criterio già chiuso non è un evento e riempirebbe il diario di righe che dicono "non è successo nulla" — `settled` e `closed`. Il `settled` si scrive **dopo** che si sa se la ripresa è stata davvero accodata: un diario che registra le intenzioni invece dei fatti risponde alla domanda sbagliata.

Si rileggono da **`GET /api/v1/brands/:slug/goals`**, che sopra la storia mette il riassunto: quanti obiettivi si chiudono **senza nessuna ripresa** (`met_first_pass` — il caso che deve diventare la norma), quante riprese sono state consumate in totale (`laps`, la voce di spesa della funzione) e **per quale ragione le catene si fermano** (`stopped_by`). Quest'ultima è la riga da guardare per prima: dice se il tetto dei quattro giri è generoso, stretto, o se non lo tocca mai nessuno. E un `criteria_dropped` alto rispetto a `criteria_done` vuol dire che l'agente si scrive criteri che non sa mantenere — difetto del prompt, non del motore.

Tutto fire-and-forget: un diario che fa fallire il turno che sta raccontando è peggio di nessun diario.

Migration `0205_chat_goal_events` (applicata). `docs/43-obiettivo-agente.md` §3-bis.


## 2026-08-20

### `/goal`, e i comandi che si aprono scrivendo uno slash
L'obiettivo automatico copre il caso normale: l'agente legge la richiesta e capisce da solo cosa vuol dire finirla. Il caso opposto è altrettanto vero — la definizione di "fatto" ce l'ha in testa l'utente, e non vuole scoprire a fine turno che l'agente ne aveva scritta un'altra.

- **`/goal <cosa deve essere vero>`** apre l'obiettivo con le parole della persona. Nasce senza criteri di proposito: scomporlo in fatti verificabili è la prima azione dell'agente, e finché non l'ha fatto l'obiettivo non si chiude e niente riparte da solo — riprendere vorrebbe dire rilanciare la stessa istruzione appena ignorata
- **`/goal`** da solo mostra a che punto è, **`/goal stop`** (o `annulla`, `chiudi`, `clear`…) lo chiude. Nessuna delle due spende un turno di modello: sono operazioni su una riga di database, e pagare dei crediti per farsi riscrivere una checklist che è già sullo schermo è il tipo di spesa che non si nota finché non si somma
- Il parsing sta **sul server** (`src/lib/goal-command.ts`), non nel client: un comando che vive solo nel browser tornerebbe testo normale appena arriva dalla CLI o da un incarico ricorrente. Il client intercetta soltanto le due forme che può risolvere da solo. `/obiettivo` è lo stesso comando — la chat è bilingue, e nessuno traduce uno slash

**I comandi ora si aprono scrivendo `/`.** C'erano già, in fondo a due livelli di dropdown dietro il `+`: perfetti da scoprire, inutili da usare. Chi li conosce scrive `/` — è il gesto che ogni altro strumento gli ha insegnato — e finora non succedeva niente. Adesso la lista compare sopra la casella, filtra mentre si scrive (`/go` → `/goal`), si muove con le frecce e si accetta con Invio o Tab. Mentre è aperta Invio sceglie invece di inviare: mandare per sbaglio "/go" al posto del comando che stavi scegliendo è l'errore che rende inservibile un menu a scomparsa. Esce con Esc, con la × o toccando fuori, e resta chiusa finché non ricominci il comando da capo.

**E tutti i menu del composer si chiudono toccando fuori.** Prima l'unico modo di chiudere il `+`, gli agenti o il modello era ritrovare lo stesso bottone e ripremerlo: su un telefono, con il dropdown che copre mezza tastiera, è la differenza fra un menu e una trappola. Ora un tocco fuori li chiude tutti, e anche Esc — che prima funzionava solo con il cursore nella casella, cioè mai dopo aver aperto un menu.

**Sotto i 560px i menu smettono di pendere dal loro bottone** e si allineano al composer, come la lista dei comandi. Ancorati a un bottone di mezza barra uscivano da un bordo o dall'altro (il menu degli agenti finiva a −84px dal margine sinistro); stringerli fino a farli stare avrebbe messo la descrizione di un agente su cinque righe. Larghi quanto la casella: nessun bordo da superare, e si leggono. Verificato a 375px — niente scroll orizzontale, la lista dei comandi si ferma a 40vh sopra la tastiera.


## 2026-08-20

### L'agente si dà un obiettivo, e non è lui a decidere di averlo raggiunto
Un turno di chat finisce quando il modello smette di chiamare tool. Non quando il lavoro è finito — e tutta la distanza fra le due cose è il difetto più caro di un agente: "ho sistemato gli articoli" dopo averne sistemati sei su dieci. Non è malafede, è un turno che è finito prima del compito. E finché nessuno va a contare, sembra una consegna.

I limiti che c'erano coprivano altro: il muro della funzione (`turn-limits`), il girare a vuoto (`loop-guard`), il tool appeso (`step-deadline`). Sanno tutti **quando fermarsi**, nessuno sa **se il lavoro è finito** — perché nessuno sa cosa volesse dire finirlo. L'unico che ce l'ha, quell'informazione, è l'agente stesso nel momento in cui legge la richiesta.

Da qui la modalità **obiettivo**, in stile `/goal` di Cursor con una differenza sola, che è quella che conta: **non c'è nessun comando**. Se lo dà l'agente, da solo.

- **Prima di iniziare**, davanti a un lavoro in più di due o tre chiamate, chiama `set_goal`: una frase e da uno a otto criteri *verificabili*. Fatti sullo stato reale — "i 12 post di settembre esistono e sono approvati" — non passi del suo processo e non intenzioni. Non chiede il permesso: è disciplina di lavoro, non una decisione di prodotto
- **Mentre lavora**, chiude ogni criterio con `update_goal` nel momento in cui è vero, subito dopo il tool che l'ha reso tale. Una checklist spuntata in blocco alla fine è una checklist che nessuno ha controllato. Quello che si rivela impossibile si butta con una ragione, non si dichiara fatto
- **A fine turno decide il codice.** Restano criteri aperti → il lavoro riparte da solo in background, con un prompt che elenca cosa manca, riusando la coda che già portava avanti i turni finiti sul tempo. Tutti chiusi → l'obiettivo si chiude (e se l'agente se ne dimentica, lo chiude il motore)
- **`close_goal(outcome="met")` viene rifiutato** finché un criterio è aperto. È il pezzo che fa il lavoro vero: da lì in poi "ho finito" smette di essere un'opinione del modello

L'obiettivo appartiene al **thread**, non al turno: rientra nel system prompt a ogni giro, quindi al secondo messaggio l'agente sa ancora di averlo. Uno solo aperto per conversazione, imposto da un indice unico parziale.

E siccome ogni ripresa automatica costa crediti veri, quattro freni — tre dei quali progettati per fermarsi in fretta: **una ripresa che non chiude niente ferma la catena** (non è lenta, è bloccata, e il giro dopo ripeterebbe se stesso); **quattro giri al massimo** per obiettivo, tetto economico distinto dai nove della catena per tempo scaduto; mai dentro un loop già rilevato; mai contro uno Stop dell'utente o un messaggio che ha già accodato lui.

Ogni riga che il turno scrive su questo è un fatto e non una previsione: "riprendo in background" compare solo se la ripresa è stata davvero messa in coda — e anche l'avviso di tempo scaduto, che prima indovinava dalla profondità della catena, adesso riceve l'esito reale.

In chat la checklist sta appuntata in cima e si spunta mentre l'agente lavora, con le parole dei criteri e non una percentuale: "3/5" dice quanto manca, "restano le copertine degli articoli" dice cosa manca — ed è l'unica delle due che permette di rispondere "no, quello lascialo stare".

`docs/43-obiettivo-agente.md`. Migration `0204_chat_goals` (i deploy non le eseguono: va applicata prima).

### Chi propone non assume: la scheda conferma/rifiuta per gli agenti ricorrenti
Le chat dei brand potevano già creare un incarico ricorrente, ed è esattamente il problema: **chi suggeriva di assumere era anche chi assumeva**. Nome, brief, giorni e orari vivevano in prosa che scorre via, e "sì dai" dentro una conversazione non è il consenso a un incarico fisso che ogni settimana spende crediti.

Adesso la proposta è **una cosa**: `propose_custom_agent` mette in chat una scheda con tutto quello che serve a decidere — brief integrale compreso, perché nasconderlo dietro un "fidati" renderebbe il bottone privo di senso — e due bottoni. `create_scheduled_agent` resta solo per l'agente che ha chiesto l'utente.

- **Conferma non ripassa dal modello.** Il browser manda thread id e tool call id; il server rilegge la proposta **dal messaggio salvato** e crea quella. Una scheda che dice lunedì 09:00 non può creare qualcosa che gira di notte, qualunque cosa mandi il browser. E confermare due volte crea una volta sola
- **Rifiuta parla in chat**: "no, non questo" è l'inizio della proposta dopo, non la fine dell'argomento
- **Tutto quello che la creazione rifiuterebbe viene rifiutato prima** che la scheda compaia — nome già in uso, tetto dei 25, orari non validi. Una scheda che l'utente conferma e che poi fallisce è l'unico errore che questo giro esiste per evitare: ha già detto di sì
- La decisione sopravvive al reload, il tool è vietato ai sotto-agenti (con la persona parla chi le sta parlando) e la scheda parla da sola: niente chip del tool accanto

### Il tool gratuito diventa una conversazione: incolli il sito e parli con chi ti mappa i processi
`/tools/agent-team`, gratis e senza registrazione: si incolla un sito e si **parla** con un agente che lo legge, dice cosa pensa che tu ripeta ogni settimana, chiede le due o tre cose che un sito non può mostrare — quante richieste arrivi a gestire, chi risponde ai DM, se le prenotazioni in realtà passano da WhatsApp — e poi mette il team sul tavolo, **una scheda alla volta**.

La prima versione era un report: una scansione, un colpo di modello, un organigramma. Bello e sbagliato nella metà che conta, perché **una home non sa dirti i volumi**, e tutto ciò che rende giusto un team sta nelle risposte a quelle due domande. Un tool che non può farle indovina.

- **L'agente si dà un obiettivo davanti a te.** Gli stessi tre tool della modalità obiettivo (`set_goal`, `update_goal`, `close_goal`) e — soprattutto — lo **stesso rifiuto**: `close_goal(outcome="met")` non passa finché un criterio è aperto. Qui non c'è un database dove tenerlo, quindi la checklist viaggia con la conversazione e `sanitizeGoal` la rivalida a ogni turno; a decidere resta il codice condiviso di `goal.ts`, non una copia. La lista è in pagina: un obiettivo che non si vede è una promessa che nessuno può far rispettare
- **I processi restano codice.** Tredici segnali rilevati dall'HTML, ognuno con l'evidenza per cui è scattato (`cdn.shopify.com`, `/prenota`, `intercom`, `/lavora-con-noi`), e `normalizeProposedAgent` scarta la scheda che non poggia né su uno di quelli né su qualcosa che gli hai detto tu. `/products` non è un negozio: quel solo path, in prova, aveva dato a Vercel un agente per la gestione ordini
- **`read_page` invece di indovinare**: quando la home lascia un processo poco chiaro, l'agente apre prezzi, servizi o FAQ e legge. Stesso host, dimensione e tempo limitati, e la lettura del sito è in cache dieci minuti — la stessa conversazione non ripaga quattro fetch a ogni turno
- **La libreria agenti entra nel discorso**: dove un agente pronto fa già quel lavoro, la scheda porta il link per partire da quello invece che da un prompt vuoto. Gli slug tornano validati: inventarne uno non produce un link rotto, produce nessun link
- **Il conto si fa a messaggio, non a scansione** (15 per IP al giorno, 600 al giorno in tutto): una chat non ha una fine naturale, e un tetto per conversazione sarebbe un modello gratis con più passaggi. Il turno ha il suo soffitto di passi, e i tool non scrivono niente da nessuna parte
- **Niente account, quindi niente thread**: il transcript lo rimanda il browser e `sanitizeTranscript` decide cosa può rientrare — due ruoli, un tetto per messaggio, un tetto di messaggi, e deve finire su un turno dell'utente

Lo streaming è quello delle chat dei brand (`applyChatStreamEvent`), quindi le schede e la checklist compaiono **mentre** l'agente sta ancora scrivendo, e non tutte insieme alla fine.

### L'agente sa bussare anche quando la chat è chiusa
L'agente sapeva dire le cose in un posto solo: il thread. E un thread lo legge chi ce l'ha aperto. Finché la chat era una conversazione a turni brevi reggeva; da quando i team ricorrenti girano ogni cinque minuti e una pipeline di sotto-agenti lavora per minuti — o di notte — "l'ho scritto in chat" ha smesso di voler dire "gliel'ho detto". La settimana prodotta alle 3:40, l'errore che blocca la pubblicazione, la decisione che aspetta: tutto lì dentro, tutto invisibile.

**`notify_user`** è il canale vero. Una chiamata, due cose che partono insieme:

- **un'email** via Resend a **tutti i contatti del progetto** — l'owner e ogni persona invitata sul brand (`brandContacts`), ognuno nella propria lingua per la cornice;
- **una push** su ogni dispositivo iscritto, che è la sveglia: se nessuno l'ha attivata, il tool lo dice invece di lasciar credere che sia arrivata.

Il testo lo scrive **l'agente**, non noi: oggetto, corpo dell'email, e la riga singola che deve reggere da sola su una schermata di blocco. Nessuna copy fissa oltre alla cornice, altrimenti ogni notifica suonerebbe identica a prescindere da cosa sia successo. Il corpo passa da testo a HTML con escape prima di tutto il resto — quel testo l'ha scritto un modello che ha appena letto pagine web e documenti caricati, e va trattato come non fidato anche quando "l'ha scritto l'AI": restano solo elenchi `- `, **grassetto** e link http(s) cliccabili.

Mandare email a nome del brand è un'azione verso il mondo esterno, e infatti ha tre freni:

- **due per turno**, poi si parla in chat;
- **sei all'ora per brand**, contate sul log — è il tetto che tiene a bada un agente ricorrente, non uno smemorato;
- **antiduplicato a dieci minuti** sullo stesso oggetto: due sotto-agenti che finiscono lo stesso lavoro non bussano due volte.

E chi *non* ce l'ha: i **sotto-agenti** (una pipeline a tre fasi busserebbe tre volte per un lavoro solo — notifica chi ha parlato con l'utente) e la modalità **Ask**, dove non parte niente che valga una mail. In **Plan** sì: da lì si lanciano strategie e audit che durano.

Ogni invio lascia una riga in `agent_notifications` (migrazione **0204**) con oggetto, corpo, destinatari, email accettate e push consegnate. Serve a tre cose: l'audit di una mail partita a nome del brand, il tetto orario, e l'antiduplicato. Se la tabella non è ancora applicata la notifica parte lo stesso — cade solo il tetto orario.

### Dieci script, una forma sola: l'UGC adesso ha otto formati
Il planner scriveva dieci script diversi e `buildUgcShotBrief` li montava **tutti nello stesso arco** — hook → problem → demo → proof → cta — perché quell'arco era hardcoded. Dieci prime righe diverse, dieci video identici: ciò che si vede sullo schermo era lo stesso in tutti, e il risultato è il modo più veloce per far sembrare un batch una parafrasi di sé stesso.

- **Otto formati con la loro timeline** (`src/lib/ugc-formats.ts`): problema-soluzione, testimonianza, unboxing, tutorial, confronto, un-giorno-con, green screen, TikTok Shop. Ognuno porta **con cosa viene confuso** e **come fallisce**, come le diciotto aperture di `hook-tactics.ts`: senza la disambiguazione un modello ricollassa otto formati in due nel giro di una settimana
- **Le battute sono percentuali, non secondi.** La dottrina è scritta su clip da 30s, noi spediamo 15s (22s per gli ad su Seedance 2.5) e YouTube Shorts ne vuole 45-60: `formatBeats` riscala e garantisce un minimo a ogni beat comprimendo i più lunghi, invece di far sparire l'ultimo. Un CTA tagliato è il modo in cui una clip pagata per intero diventa inutile
- **"Formati misti" non è un default pigro, è la rotazione**: senza una scelta esplicita il batch distribuisce le forme sugli slot, partendo da quelle native della piattaforma. Il planner può cambiare il formato di uno slot, non può lasciarne uno senza
- **Il prodotto non apre più la clip** — tranne dove il formato lo richiede. Unboxing, tutorial e TikTok Shop aprono sul prodotto; negli altri cinque resta fuori dai primi secondi, che è la differenza fra un video e una pubblicità riconosciuta come tale al primo frame
- **`hook_visual` adesso è obbligatorio** e lo scrive il planner: cosa succede fisicamente al secondo uno. Prima il primo frame veniva derivato dalla battuta parlata, quindi ogni clip apriva sulla stessa faccia infastidita
- **Piattaforma come scelta reale**: tetto, sweet spot, sottotitoli, hashtag e cadenza per TikTok / Instagram Reels / Facebook Reels / YouTube Shorts, e la durata della clip si accorcia dentro il tetto del modello
- **La pagina adesso dice come si produce un batch**: dieci script per tre-cinque avatar, resa completa, filtro qualità con un **20-30% di scarto atteso**, montaggio fuori da qui, i migliori 10-15 **organici prima** di qualunque euro, e solo i vincitori organici passano al paid. Chiedi dieci clip e la pagina ti dice di renderne quindici. Senza quelle righe, chi ne chiede tre e ne tiene due conclude che lo strumento è rotto

### Le idee dirompenti smettono di morire nel thread in cui nascono
Il default di ogni agente è la roba corretta: brand-safe, on-voice, beneficio al posto giusto. È il problema. Un contenuto che qualunque concorrente potrebbe pubblicare cambiando il logo non lo guarda nessuno, e il modello ci arriva da solo perché l'accettabilità è il gradiente più facile da salire.

- **Tre test, in quest'ordine** (`src/lib/disruptive.ts`): il **logo** (un concorrente la pubblicherebbe identica cambiando il marchio? allora è un formato, non un'idea), l'**attrito** (a chi dà fastidio? se a nessuno, è decorazione), l'**argomento** (togliendo il prodotto funziona uguale? allora è provocazione a vuoto). Il terzo è quello che impedisce a "siate dirompenti" di degenerare
- **Dodici leve di contrasto**, ognuna con un esempio girabile. La prima è quella da cui è nato il modulo: per un rivenditore di maglie, qualcuno che brucia una maglia ultra low-cost — marchio mai inquadrato, qualità evidente da come si comporta il tessuto. Non nomina nessuno e dice tutto
- **Ogni leva porta il suo limite, e il limite viaggia nel prompt insieme all'idea.** Senza, un modello "audace" arriva alla diffamazione in due passaggi: niente concorrenti riconoscibili in una scena che li sminuisce, niente prove inventate, niente gesti pericolosi presentati come replicabili, niente contrasto su categorie protette
- **La direttiva la ricevono tutti**: i sette agenti di chat via `buildSystemPrompt` (quindi anche i consulti `ask_to_*`), più planner UGC, Media Generator, Motion Video, week planner e generatore di campagne ads
- **Il banco idee** (`disruptive_ideas`, migration `0202`): titolo, cosa si vede, leva, perché contrasta, chi infastidisce, formato, punteggio e stato — proposta → in lista → usata → archiviata. Le otto più forti ancora da girare entrano nel system prompt; banco vuoto lo dice, invece di lasciare l'agente a indovinare
- **Due tool e non uno.** `save_disruptive_idea` da solo produce un banco che cresce e non viene mai letto, con l'agente che ripropone ogni settimana varianti della stessa idea: `read_disruptive_ideas` va chiamato **prima** di inventare. Ri-salvare lo stesso titolo aggiorna la riga e non riporta mai indietro lo stato
- **Pagina `/ideas`** nell'hub Brand — filtri, cambio stato, le dodici leve consultabili e inserimento manuale: l'idea buona in doccia deve entrare nello stesso banco da cui pesca l'AI. E `GET/POST /api/v1/brands/:slug/ideas` per la CLI
- La migration **va applicata a mano** prima del deploy, come sempre in questo repo

### L'agente guarda il proprio film, e chi lo giudica è un designer
Il giro di QC c'era già — si renderizza, un giudice guarda la clip, torna un brief, l'agente patcha — ma con due buchi che lo rendevano tiepido.

**L'agente patchava alla cieca.** Il brief arrivava come testo: "stacco secco al secondo 3, sistemalo". L'agente non vedeva mai il proprio render, correggeva sulla descrizione di un problema. Ora ogni brief di QC — craft, fedeltà e sellability — porta l'URL della clip prodotta, e `resolveUserTurnMediaParts` la trasforma in una parte che il modello **guarda davvero**: il meccanismo esisteva già per le reference incollate dall'utente, mancava solo di puntarlo sul nostro stesso output. Senza URL il brief degrada al testo di prima, quindi un render non ancora caricato non rompe niente.

**Il giudice era una checklist.** Verificava transizioni, easing, tipografia: cose vere, ma nessuna di quelle che fanno la differenza fra "corretto" e "bello". Adesso il revisore è un design director senior con uno standard esplicito — *sopravviverebbe accanto al lavoro di chi fa solo questo?* — e sette lenti che una checklist non ha:

- **restraint**: cosa c'è a schermo che si può togliere senza perdere significato
- **spacing**: una sola scala o numeri improvvisati, margini uguali, centrature ottiche e non matematiche
- **type**: un rapporto di scala solo, non più di due pesi, tracking stretto ai corpi grandi, interruzioni di riga scelte
- **colour**: un accento che lavora invece di tutto che compete
- **shape**: raggi proporzionati e coerenti per ruolo
- **rhythm**: i beat respirano o è uno slideshow accelerato
- **the tell**: *nomina l'unica cosa che tradisce che è fatto da una macchina. Ce n'è sempre una. Se non la trovi, non stai guardando abbastanza.*

E un pezzo con un tell visibile non è un 8, per quanto pulito sia il resto.

## 2026-08-20

### Un video non è una sola chiamata
Ogni turno di creazione andava così: leggi il seed, scrivi trentamila caratteri, metti il titolo, chiudi. Un `write_source` e via. E non era il modello a fare di testa sua: in modalità CREATE **l'intero file è "una struttura nuova"**, quindi la regola che riservava `write_source` esattamente a quello rendeva il colpo unico la mossa corretta. Niente, in tutto il loop, chiedeva mai all'agente di guardare quello che aveva prodotto.

Il risultato è quello che produce una passata sola: otto beat schiacciati in otto secondi, transizioni nominate ma non costruite, nessun arco.

- **`finish` adesso rifiuta** una composizione scritta una volta e mai più riletta. Servono almeno tre passate di rifinitura **e** una rilettura del proprio sorgente; il rifiuto spiega cosa manca — il meccanismo di transizione fra ogni coppia di scene, l'easing e l'overshoot su ogni entrata, il movimento che continua attraverso il taglio, il beat UI per ogni feature. Il rifiuto è **limitato a due volte**: il turno finisce su finish, sul tetto di step o sulla deadline, quindi rifiutare all'infinito brucerebbe la slice senza salvare niente
- L'ho messo in codice e non nel prompt di proposito. Oggi due regole che erano solo righe di prompt sono passate inosservate finché non ho letto il database: quella dei brief di QC e quella del muro. Alla terza si impara
- **La durata si deriva dai beat**, non da un default. Un beat ha bisogno di 2,5–4 secondi per essere letto: sei beat sono 18–24 secondi, non otto. Prima il prompt diceva "default ~6s" e infatti uscivano video da otto secondi con dentro la scaletta di una reference da trenta
- **Le craft specs adesso chiedono un arco**: hook → tensione → dimostrazione → prova → risoluzione. Non cinque affermazioni in fila. E se due beat dicono la stessa cosa con parole diverse, se ne taglia uno e il tempo va alla dimostrazione
- Il prompt descrive la costruzione a tappe — scheletro con `write_source`, poi `read_source` e `replace_source` scena per scena — così la regola e l'enforcement dicono la stessa cosa

## 2026-08-20

### I bottoni smettono di sembrare palle da rugby
Nell'ultimo video: cinque `borderRadius: 999`, tutti su elementi con padding verticale — il CTA principale è `padding: '16px 36px'` con `borderRadius: 999`, cioè una pillola piena su un box alto una sessantina di pixel. Non è un bottone, è una losanga.

E l'abitudine gliel'abbiamo insegnata noi: **il seed stesso** aveva il suo CTA a `borderRadius: 999`. Il seed è la prima cosa che il modello legge, quindi quel valore si è propagato in ogni composizione.

Tre interventi sullo stesso difetto:

- **La regola non esisteva.** `MOTION_CRAFT_SPECS` diceva tutto su transizioni, easing e mockup e **niente sulla forma**. Ora c'è: px fissi sui controlli (10–14 su bottoni e CTA, 16–24 su card e pannelli), un solo raggio per ruolo in tutto il pezzo, mai 999 su qualcosa con più di ~10px di padding verticale, e la pillola riservata alle tag davvero piccole (≤ 28px, due parole)
- **Il raggio percentuale solo su box quadrati.** Su qualunque altro disegna un'ellisse, non un rettangolo arrotondato — è l'altra metà dello stesso problema, quella che avevo segnalato senza poterla confermare
- **Il seed è stato corretto** e un test impedisce che ci rientri un 999, oltre a verificare che ogni raggio percentuale nel seed stia su un box con larghezza uguale all'altezza
- **Il giudice di craft adesso guarda anche la forma**: raggi sproporzionati o incoerenti costano sul punteggio `pleasant`, quindi il difetto non passa più silenziosamente la QC

## 2026-08-20

### Il picker della tipografia funzionava: era il motion che non lo leggeva
Il brand aveva scelto **Inter** in Studio — `graphic_style` diceva `display_font: "Inter", body_font: "Inter"` — e i video uscivano lo stesso con i titoli in serif. Non era il modello a disobbedire: era il brief a dirgli la cosa sbagliata.

- `loadMotionTurnKit` leggeva `brand_kit.fonts`, cioè l'elenco delle famiglie **trovate crawlando il sito**, in ordine di scoperta, e prendeva la posizione 0 come font dei titoli. Per Anomalia quella posizione è **Halant**, un serif; Inter era quinta e non veniva mai guardata. L'agente scriveva `const displayFont = 'Halant'` obbedendo alla lettera
- Un resolver con la precedenza giusta — scelto in Studio › rilevato sul sito › Inter — **esisteva già** (`resolveTypography`) ed era usato da grafiche, editor dei post e media generator. Il motion era l'unica superficie che non lo usava. Ora lo usa
- La lista dei font nel brief è **posizionale**: `[0]` sono i titoli, `[1]` il corpo. Deduplicare sembra ordinato ed è un bug — un brand che sceglie Inter per entrambi collassa a una voce sola e lo slot del corpo scivola sulla famiglia successiva. Restano due slot, duplicati compresi

### Il font si sceglie vedendolo
Il controllo era `<input list>` più `<datalist>`: il browser disegna quelle opzioni nel font dell'interfaccia, quindi scegliere la tipografia voleva dire leggere ventisei nomi e ricordarsi a memoria che faccia hanno. E l'anteprima sul valore scelto era finta — nessuno caricava mai quella famiglia, quindi era il font di sistema con un nome diverso.

- Dropdown custom con **ogni opzione disegnata nella propria faccia**, raggruppata come la shortlist è già definita: sans, serif, display, mono. Le categorie sono il punto — il brief legge lo slot display come "il font dei titoli", e un serif che ci finisce per caso è esattamente come nascono i titoli serif che nessuno ha chiesto
- Ricerca, tastiera, e il testo libero continua a funzionare come col datalist
- Le anteprime costano pochi KB: una sola richiesta a Google Fonts con `&text=` limitato ai caratteri dei nomi da disegnare, caricata alla prima apertura e mai al caricamento della pagina. Se non arriva, ogni opzione resta leggibile nel font di sistema


### Il loop di esito: cosa succede al commento dopo che l'hai incollato
Il loop si chiudeva su "fatto". Da lì in poi il buio: misuravamo item trovati, lead scritti, profili costruiti — tutte metriche di **processo** — e nessun risultato. Se una bozza avesse mai ottenuto una risposta, un upvote o una rimozione non lo sapeva nessuno. Il che rende ogni giudizio sulla qualità un'opinione con l'accento di un dato: senza, si ottimizza alla cieca.

- **Il problema vero è che il commento non lo pubblichiamo noi.** Lo incolla l'umano con il suo account, che non conosciamo — ed è la scelta giusta, è la ragione per cui gli account sopravvivono. Quindi il commento va **ritrovato** nel thread, e l'unico appiglio è il testo che avevamo scritto
- **Il matcher lavora su shingle di tre parole**, non su parole singole: "social media marketing" compare in metà dei commenti di r/SaaS, "before it turns into another" no. E misura il **contenimento** delle shingle della bozza dentro il candidato invece di una somiglianza simmetrica, perché chi incolla taglia, aggiunge una riga sua, corregge un refuso: il testo cambia lunghezza, i pezzi che restano sono i nostri. Se il brand dichiara il proprio handle, quello batte il testo — è un'identità, non un indizio
- **Nessun match significa nessun match**: `found: false`, mai un ripiego sul commento meno peggio. E `removed` si scrive **solo** quando il thread è stato letto davvero e il nostro commento non c'è: se la lettura fallisce non sappiamo niente, e un null onesto vale più di un falso "rimosso" che finirebbe dritto nelle regole del profilo di community
- **Un'osservazione per controllo, non un verdetto sovrascritto**: lo stesso commento a 48 ore e a una settimana racconta due cose diverse, e la seconda non deve cancellare la prima
- **Dove torna indietro**: l'esito entra nel prompt che riscrive il profilo di community, e da lì "cosa viene premiato e cosa sepolto" smette di essere dedotto dai titoli dei thread e diventa cosa è successo ai **nostri** commenti in quella stanza. E compare sulla card in `/leads`: l'unico numero della pagina che dice cosa è successo *dopo* invece di prevedere
- Solo Reddit — è dove stanno i lead veri ed è l'unica superficie da cui possiamo rileggere i commenti di un thread. Cron giornaliero (07:20), 25 lead per run, zero AI: è una rilettura e un confronto di testo
- Migration `0201` da applicare prima del deploy
## 2026-08-20

### La ripatchata partiva e non scriveva niente, e il thread era un paragrafo unico
Due difetti trovati sul primo turno reale dopo il muro, entrambi visibili nei dati.

**Il video restava quello sbagliato anche se il controllo lo aveva bocciato.** `motion_craft_scores` per l'ultimo video: craft 7.9 (**ship**), ma `reference_fidelity` **4/10**, tre beat su otto mancanti. Il giro di correzione è partito — c'è in `ai_calls`, quaranta secondi di turno — e `motion_videos.updated_at` è rimasto indietro rispetto a quella chiamata: **il turno non ha scritto una riga**. La causa è una clausola del prompt che elencava i tipi di brief per nome: *"When the user message is a MOTION CRAFT QC or SELLABILITY QC brief… a text reply without a source change is a failure"*. Il brief di fedeltà si chiama `REFERENCE FIDELITY FAILED` e non era in quell'elenco, quindi l'obbligo non lo copriva: l'agente ha risposto a prosa, ha chiamato `finish`, e il QC si è fermato su `qc_apply_noop`. Ora la clausola copre **qualunque** brief di QC, nomina la fedeltà, e dice esplicitamente che chiudere con `finish` senza aver scritto è lo stesso fallimento con un finale più elegante.

**Il thread era un paragrafo unico senza tool call.** Salvavo il testo accumulato e basta, quindi ogni riga di stato che l'agente scrive *prima* di una chiamata finiva incollata alla successiva: *"Studio un riferimento…Leggo il brand studio…Scrivo la composizione…"*, e le chiamate sparite. `saveMessages` supportava già testo e tool call **in ordine** — gli passavo una stringa. `textLen` dice quanto era lungo il transcript quando ogni chiamata è partita, quindi le chiamate si reinfilano fra le righe che le hanno introdotte. Il thread adesso mostra la forma del lavoro invece di nasconderla.

Resta scoperta l'anteprima del video nel thread: la card di preview della chat è modellata sui post (`post_id`, `platform`, `caption`) e un motion video non è un post — serve un tipo di preview nuovo lato renderer, ed è lavoro a parte.

## 2026-08-20

### Lo studio Motion smette di inventare la UI del prodotto
L'agente dello studio aveva **quindici tool** contro i sessantatré dello specialista `motion` nella chat. È il motivo per cui disegnava a mano interfacce che avrebbe potuto fotografare e scriveva claim che avrebbe potuto leggere: le craft specs pretendono "mockup UI programmatici di ogni feature" e lui non aveva modo di procurarsi la UI vera.

Adesso prende il set di quell'agente — stesso specialista, stesse capacità — meno tre gruppi che su questa superficie sono sbagliati, e la lista è commentata uno per uno invece di essere una scelta implicita:

- **I tool sorgente che prendono un id.** Lo studio ha i suoi `write_source` / `replace_source` / `set_title`, legati alle tile selezionate per il turno e alle regole di canvas e reflow che ha impostato il picker. `write_motion_source(video_id)` le scavalcherebbe tutte e lascerebbe modificare una composizione che nessuno ha selezionato
- **Le affordance della chat che il workbench non sa disegnare.** `ask_user_questions` mostra opzioni cliccabili nella chat e **niente** qui: il modello chiederebbe e l'utente non vedrebbe mai la domanda. Un tool il cui output la superficie non renderizza è peggio di un tool assente
- **Il pacchetto SEO.** Sette endpoint DataForSEO, gli audit e le letture del blog non possono informare un kinetic ad da sei secondi: stanno nel set condiviso per comodità della chat, e qui sarebbero solo schema nel context

Quello che guadagna, in concreto: **`capture_website` e `harvest_product_ui`** — la UI vera del prodotto invece di un'approssimazione disegnata a mano — più le letture di post, prodotti, persone e brand kit, gli allegati, `review_video` e i consulti agli altri specialisti. E il prompt li **nomina**, perché un tool disponibile e non pesato è un tool che il modello salta (lezione di stamattina).

Un test tiene ferma la differenza fra le due superfici, così non torna a scivolare a quindici contro sessantatré — e verifica anche che ogni nome nella lista di esclusione sia un tool vero: un refuso escluderebbe silenziosamente nulla.

## 2026-08-20

### La reference smette di essere un suggerimento che nessuno verifica
Il muro consegnava all'agente una scaletta di beat e **niente controllava che quella scaletta arrivasse dentro l'MP4**. `craft-review` giudica quanto è ben FATTA la clip — easing, transizioni, tipografia, se qualcosa si blocca prima di un taglio — e spedirebbe volentieri una composizione impeccabile che con la reference studiata non c'entra nulla. Che è esattamente com'è apparso da fuori: l'agente chiama il tool, guarda una clip, e il risultato non cambia di una virgola.

- **Terzo giudizio nel QC**, fra il craft e la sellability: guarda la clip finita con davanti la scaletta studiata e dice, beat per beat, se c'è qualcosa che fa **lo stesso mestiere** in quel punto della sequenza — `present`, `altered`, `missing` — e se l'ordine ha tenuto
- **Il punteggio lo calcoliamo noi**, non lo chiediamo al modello: presente 1, alterato ½, mancante 0, meno un punto se la sequenza è saltata. Un modello che sceglie anche il numero tende a riconciliarlo con la propria prosa invece che con quello che ha visto
- **Giudica il RUOLO, mai l'artwork.** Stesso mestiere con altri colori e altro logo = presente. Ed è per questo che il controllo non spinge verso la copia: quello che deve sopravvivere è la forma, non l'aspetto
- **Un beat `[OUT OF REACH]` che manca non è un errore, è obbedienza.** La spec aveva detto di sostituirlo o toglierlo; contarlo come mancante rispingerebbe l'agente a tentare render 3D in Remotion. Contano solo i beat raggiungibili, e sono il denominatore del punteggio
- **Sotto 6 si ripatcha**: il brief nomina i beat che non sono atterrati con il secondo per cui erano previsti, dice se l'ordine è saltato, e ricorda che i beat fuori portata non c'entrano
- **Il voto finisce accanto a quello di craft** (`motion_craft_scores`, migrazione 0200, già applicata). Nullable per costruzione: quasi tutte le composizioni nascono senza muro, e per quelle non c'è nessuna fedeltà da misurare — assente non vuol dire zero
- Costa una chiamata vision in più **solo quando il muro è stato davvero usato**

## 2026-08-20

### Quello che fai nelle pagine dei maker adesso è una chat come tutte le altre
Motion Video, Media Generator e la corsa UGC streammavano il loro lavoro in un workbench e poi se lo dimenticavano: niente in sidebar, niente da riaprire, e la volta dopo che parlavi con l'agente non sapeva nulla dell'ora che avevi appena passato a costruire.

- **Ogni turno apre un thread normale** (`chat_threads.surface` + `surface_key`, migrazione 0199) con il brief come primo messaggio e la risposta dell'agente come secondo. Compare nella sidebar globale mentre il lavoro sta ancora streammando — che è quello che serve se chiudi la scheda a metà
- **Il thread porta con sé il suo specialista.** Riaprendolo dalla chat risponde `motion`, `ugc` o `media` — stessi tool, stesse regole di mestiere — non il generalista
- **Un thread per cosa che stai costruendo**, non uno per richiesta: un secondo turno sullo stesso video continua la stessa conversazione invece di aggiungere una riga alla sidebar ogni volta che scrivi. Una composizione che ancora non esiste apre un thread senza chiave, e la chiave gliela dà il salvataggio
- **Niente è stato toccato del motore.** I turni tengono la loro catena di continuazione e il loro mirror sullo stream: quello che cambia è solo che la conversazione viene scritta dove vivono tutte le altre. Aprire e chiudere il thread sono best-effort per costruzione — un turno creativo non deve mai fallire perché non è atterrata una riga
- **Il workbench capisce entrambi i vocabolari.** Le stesse operazioni arrivano con due nomi — `write_source` dall'agente dello studio, `write_motion_source` dal registry chat, perché lì non c'è una selezione e serve un id. Un thread aperto nel workbench e ripreso nella chat continua a muovere la gallery

## 2026-08-20
### Il radar aveva la banca dati e nessuno l'aveva mai vista: `/trending` e `/design`
`market_posts` raccoglie da mesi il lavoro migliore che gira sui social — media archiviato, categoria decisa dal modello, outperformance contro la mediana dell'account — e la 0181 dice in testa che *"nothing here is user-facing"*. Vero per la tabella. Ora due pagine pubbliche aprono una fetta stretta e marcata a mano di quelle righe, in `en · it · es · fr`.

- **`/trending` ordina per outperformance, non per like.** È la differenza fra le due pagine e il motivo per cui la prima è interessante: un like conta la dimensione dell'account, non il post (primo paragrafo di `market-metrics.ts`). Uno studio da 2.000 follower che fa 4× la sua media sta nella stessa griglia di un brand globale
- **`/design` ordina per un voto grafico che prima non esisteva.** `quality_index` valuta il **testo** con lo stesso rubric delle nostre caption, il giudice video guarda hook e ritenzione: nessuno dei due ha mai guardato un layout. `design-judge.ts` è una colonna, una versione e un rubric a parte — infilarlo dentro `quality_index` avrebbe cambiato in silenzio il significato di ogni fit esistente
- **`is_design` conta quanto il voto.** La banca è in gran parte UGC filmato, e la foto di un piatto non ha tipografia da giudicare: un rubric costretto a produrre un numero lo produce. `false` è la risposta onesta per la maggioranza delle righe, ed è l'unica cosa che impedisce a un muro di design di riempirsi di istantanee competenti
- **La curazione è automatica, quindi la sicurezza è un campo giudicato.** Nessuno approva una card prima che vada online: `publishable` risponde a "lo metteremmo sulla nostra home?" nella stessa chiamata, il motivo resta sulla riga, e nel dubbio è `false`. La soglia grafica è `WALL_MIN_DESIGN_SCORE`, e il suo default è **calibrato sul giudice**: 72 sembrava giusto in astratto, poi su trenta post veri niente ha superato 72 (il rubric stesso dice al modello che il lavoro competente sta fra 55 e 70) e pubblicava una card su trenta. 68 è il tetto del cluster osservato; si alza quando la banca è più profonda
- **La nota esce in tutte e quattro le lingue dalla stessa chiamata.** Una frase tradotta non costa niente accanto ai token dell'immagine; generarla dopo vorrebbe dire rimostrare al modello un'immagine che ha già guardato e pagato

### Il corpus del muro non poteva venire dagli hashtag
`market-trends` scopre per hashtag: strumento giusto per la sua domanda, sbagliato per questa. Un hashtag mostra ciò che è **popolare**, e il design non è popolare — `#arredamento` restituisce mille foto competenti fatte col telefono e zero manifesti, e nessuna soglia estetica salva un corpus che non contiene niente di bello.

- **`design-discovery.ts` è curato a livello di account**: prodotto, studio, testata, spazzati a rotazione deterministica (giorno dell'anno, non a caso: un account mancante è un bug, non sfortuna). La lista **è** il gusto del muro ed è scritta in codice — fingere che l'abbia scelta un algoritmo sarebbe una bugia su una decisione nostra. Override senza deploy con `WALL_DESIGN_ACCOUNTS`
- **Beneficio secondario gratis**: passa da `fetchProfileHistory`, quindi ogni account è `HISTORY_CAPABLE` per costruzione e ogni post arriva etichettabile — successi *e* flop. Il corpus del muro è anche un campione non distorto, cioè esattamente quello che `market-harvest.ts` dice non essere il pool scoperto

### Le gif sul muro non le fa il server quando arrivi
L'archivio sta in un bucket **privato**, signed URL, sorgenti fino a 64MB: un URL firmato scade (quindi la pagina non è cacheabile, e il crawler che l'ha salvato prende un 400) e un sorgente da 64MB non è una thumbnail. Il muro tiene le sue derivate in un bucket **pubblico**, costruite una volta da un worker e servite come file statici immutabili — il percorso di richiesta non firma, non transcodifica e non legge il DB per i byte.

- **L'anteprima animata è una WebP dentro un `<img>`, non un `<video>`**: un `<img>` non ha policy di autoplay da perdere (una griglia dove un terzo delle card non si muove sembra rotta), 24 `<video>` sono 24 pipeline media, e WebP pesa circa un quarto della GIF a parità di dimensione. 360px · 10fps · 2,5s ≈ 200–400KB, numeri misurati: la prima versione puntava a 150–400KB e su clip vere ne faceva 390–750KB
- **E si scarica solo all'intenzione**: la `src` dell'anteprima si imposta quando il puntatore entra nella card, quindi chi scorre senza fermarsi non paga il movimento che non ha chiesto. `prefers-reduced-motion` la toglie del tutto
- **Fallback GIF** quando il build di ffmpeg risolto a runtime non ha libwebp: quattro volte i byte, ma un'anteprima — e l'estensione sulla riga dice quale delle due è arrivata, invece di far sembrare uguali "statico" e "non ce l'ha fatta"

### Tre cancelli e un interruttore, perché una pagina pubblica non perdona
Le pagine non toccano mai `market_posts`: chiamano `wall.ts`, che seleziona colonne nominate e costruisce la card campo per campo. Una colonna aggiunta alla tabella il mese prossimo non può trapelare — va aggiunta alla proiezione apposta, e c'è un test che lo verifica.

Ogni query passa da `wall_state <> 'hidden'` (la leva di rimozione, un `UPDATE` di distanza, batte tutto), `design_publishable` e "il poster esiste". `forced` salta **solo** il punteggio, mai gli altri due: un pin manuale è un override di gusto, non una licenza.

Il lavoro è di chi l'ha fatto: handle, didascalia troncata, link all'originale (`author` e `creditText` anche nello structured data) e il nostro commento. Il link in uscita è il punto, non una cortesia. Chi vuole essere tolto scrive a `WALL_REMOVAL_EMAIL` e sparisce da ogni superficie, sitemap inclusa. `posts-design.ts` — che legge **il loro** muro come reference on-demand per Motion — resta intoccato: il muro pubblico si costruisce solo sul nostro harvest.

- **Paginazione a link veri** (`?page=N`, renderizzata server-side): un infinite scroll nasconderebbe il 90% del corpus all'unico visitatore che conta per una pagina di traffico
- **Cron**: `/api/v1/wall/sweep` (07:10) e `/api/v1/wall/work` (*/15) — derivate, giudizio, pubblicazione in un tick solo, con deadline divisa a metà perché venti clip da transcodificare non si mangino il budget e il muro non guadagni mai una card
- Migration `0199` da applicare prima del deploy. Documentazione: `docs/38-public-wall.md`

### Gli strumenti scrivevano su tabelle che li rifiutavano
`motion_video_references` e `motion_craft_scores` sono strumenti interni: RLS acceso, nessuna policy, la stessa postura di `ai_calls` e `market_posts`. Ma le due funzioni che ci scrivono prendevano il client **del chiamante**, che su ogni strada reale è quello della richiesta — quindi ogni insert tornava `42501 new row violates row-level security policy`, il catch best-effort se lo mangiava, e le tabelle restavano vuote.

Per un giorno intero di uso vero: quattro chiamate `motion.reference_study` andate a buon fine in `ai_calls`, e zero righe di provenienza. Una tabella vuota si legge come "nessun segnale", non come "strumento non collegato" — che è peggio del non averla.

Ora entrambe costruiscono il proprio admin client. Test di regressione sulla forma della chiamata, perché la classe di bug è "ha usato il client sbagliato senza dirlo".

### LinkedIn: il 404 che significa "nessun risultato"
Primo tick del radar dopo i fix di stamattina, forzato su anomalia. Gli errori adesso si vedono — ed è saltato fuori subito che la ricerca LinkedIn risponde **404 `not_found` con zero crediti addebitati** quando nessun post corrisponde alla query. Un insieme vuoto vestito da errore.

La prova che non è un guasto: nello stesso momento il catalogo globale conteneva 15 post LinkedIn presi dallo **stesso** endpoint quella mattina, e il giorno prima la stessa query dinamica ne aveva restituiti 2.

`isNoMatch404` riconosce solo quel corpo — non un 404 qualsiasi, perché un path sbagliato o un endpoint rimosso devono continuare a urlare — e restituisce zero risultati lasciando traccia nei log. Senza questa distinzione la cronologia scan segnerebbe rosso una condizione normale: che è esattamente l'errore opposto a quello tolto stamattina, gridare al lupo invece di tacere.

## 2026-08-20
### Gli agenti che fanno il lavoro leggono quello che legge la chat
Motion Video, il Media Generator e il pianificatore UGC sono i tre agenti che producono davvero, e ognuno era stato assemblato a mano con quello che serviva al suo autore quel giorno. Risultato: Media Generator e UGC potevano andare a vedere **cosa fa il prodotto** (`read_brand_studio`, `read_knowledge`), Motion Video no — l'agente che costruisce un video di **lancio** conosceva palette e logo e non aveva modo di scoprire cosa si stava lanciando. E nessuno dei tre poteva leggere il catalogo di mercato settimanale o verificare un fatto sul web, due cose che la chat ha da mesi.

- **Un solo posto** (`chat/brand-context-tools.ts`) definisce `read_brand_studio`, `read_knowledge`, `read_market_references` e `search_web`, e si spande dove serve — stessa mossa che `createMediaLibraryTools` aveva già fatto per la libreria multimediale. I due tool che due agenti su tre avevano erano dichiarati **due volte**, separatamente, con descrizioni che stavano già divergendo
- **Solo letture, di proposito.** Parità qui vuol dire la superficie di *contesto*, non tutta la chat: quella approva post, pubblica, riscrive il brand kit e legge la fatturazione. Un agente il cui mestiere è montare una composizione non ha motivo di tenere quelle leve, e dargliele trasformerebbe un brief frainteso in un post pubblicato
- **Il prompt li nomina** in tutti e tre (`brandContextPromptSection`), perché un tool disponibile e non pesato è un tool che il modello salta — lezione della shortlist di stamattina

### Il motion della chat non era lo stesso motion
Chiedere "fammi un video" dalla chat del brand passava da `chat/motion-video-tools.ts`, un'implementazione **separata** che scrive il TSX da sé e non tocca mai `runMotionVideoAgent`. Due conseguenze, entrambe corrette:

- **Le regole di craft erano una copia parafrasata a mano** dentro il system prompt della chat. Due copie della stessa dottrina, e quando `craft.ts` cambiava la copia nella chat restava indietro — drift già maturo. Ora la chat interpola `MOTION_CRAFT_SPECS`, la costante vera
- **Il muro di riferimenti ora c'è anche lì.** Con `attachMedia: false`: quella chat può essere servita da DeepSeek quanto da Gemini, e un provider senza visione riceverebbe della prosa che gli descrive un'immagine mai arrivata. La spec scritta si legge uguale ovunque; il degrado silenzioso non è tra le opzioni
- **`referenceHotlink` è applicato anche su quella strada**, dentro `persistCompiled` — l'imbuto da cui passa ogni scrittura di sorgente Remotion della chat. Adesso che la chat vede il muro, può anche provare a linkarne il media: non può

### Field watch: cosa gira nel campo di ogni brand, smontato e messo a disposizione di tutti
Il Radar risponde a "a cosa deve reagire il brand oggi". Mancava la domanda lenta: **come comunica chi, nel campo di questo brand, sta ottenendo attenzione adesso** — che formati usa, con che tono, cosa ha fatto perché il post girasse, e quanto di quella spinta è ragebait invece che valore.

Tre strumenti guardavano già fuori e nessuno rispondeva: l'harvest di mercato scopre su 12 verticali **fisse** e serve a tarare il rubric; le market references partono dagli handle dei competitor **già noti**, quindi non vedono mai chi sta sfondando e che nessuno ha schedato; i trend guardano i feed trending, che per definizione non hanno campo.

- **La scoperta parte dal brand.** `ensureFieldTopics` deduce dal brand kit 3 query e 2 hashtag — il campo, non il prodotto: chi parla a quel pubblico di quei problemi, anche se vende altro. Si riscrivono al massimo una volta al mese: i campi cambiano lentamente. Poi si cerca su Threads, Reddit, LinkedIn e TikTok con le query, e su Instagram con gli hashtag (lì l'hashtag **è** il verticale, una frase no)
- **Il catalogo è globale.** I post finiscono in `market_posts`, deduplicato su platform+external_id come tutto il resto; per-brand resta solo il legame (`brand_field_posts`) con la query che l'ha trovato. Due brand nello stesso campo trovano lo stesso post e lo paghiamo una volta sola — e il teardown, che è la parte cara, vale per entrambi
- **Sul denominatore siamo onesti.** L'harvest etichetta `outperformance` = engagement ÷ mediana dell'account, e quella è la misura vera di "virale". Qui costerebbe una chiamata a profilo per ogni account scoperto, quindi ordiniamo per **engagement grezzo dentro il pull della settimana** e lo chiamiamo con il suo nome: "i più visti che il campo ha restituito", non "i post che hanno battuto il loro autore". Quando un account entra comunque nelle baseline globali, l'etichetta arriva gratis: il post è la stessa riga
- **Il teardown descrive come si comunica, non di cosa si parla** (`market_teardowns`): tono di voce in due parole, registro e ritmo, formato, tipo di apertura, e soprattutto le **leve di diffusione** — chiama in causa una categoria, chiude invitando a dissentire, screenshot che si salva, promette un seguito. Un post senza testo né trascrizione non viene smontato: non si inventa un teardown sul vuoto
- **Il ragebait si misura e si usa.** Punteggio 0-10 per post, non come giudizio morale ma come dato operativo. Il playbook porta a chi scrive la **temperatura del campo**: sopra 6 dice esplicitamente che qui prendere posizione funziona — senza mentire e senza attaccare persone o concorrenti per nome; sotto, che alzare i toni suona fuori posto e la spinta arriva da utilità e specificità. Ogni mossa porta il proprio livello, così chi scrive sa cosa sta prendendo in mano. **I guardrail del brand vincono sempre**: una mossa che collide con "MAI USARE" finisce fra le cose da non prendere, citando il guardrail
- **Il playbook entra dove si scrive davvero.** Vive sulla riga `brand_market_references` accanto alle reference dei competitor, quindi `formatMarketBrief` lo rende e i due consumatori esistenti — il planner e l'agente di produzione — lo ricevono senza un nuovo canale di iniezione
- **Cadenza e tetti**: cron giornaliero dedicato (`/api/v1/market/field`, 06:50) con 3 brand per run — ogni brand resta su cadenza settimanale, ma con ~21 passate a settimana nessuno aspetta il proprio turno per un mese. Sta fuori dal tick delle market references di proposito: quello richiede competitor con handle, e il field watch serve soprattutto quando mancano. 10 post legati e 8 teardown nuovi per run, solo piani a pagamento, circa $0.03 di ricerche per brand a settimana
- **Superfici**: pannello "Campo" in `/app/[brand]/competitors` con le mosse, la temperatura e i post catalogati con il loro teardown, più `GET/POST /api/v1/brands/:slug/market/field`
- Migration `0198` da applicare prima del deploy. Documentazione: `docs/37-field-watch.md`

## 2026-08-20

### Il muro di riferimenti non veniva usato: adesso il turno arriva già con la lista
Primo brief vero dopo il merge: `read_source` → `read_media` → `write_source` → `finish`. Zero ricerche di reference. I tool c'erano, il deploy era live, e il modello li ha ignorati.

Non era un bug nei tool, era il **peso del prompt**: `read_media` è imposto **quattro volte** nello stesso system prompt (descrizione del tool, blocco di modalità, workflow, e dentro `generate_image`), sempre all'imperativo. Il muro era nominato una volta, e come "worth doing". Il modello ha fatto esattamente quello che il prompt pesava.

Urlare più forte era la soluzione debole. La libreria multimediale aveva già risolto lo stesso problema anni fa mettendo il **catalogo dentro il prompt** (`loadMediaLibraryPromptSection`) e lasciando `read_media` per il raffinamento — così il modello non deve mai *decidere di andare a cercare*. Stessa cosa qui:

- **Sui turni di CREATE il muro viene cercato prima che l'agente parta**, con il brief dell'utente come query, e la shortlist entra nel prompt. La ricerca è gratis (nessuna clip scaricata, nessuna chiamata al modello) e sul campo costa ~2s. Timeout a 6s e fallback a stringa vuota: un sito terzo lento o giù non tiene aperto un turno creativo, gli costa zero
- **Resta solo la decisione che conta**: quale guardare. `study_motion_reference` sul candidato più vicino, `search_motion_references` solo se nessuno dei sei calza
- Sui turni di EDIT non si cerca niente: una reference serve a decidere cosa costruire, non a ri-deciderlo mentre si patcha
- Verifica su un brief reale ("video di lancio degli Anomalia Agents"): la shortlist tira su Cursor cloud agents, Venice private agents, Vercel Ship London agents, bolt.new Design System Agents e la Raycast Cursor Agents extension. Cinque su sei a tema, in 2,1 secondi

### Radar/Leads: X, LinkedIn e Threads erano fermi in silenzio
Tre sorgenti su cinque non producevano un solo lead, e nessuna di loro lo diceva. Il pattern era sempre lo stesso: il fetcher inghiottiva l'errore con un `catch { return [] }`, e `radar_searches` registrava un successo pulito con zero item — indistinguibile da "oggi non c'era niente di interessante".

- **X**: `fetchXCommunityTweets` chiamava ScrapeCreators con `?id=<community>`, ma l'endpoint documenta `?url=`. Ogni scan falliva e riportava zero. Ora la URL viene costruita dall'ID (e un URL incollato per intero viene accettato lo stesso), e un valore senza ID dentro dà un errore che dice cosa manca
- **LinkedIn**: `linkedin_query` esisteva nella UI, nel gate di piano e nel codice di ricerca, ma **non nel CHECK constraint** di `brand_news_sources.kind` — salvare una sorgente LinkedIn falliva con un 23514. E anche se fosse passata, `fetchSourceFeed` non gestiva quel kind: la sorgente cadeva su `fetchFeed`, che scaricava le *keyword* come se fossero un URL RSS. Migration `0197`, più il ramo mancante
- **Threads**: la finestra di freschezza era 12h per tutti. È giusta per Reddit (`rising` significa adesso), ma Threads, X e LinkedIn ordinano per rilevanza, non per data — Threads non ha nemmeno un filtro temporale — e i loro post restano vivi per giorni. Il taglio a 12h buttava via quasi tutti i risultati. Ora `CONVERSATION_MAX_AGE_HOURS = 48` per quelle tre piattaforme, applicata sia alle sorgenti salvate sia alle ricerche dinamiche
- **Gli errori adesso si vedono**: i fetcher li propagano, `radar_searches` li registra e la cronologia scan in `/radar` mostra il messaggio accanto alla sorgente rossa invece di un solo `✕`
- **Nuovo `GET /api/v1/brands/:slug/radar/diagnose`**: interroga dal vivo ogni sorgente configurata (niente cache) e dice cosa ha restituito, o perché è stata saltata — sorgente spenta, gate di piano, toggle di piattaforma, errore dell'endpoint. Read-only: nessuna AI, nessuna scrittura
- **LinkedIn mancava anche dalla pagina Leads**: `platformOf` non lo conosceva, quindi un lead LinkedIn si presentava con l'icona di Reddit e non era filtrabile
- Corretto anche il fetch del thread in `radarEngage`: il fallback RSS di Reddit girava per **tutte** le piattaforme e sovrascriveva con il vuoto il corpo del post che ScrapeCreators aveva appena restituito. Ora è ristretto a Reddit e parte solo se il primo tentativo è andato a vuoto

### Leads: l'intento d'acquisto è separato dalla rilevanza
La rilevanza risponde a "questo brand ha qualcosa di utile da dire qui"; l'intento risponde a "questa persona sta comprando". Divergono di continuo: un thread che chiede *quale strumento usate per X* e uno che si lamenta di X prendono la stessa rilevanza e non sono lo stesso lead.

- Nuovo campo `intent` nel verdetto — `seeking_now` / `comparing` / `researching` / `venting` / `none` — con `INTENT_RANK` che ordina il set scelto e la coda di `/leads`, che prima ordinava per data e seppelliva una richiesta esplicita sotto un giorno di chiacchiere
- Il drafter lo legge e cambia registro: a chi chiede una soluzione si può indicare qualcosa, a chi si sta sfogando si risponde aiutando e basta — niente link, DM vuoto
- Badge sulla card (verde per chi chiede adesso), in it/en/es/fr

### Profili di community: la memoria che al Radar mancava
Il drafter scriveva ogni risposta conoscendo solo il brand e il thread davanti a sé. È il motivo per cui le reply suonavano genericamente competenti: r/smallbusiness e r/entrepreneur si somigliano da fuori e le persone dentro non si somigliano per niente.

- Nuovo `brand_community_profiles` + `src/lib/server/community-profile.ts`: un profilo vivo per community — chi sono, **le frasi esatte** che usano per il problema, cosa hanno già provato e perché ha fallito, cosa viene premiato e cosa sepolto, cosa i mod rimuovono, la forma di un post lì dentro, con un changelog datato
- Costruito **dagli item già raccolti**: zero fetch aggiuntivi, solo la chiamata di scrittura. Reddit ha un profilo per subreddit; Threads/X/LinkedIn arrivano da ricerche per keyword senza una community stabile dietro, quindi ne hanno uno per piattaforma
- Auto-limitato: si riscrive una community solo se ha almeno 5 item nuovi e il profilo ha più di 20h, al massimo 3 per run — con 4 tick al giorno sono fino a 12 community, una chiamata piccola ciascuna
- Due consumatori: `radarEngage` inietta il profilo intero nel prompt della bozza (usa le loro parole, rispetta cosa viene rimosso, non riproporre ciò che li ha già delusi) e `radarScan` inietta il digest del vocabolario nel giudice di rilevanza, così riconosce il problema formulato come lo formulano loro
- Il drafter riceve anche più contesto di brand: 800 caratteri di `about` e 2500 di `ai_context` invece di 300 e 1200, più la regola esplicita di non promettere ciò che il prodotto non fa

Il retroterra di queste tre voci è in `docs/36-leads-gen-playbook.md`: cosa abbiamo preso da una guida pubblica sui sistemi di vendita su Reddit, cosa abbiamo scartato (comprare account con karma, proxy rotanti) e cosa resta da fare — post nativi nelle community con pre-check delle regole, loop di esito sui lead già mandati, rollup settimanale dei problemi ricorrenti.

## 2026-08-20

### Motion Video vede le reference con i propri occhi, e sa cosa può davvero costruire
Tre aggiunte al muro di riferimenti, tutte nate dalla stessa domanda: questa roba migliora davvero i video, e come facciamo a saperlo.

- **L'agente principale guarda la clip, non la legge.** `study_motion_reference` allega le immagini — e su richiesta il video intero — **dentro il tool result**, che il provider Google trasforma in `inlineData` veri sulla function response. Quindi il modello che scrive il TSX è il modello che ha guardato la cosa. La sub-chiamata vision resta e continua a scrivere la spec, perché è la parte che si **mette in cache**: una scomposizione testuale sono 2KB e da lì in poi è gratis, mentre i pixel vanno rispediti a ogni step del turno. Una legge con una rubrica e persiste, l'altro sono gli occhi dell'agente: non sono ridondanti
- **Cosa cavalca, e quanto costa.** Di default quattro still (un paio di centinaia di KB, limite fisso). La clip intera è opt-in (`watch="clip"`) e **una sola per turno**, perché un tool result da lì in poi fa parte della conversazione: risale a ogni step successivo, e ce ne sono fino a 64. Quello è il budget vero, non la chiamata vision. Il video nel tool result arriva solo a Gemini 3 — sui modelli precedenti il provider lo trasformerebbe in prosa JSON, quindi viene **rifiutato esplicitamente** dicendo perché, invece di degradare in silenzio
- **La spec dice cosa è costruibile.** Ogni beat è etichettato `[code]`, `[code + 1 still]` o `[OUT OF REACH]` (render 3D, girato, camera che vola dentro una scena reale, motion tracking). Non è pignoleria: il muro è **pieno** di roba irraggiungibile in Remotion, e un agente che insegue un beat che non può fare consegna un'imitazione rotta di una cosa irraggiungibile — peggio della composizione generica che avrebbe scritto da solo. La verifica sul campo: il post Cerebras è **8 beat su 8 fuori portata**, e la spec ora chiude dicendo "ignora questa reference e prendine un'altra"; il post OpenRouter è 1 su 1 in puro codice. Un beat non etichettato vale `out_of_reach`, mai il contrario
- **I voti di craft adesso si salvano** (`motion_craft_scores`, migrazione 0195). `qc.ts` dà un voto a ogni clip che renderizziamo da quando esiste — craft, content, pleasant, transitions, 1–10 — e li buttava via a fine turno; in `ai_calls` restava la latenza del giudice e non il suo giudizio. Quindi l'unica domanda che si fa davvero su un cambiamento al generatore — è migliorato l'output? — non ha mai avuto una risposta disponibile, per nessun cambiamento. Ora ogni voto viene scritto accanto a **da cosa è stato costruito** il video (`motion_video_references`): reference studiate contro nessuna reference, prima bozza contro versione ripatchata. Il muro è il motivo immediato, ma la tabella non ha niente di specifico per lui — qualunque modifica futura al prompt, al modello o alle regole di craft esce di qui con un prima e un dopo

### Motion Video: il muro di riferimenti (posts.design) dentro il turno dell'agente
Fino a ieri il gusto di ogni motion che spediamo era `MOTION_CRAFT_SPECS`: 34 righe scritte a mano, congelate. Buone righe — ma una costante, non un'osservazione. Ora l'agente può andare a **guardare** come il genere del brief viene fatto davvero questa settimana, scegliere una reference e costruire da quella.

- **Perché posts.design e non l'harvest che avevamo già.** `market-trends.ts` scopre Reel e TikTok: UGC, girato, sound-on. Niente di quello che generiamo assomiglia a quella roba — Motion Video fa kinetic ad in Remotion, e il corpus di *quel* mestiere è il post di lancio: una card, una registrazione di prodotto, tipografia in movimento, sei secondi, nessuna faccia. posts.design è un muro curato esattamente di quelli, dagli account che fissano l'asticella
- **Due tool, non uno.** `search_motion_references` costa zero (nessuna clip scaricata) e restituisce cartoncini: brand, categoria, tag di stile, cosa diceva il post, se si muove. `study_motion_reference` **guarda** una clip e restituisce la struttura: beat con i tempi, il meccanismo di transizione fra un beat e l'altro, l'easing, quanta tipografia c'è a schermo insieme, cosa fa il logo, quale UI è programmatica. Cercare per capire cosa si sta guardando avrebbe bruciato il turno intero: i cartoncini bastano a scegliere, e solo i due o tre che potrebbero funzionare vengono visti
- **Passa il testo, non i pixel.** La spec è ripulita da ogni URL prima di tornare all'agente, e `referenceHotlink` rifiuta qualunque sorgente che contenga `posts.design` in scrittura. Non è pignoleria: il modello le frame le ha viste nel proprio contesto e sa scrivere un `/media/posts/…` plausibile dal pattern — e quello, a differenza di un URL inventato, **caricherebbe**, quindi il controllo "questa immagine esiste?" lo lascerebbe passare e ci ritroveremmo la announcement card di qualcun altro dentro un MP4 che pubblica un brand nostro
- **La postura di compliance è un vincolo di progetto, non un disclaimer.** posts.design serve `Content-Signal: search=yes,ai-train=no,use=reference` e lo dichiara come riserva espressa ex Art. 4 della Direttiva (UE) 2019/790; e i post non sono suoi, sono lavoro di terzi curato. Quindi: niente training, niente archiviazione del media (`market-media.ts` archivia le clip dell'harvest ed è deliberatamente **non** usato qui — la clip si guarda e si butta), nessun URL passato al modello, e l'attribuzione — brand, handle, post originale, pagina di riferimento — viaggia in testa a ogni spec. Quello che prendiamo è la struttura, che è poi la cosa che un direttore prende da una reference comunque
- **Nessun gate per categoria.** Il muro è disponibile a ogni brand su ogni turno: serve solo il nome del brand, non dati del brand. `FEATURE_MOTION_REFERENCE_WALL=false` toglie di mezzo tutta la feature
- **La reference non eroda il mestiere.** Molti di questi post durano 20–30s e staccano duro fra le scene. La spec chiude sempre con due regole: rifai la **forma** dei beat sulla durata che ti è stata chiesta (un brand film da 30s non diventa un ad da 6s andando più veloce), e dove la reference viola DEFAULT CRAFT — stacco secco, freeze prima del taglio, easing lineare — si fa a modo nostro
- **Costi e cache.** Una visione è una chiamata vision Flash (~15s sulla clip intera con still estratti); massimo 4 per turno, e le reference già viste tornano gratis e istantanee da `motion_reference_specs` (migrazione 0194 — un post curato non cambia mai, guardarlo due volte è puro spreco). Se la tabella manca il modulo funziona lo stesso, paga solo la visione ogni volta
- **Come lo leggiamo.** Nessuna API pubblica (`/api` è Disallow in robots e `/api/posts` fa 404): si legge lo stesso HTML che riceve un browser — `sitemap.xml` per l'indice completo (~440 post, ognuno col proprio stem da cui cadono fuori piattaforma, handle e id del post originale) e la pagina del post per tassonomia, copy e clip. Il parsing si appoggia ai metadati che il sito genera da sé (`og:title`, `meta description`, le figcaption `sr-only`) e non ai nomi delle classi, perché sono le parti di un template Next.js che cambiano meno. Quello che non si parsa diventa `null`: una reference col brand sbagliato attaccato è peggio di una reference con un campo in meno

## 2026-08-19

### Dottrina di marketing importata da marketing-os (MIT)
Dodici regole riprese da [Yuzzyuk/marketing-os](https://github.com/Yuzzyuk/marketing-os) e riscritte come moduli deterministici e testati. Il repo originale è una skill Claude Code fatta di solo markdown: il valore non era il software, era la dottrina — e nella nostra app vale di più che nella loro, perché noi non consegniamo un report, **agiamo**. Documentazione completa in `docs/35-marketing-doctrine.md`

- **Coverage-gating dei punteggi** (`coverage.ts`): quattro verdetti per segnale invece di due — pass/fail/**unknown**/na. Un unknown pesa sulla copertura, mai sul punteggio: convertirlo in fail gonfia l'urgenza, convertirlo in pass gonfia il voto, e le facevamo entrambe. Sopra l'80% di peso ispezionato il punteggio è pieno, fra 60 e 79 è provvisorio, sotto il 60 non si pubblica nessun numero. Tre bugie rimosse dove erano già in produzione: `article-score` dava alt come **fallito** a un articolo senza immagini (10 punti per una domanda che non si applica) e plagiarism/jsonld come **superati** perché nessuno li aveva mai controllati (11 punti regalati); `video-review` aveva due fallback in direzioni **opposte** nella stessa funzione — `scroll_stop ?? 1` trasformava un punteggio mancante in un kill, `offer ?? 10` in un via libera
- **Qualità dell'evidenza** (`evidence-quality.ts`): gerarchia a sei livelli, soglie di campione e trappole (peeking, survivorship, regressione verso la media, Simpson, finestra di attribuzione, stagionalità, metriche vanity, Goodhart). Conta per noi più che per un consulente: l'agente analytics legge i numeri e **riscrive il brief della settimana** — agire su cinque post e chiamare vincitore il primo cambia la strategia del brand sul rumore, ogni settimana in una direzione diversa. La lettura si dà comunque, con l'etichetta di confidenza: il reversibile (caption, slot, brief) si spedisce su un direzionale, l'irreversibile (prezzo, posizionamento) no
- **Diagnosi della fatigue creativa** (`ads-fatigue.ts`): tabella decisionale sul pattern congiunto CTR/CPM/CVR/frequenza. Stanchezza vera, pubblico esaurito, pressione d'asta, problema post-click e tracciamento rotto sono cinque cose che chiedono azioni opposte, e prima ogni decadimento invitava la stessa risposta ("nuove creatività"). Il tracciamento si controlla per **primo**: un pixel rotto è identico a un crollo creativo ed è molto più comune. La frequenza non ha soglie — 4 con CTR stabile va bene, 1.8 con CTR in calo è un concetto sbagliato
- **Funnel diagnostico** (`creative-funnel.ts`): thumbstop → visual, hold → parlato e rampa d'ingresso, CTR → offerta, CVR → landing. Si sistema **solo il primo stadio rotto**; sistemare un problema post-click con nuovi hook è lo spreco più comune del creative testing e da noi costa una produzione vera
- **Diciotto tattiche di hook + mappa di copertura** (`hook-tactics.ts`): con sette bucket un brand sembra coperto dopo un mese e il planner riscrive le stesse tre aperture chiamandola varietà. Ogni tattica porta con sé quella con cui viene confusa e come fallisce — senza la disambiguazione un modello ricollassa diciotto tattiche in domanda/claim/statistica in una settimana. Tre tattiche non sono rilevabili dal testo e il classificatore restituisce `null` invece di indovinare
- **Scala di fedeltà** (`production-ladder.ts`): il costo di produzione segue l'evidenza dell'angolo. `clampVideos` teneva i video che venivano **primi nell'array** — un budget allocato per posizione in una lista. Cold start non è piolo 1: senza storico non stiamo classificando, quindi non fingiamo di farlo
- **Cinque leve GEO** (`geo-levers.ts`): estraibilità 25, evidenza 25, entità 20, corroborazione 20, accesso macchina 10 — l'audit tecnico era il 100% del punteggio ed è il 10% della risposta. Più i segnali anti-citazione, il vincolo vincolante per perdita **pesata**, e ≥3 campioni per domanda (la citazione non è deterministica: n=1 si muoveva ogni settimana senza motivo). Menzione e dominio citato sono ora due numeri, perché hanno correzioni diverse
- **Disciplina delle prove** (`proof-discipline.ts`): mai statistiche, testimonianze o nomi di clienti inventati, nemmeno come segnaposto. Vietavamo già di inventare URL perché un link rotto è imbarazzante; un numero plausibile ma falso è peggio e non avevamo regole. Il marker `[NEED: …]` **blocca la pubblicazione**, e la correzione è fornire il dato — mai cancellare il marker
- **Metà negativa del brand context** (`brand-guardrails.ts`): cosa il prodotto NON fa, claim da validare, parole mai usate, la paura delle 2 di notte come **stato** e non come demografica, cosa userebbero senza di noi (incluso "continuare a mano", che nella maggior parte delle categorie è il vero leader di mercato)
- **Panel di copy a cinque prospettive** (`copy-panel.ts`): il copy chief era binario e lasciava passare tutto il centro competente-e-dimenticabile. Il test del concorrente — un rivale potrebbe incollarci il proprio logo senza cambiare una parola? — non lo faceva niente qui dentro. Fra 70 e 84 si itera su **una** obiezione; il totale viene ricalcolato dalle parti e si tiene il tentativo migliore, non l'ultimo
- **Tell strutturali e ritmo** (`content-quality.ts`, scorer v3): la lista lessicale vede solo le parole; i tell che un lettore riconosce per primi stanno nella forma. Il ritmo si misura come coefficiente di variazione delle frasi (umano ~0.4-0.6, macchina <0.25). Il registro non è slop: il test non è la formalità, è la vuotezza
- **Tre componenti dell'hook**: visual, parlato e testo a schermo non devono dire la stessa cosa. La non-duplicazione è applicata in codice, non solo nel prompt — una regola che nessuno verifica è un suggerimento
- **"Cosa non sono riuscito a determinare"** su piano SEO, weekly recap, audit GEO, review video e note dell'agente analytics. Un report che non dichiara i propri buchi si legge come completo quando non lo è

## 2026-08-19

### Chat: dettatura vocale al posto del tasto invio quando la textarea è vuota
- Il composer (pagina chat e overview) mostra un **microfono al posto di "invia" finché non c'è nulla da mandare**: appena scrivi qualcosa — o alleghi un'immagine, un video, un documento — torna il tasto invio. Un allegato conta come "c'è qualcosa da mandare", quindi il microfono non ruba il posto all'invio quando vuoi mandare solo una foto
- Durante la registrazione il tasto diventa uno stop rosso, accanto compaiono pallino pulsante e cronometro (al posto dell'anello di contesto) e una **×** per buttare via la presa; `Esc` dalla textarea fa lo stesso. Tetto di 2 minuti: alla scadenza la presa viene trascritta, non cestinata
- Il testo trascritto **si aggiunge** a quello che hai già scritto invece di sostituirlo, e il focus torna nella textarea
- Nuovo `POST /app/[brand]/chat/transcribe`: multipart (base64 in JSON gonfierebbe la clip di un terzo), autenticato con la sessione, dentro `withBrandContext` — la chiamata finisce sui crediti del brand come ogni altra azione AI. La clip **non viene salvata da nessuna parte**: va a Gemini Flash e muore con la richiesta
- `$lib/speech-to-text.ts` registra con MediaRecorder e **ri-codifica in WAV mono 16 kHz nel browser** prima di spedire: Chrome e Firefox registrano Opus-in-WebM, che non è tra i formati audio che Gemini accetta (wav/mp3/aiff/aac/ogg/flac). Un solo formato per tutti i browser invece di una matrice di container, e 2 minuti stanno in 3.84 MB — sotto il limite di body della funzione serverless
- Il microfono compare solo dove può funzionare: niente SSR, niente origine insicura (`getUserMedia` non esiste), niente browser senza MediaRecorder — in quel caso resta esattamente il composer di prima
- Il prompt di trascrizione impone verbatim, nella lingua parlata, senza rispondere alla dettatura; una risposta che comincia come una risposta invece che come una trascrizione viene scartata (meglio una casella vuota da rifare che una frase inventata incollata nel prompt)
- Copy in it/en/es/fr (`chat.voice.*`), con messaggi distinti per micro negato, browser non supportato, registrazione troppo lunga, nulla di comprensibile e trascrizione fallita

## v0.2.0 — 2026-08-18

### Benchmark interno dell'output
- Nuovo strumento **interno** per misurare la qualità di ciò che generiamo, così che ogni modifica a un prompt, a un modello o alla pipeline abbia un numero prima e un numero dopo. Non pubblica nulla: tabelle service-role, endpoint dietro `CRON_SECRET`
- Lo scorer (`src/lib/server/content-quality.ts`) è **deterministico** — zero AI, zero I/O, zero clock. Un giudice LLM è più ricco ma cambiandone il modello tutta la serie storica diventa incomparabile, proprio quando serve; costando zero, questo può essere ri-eseguito su tutto lo storico quando cambiano le regole, ed è quella proprietà che rende possibile un before/after onesto
- Nove check graduati 0..1 sui modi in cui un autopilot fallisce davvero: hook che collassa in un annuncio sul brand, boilerplate LLM (per densità, non per conteggio), auto-ripetizione rispetto ai post recenti del brand, perdita di specificità, CTA che sparisce, più le igieni di lunghezza/hashtag/emoji/leggibilità per piattaforma
- I confronti (`src/lib/server/benchmark.ts`) non restituiscono mai un delta nudo: delta + intervallo di confidenza al 95% + effect size, con `improved`/`regressed` veri **solo se l'intervallo esclude lo zero**. Si rifiutano di mescolare `scorer_version` diverse e sotto 20 campioni per lato rispondono `insufficient_data`
- Due modalità: il cron orario `/api/v1/benchmark/tick` campiona i post che hanno raggiunto uno stato impegnato (le bozze scartate non sono mai state il nostro output), e `POST /api/v1/benchmark/run` valuta gli stessi brief rigenerati prima e dopo una modifica — che è il confronto utilizzabile oggi, viste le dimensioni della flotta
- `correlateWithHumanSignal` correla l'indice con `revisions_count`: un utente che rigenera ci dice gratis che l'output non andava. Se la correlazione non è chiaramente negativa è il rubric a essere sbagliato, non il prodotto
- Migration `0180` (service-role, stessa postura di `ai_calls`). **Da applicare a mano**: i deploy non eseguono le migration

### Versionamento delle release
- Ogni build ha ora un tag `<semver>+<commit>` (es. `0.2.0+a1b2c3d4e5f6`): la metà semantica la bumpa una persona, la metà build è automatica dal commit. Esposto come `version` da `$app/environment` (`kit.version.name` in `svelte.config.js`) e usato come chiave dal benchmark
- Effetto collaterale utile: il default di SvelteKit era `Date.now()`, che cambiava anche quando il codice no — ora ridistribuire lo stesso commit non risulta più una versione nuova ai client collegati
- `npm run release -- patch|minor|major` bumpa `package.json` e apre la sezione datata nel CHANGELOG. Non committa, non tagga e non pusha: stampa i comandi, perché uno script che li esegue di sorpresa è il modo in cui una versione mezza finita finisce taggata
- Helper puri e testati in `src/lib/release.ts`. Nota sull'ordinamento: semver dice che i metadati di build non hanno ordine e il codice lo rispetta — due build della stessa versione risultano **pari**, e vanno ordinate per tempo, non per stringa

## 2026-08-17

### Chat: contesto pieno del modello su Starter/Pro, tetto 256k su free e Go
- La finestra che un thread può riempire prima di auto-compattarsi ora è `min(finestra del modello, tetto del piano)`: **free e Go 256k token**, **Starter/Pro (e scale legacy) la finestra piena del modello** — fino a 1M su DeepSeek/GPT, cioè ~4x di conversazione prima della prima compattazione
- `contextWindowFor(modelId, plan)` in `chat/compaction.ts` è ora consapevole del piano; `modelContextWindow(modelId)` resta il limite del provider (Grok override via `GROK_CONTEXT_WINDOW`). Il piano è passato dai tre call site di `maybeCompactThread` (chat streaming, `chat/queue.ts`, `/api/v1/chat/respond/run`)
- Gate di piano `hasFullChatContext(plan)` + `CHAT_CONTEXT_CAP_TOKENS` in `$lib/plans`, accanto agli altri gate: pricing e server leggono la stessa fonte
- Piano assente = free: un call site dimenticato accorcia il thread, non fa un 400 dal provider
- Nessun cambio a cosa vede l'utente: si compatta il contesto del modello, non la history — i messaggi restano interi e scrollabili su tutti i piani

### Chat: anello di utilizzo del contesto accanto al tasto invio
- Nuovo `ChatContextMeter.svelte`: anello da 16px nel composer con la % di finestra occupata, tooltip con token usati/totali, avviso che oltre il 60% la conversazione si riassume da sola e — su free/Go — che è il piano a tappare la finestra. Neutro sotto il 60%, ambra dalla soglia di compattazione, rosso dall'85%
- Conta quello che il modello riceve davvero: summary + ultimi 50 messaggi dopo `summary_upto` (`CHAT_HISTORY_LIMIT`, ora unica fonte anche per il default di `loadHistory`). I turni sopra il divisore restano a schermo ma non pesano
- `$lib/chat-context.ts` (client-safe) tiene `estimateTokens`, `rowContextChars`, `COMPACT_AT` e `contextUsage`; `chat/compaction.ts` li re-esporta invece di duplicarli, così anello e compattazione leggono gli stessi numeri
- Le finestre per modello le calcola il server (`contextWindowsByTier(plan)`): dipendono dal piano e da quali provider sono configurati. Senza chiavi provider valgono 0 e l'anello sparisce invece di rompere la pagina
- Attivo sia sulla pagina thread sia nella colonna chat desktop (`GET /app/[brand]/chat?thread=` ora restituisce anche `summary`, `summary_upto`, `contextWindows`, `contextCapped`)
- Copy in it/en/es/fr (`chat.context.*`)

## 2026-08-09

### OAuth per l'MCP remoto (`mcp.anomalia.so`)
- `mcp.anomalia.so` risponde 401 con `resource_metadata` che indica **questa app** come authorization server, ma `/.well-known/oauth-authorization-server` non esisteva: i client MCP ricevevano la pagina 404 SvelteKit e morivano su `JSON.parse("<!doctype html>")` (`opencode mcp auth anomalia` → `HTTP 404: Invalid OAuth error response`)
- Nuovo authorization server OAuth 2.1: `/.well-known/oauth-authorization-server` (RFC 8414), `/oauth/register` (RFC 7591 dynamic client registration), `/oauth/authorize` (schermata di consenso) e `/oauth/token`. Solo client pubblici con **PKCE S256**
- Nessuna tabella nuova: il `client_id` *è* la registrazione firmata (HMAC su `APP_SECRET`) e l'authorization code è firmato con TTL 60s, legato a `client_id` + `redirect_uri` + code challenge (`src/lib/server/oauth.ts`)
- I token rilasciati sono normali sessioni Supabase — quelle che l'MCP e `cli-auth.ts` già accettano come Bearer, quindi zero modifiche lato resource server. La sessione è **indipendente** da quella del browser (`generateLink` + `verifyOtp`), altrimenti la rotazione del refresh token avrebbe sloggato l'utente
- `/login` e `/auth/callback` ora riprendono un `/oauth/authorize` interrotto (cookie `oauth_return`, 10 min)
- Docs MCP aggiornate: OAuth automatico, con il Bearer scritto a mano lasciato come opzione custom
- **Fix CSRF su `/oauth/token`**: il check integrato di SvelteKit blocca ogni POST form-encoded il cui header `origin` non combacia — *incluso quello mancante*, che è ciò che manda qualunque client non-browser. RFC 6749 impone `application/x-www-form-urlencoded` sul token endpoint, quindi `opencode mcp auth anomalia` si prendeva `403 Cross-site POST form submissions are forbidden`. Ora `csrf.checkOrigin: false` in `svelte.config.js` e il controllo è reimplementato in `hooks.server.ts` (`$lib/server/csrf.ts`), che esenta solo `/oauth/token` e **gira anche in dev** — il check di SvelteKit è disattivato in dev, ed è per questo che il flusso passava in locale e falliva in produzione
- **Logout ora è locale** (`signOut({ scope: 'local' })`): il default di supabase-js è `global` e revocava *tutti* i refresh token dell'utente, quindi uscire dal browser sloggava anche la CLI e i client MCP. Ora "Esci" vale per quel browser

### Ads: sezione dedicata, prerequisiti Meta/Google e fee a crediti
- Nuova sezione collassabile **Ads** in sidebar con due pagine: **Social ads** (`/ads/social`) e **Google ads** (`/ads/google`); `/ads` redirige su social. Nuovo hub `ads` in `workbench-paths.ts` (la tab è uscita da Social media)
- Connessioni ads dedicate: `/ads/connect/metaads` e `/ads/connect/googleads` — separate dal connect di posting (nessun consumo di slot account). Google Ads richiede OAuth proprio; Meta gli scope ads su token Facebook
- Pannello **Prerequisiti** per canale (`adsReadiness`): piano, profilo Zernio, connessione, ad account, cap di budget, crediti, URL destinazione, dati DSA per targeting UE — ognuno con link di fix
- Fix `/v1/ads/create`: il payload era inviato nella forma nested di `/ads/boost`; ora è flat (`budgetAmount`, `countries`, `keywords`, `images.landscape/square`, `campaignType` lowercase) come da API Zernio. Aggiunto `validateStandaloneAd` (dry-run `validateOnly`)
- Form Google Search/Display: keyword, headline multiple, descrizioni, business name e la coppia di immagini obbligatoria per le Responsive Display
- **Le ads consumano crediti**: fee di gestione del 12% addebitata in crediti (100cr = $1) al lancio (primo giorno di budget) e poi sullo spend reale, delta-based su `external_ids.creditedSpend`. Ledger in `ai_calls` (provider `ads`, label `ads.launch` / `ads.spend`)
- Nuovo cron giornaliero `/api/v1/ads/tick` (05:00): sincronizza le metriche, addebita la fee e **mette in pausa su Zernio** le campagne live quando i crediti finiscono o il piano perde le ads

## 2026-07-12

### Blog: Categorie, Tags e Ricerca Globale
- Aggiunta tabella `blog_categories` con RLS per organizzare gli articoli in sezioni
- Aggiunta tabella `blog_tags` + junction `brand_article_tags` per tag liberi multipli
- Aggiunta colonna `category_id` su `brand_articles`
- Full-text search su `brand_articles` (colonna `search_vector` con trigger e indice GIN)
- Nuove query in `blog-site.ts`: `listCategories`, `listTags`, `listAuthors`, `searchArticles`, `listArticlesByCategory`, `listArticlesByTag`, `listArticlesByAuthor`
- Nuove route pubbliche `/blog/[site]/category/[slug]`, `/blog/[site]/tag/[slug]`, `/blog/[site]/author/[slug]`, `/blog/[site]/search`
- Stesse route anche per custom domain (`_site/`)
- `BlogShell.svelte`: barra categorie sotto la navbar, categorie nel drawer mobile, supporto layout sidebar
- `BlogIndex.svelte`: badge categoria, nome autore, pills tags nelle card
- `BlogPost.svelte`: categoria, autore (con avatar e link), tags sotto il titolo
- `BlogSearch.svelte`: componente search inline con icona lente nella navbar
- UI CRUD per categorie, tags e autori nella pagina di gestione blog (`/app/[brand]/site`)
- Dropdown categoria, tag picker e selezione autore nell'editor articoli

### Blog: Autore Umano
- Aggiunta tabella `blog_authors` con RLS (nome, slug, bio, avatar, ruolo)
- Aggiunta colonna `author_id` su `brand_articles`
- Pagina profilo autore pubblica con bio e lista articoli
- Byline autore (nome + avatar) mostrata negli articoli pubblici
- JSON-LD aggiornato con `author` come `Person`
- CRUD autori nella gestione blog con upload avatar

### Blog: Custom Navbar e Layout
- `blog_config.navbarLinks`: array di link custom (max 6) configurabili dalla UI
- `blog_config.showBlogLink`: toggle per mostrare/nascondere il link "Blog" default
- `blog_config.layout`: opzione `navbar` (default) o `sidebar` per la homepage
- Sidebar fissa a sinistra con categorie e toggle tema (solo desktop)
- Campi editabili nella sezione "Personalizza" del blog management

### Blog: AI Humanizer
- Nuovo modulo `blog-humanizer.ts`: pipeline AI a 3 pass per rendere il testo più naturale
- Rimozione pattern tipici AI (frasi generiche, superlativi, filler)
- Variazione ritmo frasi, aggiunta interazioni dirette con il lettore
- Integrato nella pipeline di generazione automatica (tra generazione e ottimizzazione score)
- Bottone "Humanizza" nel menu ⋯ di ogni articolo e nell'editor
- Toggle `humanizerEnabled` in Personalizza per attivare/disattivare nella pipeline

### Radar: Multi-lingua e Digest Collaboratori
- Google News feeds: supporto lingua `auto` (senza locale params) + mappa lingue estesa (30+ lingue)
- Radar digest: invio email a tutti i collaboratori del brand (owner + shared), non solo al proprietario
- Ogni ricevente riceve il digest nella propria lingua

### Scheduler: Email Collaboratori
- Le email del autopilot (reminder, weekly recap, approval, rollover) vengono inviate a tutti i collaboratori del brand
- Funzione `emailAll()` per fan-out email con gestione errori per-destinatario
- `brandContacts()` sostituisce `brandOwnerContact()` per supportare più destinatari

### Content Preview: Aspect Ratio Fix
- Aspect ratio immagini: rimosso 9:16 per feed posts (Instagram/Facebook lo rifiutano)
- `aspectRatioFor()` ora basato solo sulla piattaforma, non sul formato
- 9:16 riservato a TikTok e video effettivi
- Formato "story" rimosso dai formati supportati per i seed

### Varie
- SEO keyword strategy: test aggiuntivi
- Shopify/Webflow/Wix: refactoring integrazioni
- Onboarding e Studio: fix minori UI
- Aggiornamento dipendenze (package.json)
