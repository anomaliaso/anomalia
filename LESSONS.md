# LESSONS

Lezioni imparate lavorando a questo repo: problemi veri, il segnale che li fa riconoscere, e la mossa che li risolve. Una sezione per tema. Una lezione nova entra qui nel commit che l'ha pagata.

## Ambiente e worktree

### Una cache letta di sincrono sceglie il modello sbagliato senza dire niente
Spostato il default della chat da `LLM_DEFAULT_MODEL` a una riga in Supabase, la riga marcata
diceva `z-ai/glm-5.3-flash` e il turno e` girato su `google/gemini-3.8-flash` — l'env. Nessun
errore, nessun log: `resolveChatModel` e` sincrono (lo chiamano una dozzina di superfici che poi
fanno `streamText`), quindi legge una cache di modulo, e su quel percorso nessuno l'aveva
scaldata. Segnale: la configurazione in database «non ha effetto», il turno riesce lo stesso, e
`ai_calls` mostra il modello vecchio mentre la tabella mostra quello nuovo. Mossa: scaldare la
cache al confine della richiesta (`hooks.server.ts`, prima di ogni handler), non nel primo
chiamante che capita — e il test che vale e` quello che confronta la riga del database col
modello finito in `ai_calls`, non quello che chiede alla cache cosa ha in pancia.

**La regola dietro**: un valore che l'operatore cambia da fuori NON puo` vivere dietro una cache
riempita da un chiamante di passaggio. O lo si legge dove si puo` aspettare, o lo si scalda in un
punto per cui passano tutti. La terza via — «tanto qualcuno l'avra` letta» — e` il difetto piu`
silenzioso che ci sia, perche' il prodotto continua a funzionare.

### Lo Storage locale non salva immagini: «extended attributes disabled»
Verificando una grafica dalla chat, ogni upload falliva e l'agente riferiva onestamente «Upload
failed». Nel log del dev server: `[uploadPostImage] storage upload failed: The file system does not
support extended attributes or has the feature disabled`. Non e` il codice: il container Storage
del self-hosted, sul filesystem montato da Docker su macOS, non riesce a scrivere gli xattr.
Segnale: OGNI upload fallisce allo stesso modo, anche su percorsi che non hai toccato — la prova
decisiva e` chiedere una foto AI (percorso vecchio) e vedere lo stesso errore. Mossa: verifica la
LOGICA con i test (il caricamento si mocka) e nel browser verifica quello che il difetto riguardava
— quale tool viene scelto, quali righe nascono — senza pretendere che il file arrivi in Storage.

### Il worktree nuovo ha bisogno di `npm ci` — e ancora dopo ogni rebase su dev
Un worktree parte senza `node_modules`, e `vite.config.ts` muore subito (`Cannot find package '@sentry/sveltekit'`). Ma il caso insidioso è l'altro: dopo aver ribasato su dev che ha accolto PR nuove, il `node_modules` installato col vecchio lockfile produce guasti **deterministici e fuori posto** — v. `extractUserText is not a function` in un test di immagini: il codice era giusto, le dipendenze vecchie. Segnale: un errore `X is not a function` su codice mai toccato, in un worktree ribasato. Mossa: `npm ci` nel worktree, sempre, dopo il rebase.

**E il worktree nuovo non ha nemmeno `.env`: `hooks.server.test.ts` fallisce da solo.** Con
`node_modules` a posto resta un rosso che sembra tuo: `TypeError: Invalid URL` all'import, un file
solo, in un test che la tua modifica non sfiora. Non è una regressione — è una variabile
d'ambiente che manca, e il checkout principale ce l'ha. Segnale: quel test è l'UNICO rosso su
~7.300 passati, e passa nel checkout principale. Mossa: rilancialo nel checkout principale prima
di indagare; se lì è verde, è l'ambiente, non il tuo diff. Ha già fatto perdere tempo a due
agenti lo stesso giorno.

**E prima di credere a un rosso locale, guarda la CI.** Lo stesso `extractUserText`/
`extractUserImages` è tornato il 4/9 su `dev`: quei simboli non erano codice nostro ma una patch
`patch-package`, tolta perché non applicava più alla versione installata. In locale i test
falliscono davvero; **sulla CI passano** (verificato nel log della run, non dedotto). Segnale: un
rosso locale su file che nessuna PR ha toccato, mentre la CI è verde. Mossa: leggere il log della
CI PRIMA di cancellare il test — il soggetto è vivo, è l'installazione locale a essere fuori
posto, e cancellarlo butta via copertura che funziona.

### Il worktree nuovo ha bisogno anche del `.env`
Dopo il `npm ci` la suite parte ma cade su 40+ test con `SUPABASE_SERVICE_ROLE_KEY not configured`: Vitest carica l'env dal `.env` del worktree, che non c'è. Segnale: errori di env mancante in un worktree fresco, deterministici, su file che passano nel checkout principale. Mossa: `cp ../anomalia/.env .` alla creazione del worktree, accanto al `npm ci`.

### **Una regola di `.gitignore` senza `/` iniziale mangia una cartella di codice, in silenzio**
Rotta nuova in `src/routes/api/v1/brands/[slug]/evidence/artifacts/`, 27 test verdi, `git add -A`,
commit — e nel commit la cartella non c'era. La riga era `artifacts/`: senza `/` iniziale git la
applica a **ogni** livello, non solo alla radice, e `git add -A` non protesta per un file ignorato.
In produzione sarebbe stato un 404 su un endpoint che in locale passava tutti i test. Segnale: il
conto in `git show --stat` non torna con i file che hai scritto, e `git status` non mostra niente.
Mossa: dopo il commit, `git show --stat HEAD` e conta; se manca qualcosa,
`git check-ignore -v <path>` dice quale riga l'ha presa. La riga si ancora (`/artifacts/`), non si
aggira con `git add -f`: il `-f` vale per te oggi, l'ancora vale per tutti domani.

### **Il `.env` copiato può puntare al progetto hosted: il 404 sembrerà un bug di permessi**
worktree con `.env` copiato ma `PUBLIC_SUPABASE_URL` sul progetto remoto: il login va, il brand locale esiste, ma `/app/<brand>` rende 404 "Brand not found" e la diagnosi scarta su RLS. In più una chiave segnaposto (`LLM_API_KEY` con dentro una frase italiana) passa i check di configurazione e muore 401 alla prima chiamata. Mossa: prima di sospettare RLS, `grep PUBLIC_SUPABASE_URL .env` (deve essere `http://localhost:8000`) e guarda gli `ai_calls`: le righe ok=false con 401 valgono più di ogni grep sul codice.

### Un test che sceglie un ramo in base all'env locale non è un test
`queue-dm.test` girava o no il ramo kit secondo `AGENT_KIT` del `.env` locale: sul laptop di chi lo ha spento passava, su chi lo ha acceso il turno andava nel kit e `harnessCalls` restava vuoto (`expected +0 to be 1`). Segnale: un test che fallisce solo su un'altra macchina, senza cambiamento di codice. Mossa: chi fissa `$env/dynamic/private` nel test (`vi.mock('$env/dynamic/private', () => ({ env: { AGENT_KIT: 'off' } }))`), come già fa `queue-kit-heartbeat.test` — la scelta del ramo è parte del test, non del computer che lo esegue.

### `@anomalia/*` si risolve dal `node_modules` del checkout principale
Un eval o un test lanciato da un worktree misura un ibrido: `$lib` punta alla copia del worktree, i pacchetti interni vengono dal checkout madre. Se hai toccato `packages/`, il worktree non lo vede. Per un confronto pulito: worktree di verifica con `node_modules` symlinkato a quello fresco.

### Il worktree DENTRO la repo dir: la pagina è viva ma non risponde (403 su `entry.js`)
Un worktree creato dentro la cartella della repo (`anomalia/anomalia-wt/<slug>`) risolve `@sveltejs/kit` dal `node_modules` del checkout padre: vite lo serve via `/@fs/...` **fuori dalla root del worktree** e risponde 403 — il bundle client non parte, la hydratazione non arriva, e ogni click "riuscito" dell'automazione browser non cambia nulla (SSR morto senza errori in console). Segnale: `performance.getEntriesByType('resource')` mostra `entry.js` con `responseStatus: 403`, i click vanno a un DOM senza handler. Mossa: il worktree sta **fuori** dalla repo (`../anomalia-wt/<slug>`, come da docs/e2e-testing.md §1) con `npm ci` proprio.

### Verifica il `workdir` prima di ogni Edit
Con più worktree aperti (feature + verifica), un edit fatto nel checkout sbagliato tocca dev. È successo: `live.ts` modificato nel checkout principale per un secondo, poi `git checkout --` e riapplicato nel posto giusto. Il tool Edit non ti proteggere — proteggiti tu: guarda il percorso del file che stai per toccare, sempre.

### Il `git stash` è condiviso fra tutti i worktree — ora è BLOCCATO da un hook
`git stash` legge e scrive lo STESSO ref (`refs/stash`) per l'intero repository, non per worktree: stashare dentro un worktree e fare `git stash pop` in un altro applica lì le modifiche del primo. È successo: `git stash` nella feature ha creato uno stash (e spinto via i miei edit di `live.ts`), e il `pop` eseguito dopo un timeout del tool di shell ha riesumato le modifiche di un ALTRO worktree (`video.ts`, irrelate) dentro il mio — lasciando il mio `live.ts` senza i miei edit. Segnale: dopo un `git stash`/`pop` i file modificati non corrispondono a quelli che avevi in mano, o compaiono modifiche a file mai toccati nel branch corrente. Mossa: evita `git stash` in un worktree — per sospendere delle modifiche usa il checkout dedicato (o `git diff > patch && git checkout --` e poi `git apply`), e se devi proprio stashare verifica sempre `git stash list` + `git show stash@{0} --stat` PRIMA del `pop`; un `pop` che finisce in timeout non è affidabile, riapri il file a mano e ricontrolla che i tuoi edit ci siano ancora.
**Aggiornamento (30/8): non è più una raccomandazione.** Un agente ha stashato di nuovo dentro un worktree, e questa volta è andata bene solo per fortuna. Un hook `PreToolUse` su Bash (`~/.claude/settings.json`) ora rifiuta ogni comando che invochi `git stash`, in qualunque posizione della riga, e spiega le alternative nel messaggio di rifiuto. La regola sta anche in CLAUDE.md e AGENTS.md.

### Un test verde sul checkout principale può essere rosso nel worktree: il `.env` locale entra nei test
`$env/dynamic/private` in vitest porta dentro il `.env` DELLA MACCHINA. Il checkout principale può passare per cache Vite stantia (env congelata prima di una variabile), il worktree con cache fresca fallisce — v. `queue-dm.test`: con `AGENT_KIT=on` locale il turno scappava nel ramo kit e il mock di `./subagents` moriva su `createSubagentTools`. Segnale: stesso codice, esito opposto fra checkout e worktree, e nessuna differenza nel diff. Mossa: il test che prova un percorso specifico fissa le variabili che gli servono spente (`vi.mock('$env/dynamic/private')` con override), non conta sul `.env` di chi lo lancia.

### **Una patch cambiata in un PR non si propaga ai worktree impilati con `npx patch-package`**
patch-package non aggiorna uno stato già patchato: dopo un merge/rebase che tocca `patches/`, i worktree impilati falliscono sui test del parser (es. pi-stream) anche se su dev passano, e patch-package muore con "cannot apply". Mossa: dopo ogni merge che cambia `patches/`, `npm ci` + `npx patch-package` in OGNI worktree impilato — il reinstall del solo pacchetto basta se sei sicuro del lockfile.

### Una sessione precedente uccisa lascia una `vite build` orfana che scrive nella STESSA `build/`
Una sessione (agente o terminale) chiusa a metà `npm run build` non porta via il processo: il trap del genitore non lo tocca, e `vite build` resta parente di `init`, vivo per decine di minuti, a scrivere in `build/`. Rilanciare il build nello stesso worktree fa gareggiare due `vite build` sulla stessa cartella d'output — corruzione silenziosa, non un errore chiaro. Segnale: `ps -ef | grep "vite build"` mostra più di un processo con lo stesso `cwd`, uno con `PPID 1` e un'ora di avvio molto più vecchia. Mossa: prima di rilanciare un build lungo in un worktree, cerca ed elimina (`kill -9`) ogni `vite build`/`npm run build` orfano di QUEL worktree — non toccare processi di altri worktree che condividono la macchina.

### Una PR «Merged» su GitHub può non essere MAI arrivata su `dev`
La #52 («Run custom-agent turns on the Agent Kit») risulta `MERGED` su GitHub, con tanto di merge commit, e il task su Notion diceva «In production». In produzione non c'è mai stata: era aperta **contro `feat/kit-private-threads`**, non contro `dev`, e quel branch intermedio in `dev` non è mai entrato. Il merge commit è reale e irraggiungibile — un ramo staccato che nessuno ha più tirato. Il codice su `dev` continuava a portare il gate vecchio (`!personaId`) mentre tutti lo davano per migrato.
Segnale: una feature che «è stata mergiata» ma il cui codice sul branch vivo non c'è — e `gh pr view` che mostra `baseRefName` diverso da `dev`/`main`. Il sospetto va acceso da `gh pr list --state merged` con un base branch che non è quello di destinazione: una PR impilata è mergiata nella sua pila, non nel prodotto.
Mossa, due comandi, prima di credere a «merged»:
```bash
gh pr view <n> --json baseRefName,mergeCommit
git merge-base --is-ancestor <merge-commit> origin/dev && echo LANDED || echo NEVER LANDED
```
Se la pila si abbandona, le PR che ci stavano sopra non si chiudono da sole: vanno riportate a mano sul branch di destinazione (cherry-pick del merge commit, che essendo squash ha un solo genitore), e la risoluzione dei conflitti è il prezzo di averlo scoperto tardi.

### Un difetto e la sua correzione nello stesso ramo sono una trappola armata
La #372 aveva cinque commit, e il terzo annullava una regressione introdotta dal secondo: una
dichiarazione di contenuto AI spenta senza volerlo (`content_type` che perde il prefisso
`uploaded`, e `publish.ts` che da quel prefisso ricava se dichiarare). Il merge è stato fatto **al
secondo commit**. Risultato: su `dev` è finito il difetto senza la correzione, e chi lo aveva
scritto lo dava per consegnato perché sul SUO ramo era a posto.

Non è un errore di verifica del merge — quello è il sintomo, ed è coperto dalla lezione qui sopra.
La causa è la **forma della consegna**: una PR non è un'unità atomica, e chi la scrive non decide
dove viene tagliata. Cinque commit sono cinque stati possibili del ramo base, e se il commit N
introduce un difetto che il commit N+2 ripara, due di quei tagli lasciano il prodotto **peggio di
non aver mergiato niente**. La trappola resta armata finché qualcuno non preme merge nel punto
sbagliato, e nessuna review la vede: il diff completo della PR è corretto.

Segnale: nel ramo esiste un commit il cui messaggio dice «fix», «undo», «revert» o «restore» di
qualcosa che un commit precedente **dello stesso ramo** ha fatto.

Mossa: **nessun commit lascia il ramo in uno stato peggiore del precedente.** Se una tua correzione
annulla un tuo difetto introdotto prima nello stesso ramo, i due si fondono con `rebase -i` *prima*
della review, così non esiste taglio che possa separarli. È la regola di Kent Beck che questo repo
già ha — riordino separato dal cambio di comportamento — applicata al ramo invece che al singolo
commit. Il controllo, prima di chiedere la review:
```bash
git log --oneline <base>..HEAD              # ogni prefisso è uno stato che può finire in produzione
git show --format= --name-only <commit>     # quali commit toccano il file che porta il rischio
```
**La domanda giusta è sulla STRUTTURA, non sul contenuto**: *quali commit toccano il file
rischioso*, non *quale stringa ci compare*. Se quel file è toccato da un commit solo, la trappola è
impossibile per costruzione — ogni prefisso lo contiene — e non serve leggere una riga. Se è
toccato da due e il secondo ripara il primo, è armata comunque, qualunque cosa dica il grep.

**E il controllo si sceglie perché non oscilla, non perché è breve.** Verificando proprio questa
cosa, `grep` su un `git cat-file` in un `for` ha dato a due persone tre risposte diverse alla stessa
domanda (`5, 2, 0, 0`, poi zero ovunque, poi righe di diff al posto del contenuto). `--name-only`
non oscilla: risponde con l'elenco dei file, che è un fatto del commit e non del modo in cui lo
interroghi. Un controllo che devi rifare per credergli non è un controllo — e qui la lezione sul
non fidarsi del proprio ramo stava per essere depositata sulla base di un loop mai testato.

Questa lezione è più forte delle altre due che l'hanno accompagnata, perché quelle dipendono da
qualcuno che si ricordi di controllare; questa toglie la possibilità che il taglio sia dannoso.

## Test: distinguere il tuo difetto dal rumore

### CI rossa con zero test falliti è una promessa non attesa, non un test tuo
`Test Files 649 passed | Tests 7259 passed | Errors 1 error`, e il job esce comunque 1. Non
cercare il test rosso: non esiste. Vitest conta come fallimento anche una `Unhandled Rejection`
sollevata FUORI da un test — qui `supabase.rpc is not a function` da `credits.ts`, arrivata da un
`loadDeferred` di `+layout.server.ts` che risolve dopo la fine del file che l'aveva avviata
(`home-redirect.test.ts`), su uno stub senza `.rpc`. Il file, eseguito da solo, passa: la promessa
fa in tempo a essere raccolta. Segnale: la riga `This error originated in "<file>"` seguita da
`It doesn't mean the error was thrown inside the file itself`.

**La mossa: cerca lo stesso messaggio su una run che NON contiene il tuo diff.** E qui sta la
trappola, pagata per intero: `gh run list --branch dev` restituisce anche la run del merge del tuo
stesso PR, che il tuo diff ce l'ha dentro. Preso quello per prova d'innocenza, hai scritto
«riprodotto senza le mie modifiche» avendo misurato esattamente le tue. La prova buona si prende
da un PR altrui e si verifica, non si assume:

```
gh run list --commit "$(gh pr view <altro-pr> --json headRefOid -q .headRefOid)" \
  --workflow ci.yml --limit 1 --json databaseId -q '.[0].databaseId'
gh run view <id> --log-failed | grep -c '<messaggio>'
git merge-base --is-ancestor <tuo-primo-commit> <quella-sha>   # deve dire NO
```

L'ultima riga è quella che chiude la questione: se il tuo commit non è antenato di quella sha, il
difetto è latente e non è tuo. E non fidarti del solo «dev è verde»: la run di dev può essere
caduta prima, sugli e2e, senza mai arrivare alla suite unitaria.

### La suite completa fallisce da sola: confronta run-per-run con dev puro
Sotto carico (worker paralleli) i test di timing e race cadono da soli: `redact` ≤ 200ms che ne impiega 404, JPEG ≤ 2MB, drain "executes exactly once". Lo stesso sottoinsieme, rilanciato isolato, passa. Prima di imputarsi un fallimento della suite completa: (1) rilancia il sottoinsieme isolato, (2) lancia la suite completa su **dev puro** nello stesso setup. Se dev fallisce uguale, il rumore non è tuo. Vero anche il rovescio: "tutta verde" sul tuo branch non dice niente se dev non lo è.

### Il numero di file rossi che cambia tra run è un timeout, non una race
"9 file rossi, poi 11, sullo stesso albero": quando l'insieme dei falliti varia tra run e la stragrande maggioranza dei test dice `Test timed out in 5000ms`, non cercare una race — è il timeout per-test al default di Vitest (5s) che i test I/O-bound attraversano in modo non deterministico secondo il carico della macchina (misurato: 38 timeout su 43 test falliti in una run, con picchi fino a 15 file su 509). Mossa: `testTimeout` esplicito in `vite.config.ts` (120s: i turni kit completi toccano i 40s da soli e oltre il minuto con la macchina satura da altre sessioni, e un hang vero brucia in minuti, non in secondi) e soglie perf ben sopra il rumore (`redact` da 200ms a 1s: il regex catastrofico che il guardrail caccia brucia in secondi, i 342ms di rumore no).

### Il sonno fisso prima dell'asserzione è la race in nuce
`await new Promise(r => setTimeout(r, 250))` e poi asserire su righe salvate in background: sotto il carico della suite intera i 250ms non bastano e l'asserzione vede lo stato a metà (`expected false to be true` su un `every(done)`). Segnale: test che passa da solo e cade solo nella suite completa, su un'asserzione che riguarda lavoro asincrono post-fine-turno. Mossa: `vi.waitFor(() => expect(statoFinale)...)` — aspettare la CONDIZIONE, non un numero di millisecondi sperato; già usato in `tool-job-drain.test`.

### Il `git rebase` scarta da solo il commit già squashato in dev
PR squash-mergiata + branch di lavoro con più commit: `git rebase origin/dev` riconosce il contenuto identico, salta il commit e resta solo quello nuovo. Zero conflitti. Poi `push --force-with-lease` e PR nuova con un commit solo.

### Guarda lo stato della PR prima di diagnosticare lag
`gh pr view` che mostra il vecchio head per minuti sembra cache di GitHub. Può essere che la PR sia **chiusa** e il branch cancellato — e che il tuo push l'abbia ricreato come orfano. `gh api repos/:org/:repo/pulls/N --jq '.state'` prima di ipotesi sulla freschezza dell'API.

### Il test che va in TIMEOUT (non che fallisce) è un modulo nuovo non mockato
Dopo un merge da dev, un test della PR entra in timeout di 30s invece di fallire: dev ha aggiunto un ramo (`AGENT_KIT=on` → `runKitTurn` dal drain) che il vecchio test non mocka, e la suite resta appesa a una sessione viva. Segnale: timeout senza AssertionError, e `.env` locale che accende la feature. Mossa: spegni il ramo non mockato nel `beforeEach` del suite (`env.AGENT_KIT = 'off'`) — il test copre il motore classico, non il bridge.

### Le factory `vi.mock` invecchiano col merge, non col typecheck
Il mock scritto nell'era della PR non dichiara gli export nuovi di dev (`createSubagentTools`, `MAX_CRITERION_CHARS`, `loadMemoryEntries`): l'errore `No "X" export is defined on the "Y" mock` esplode a runtime a metà test, mai in compilazione. Stesso segno per il fake supabase che manca di un metodo nuovo (`query.or is not a function`). Mossa: a ogni errore di quel tipo aggiungi l'export — o meglio `...actual` via `importOriginal` e override selettivi.

### Il fake di una RPC che torna `null` dove il plpgsql torna una riga di NULL
Una funzione `returns public.<tabella>` che non prende righe NON torna `null`: la riga composita esce tutta NULL e PostgREST la consegna come oggetto con ogni colonna a `null`. Un fake che risponde `{ data: null }` rende verde un client che controlla `if (!data)` e lascia passare in produzione un record fantasma — `agent_kit_claim_run` faceva girare turni interi con `run.id === null`: ogni scrittura filtrata per `id` toccava zero righe e la chiusura non depositava il messaggio, quindi il turno spariva dalla chat dopo aver speso il modello. Segnale: `run null` nei log, o «sfrattato prima della chiusura» su un run che nessuno ha sfrattato. Mossa: nel fake torna la riga di NULL, e nel client controlla la CHIAVE (`if (!row?.id)`), mai la sola presenza dell'oggetto.

### Un id di modello non dichiarato non fallisce: scivola su un altro provider
`harness-pi` considera il gateway Vercel configurato appena vede `AI_GATEWAY_API_KEY` **o** `VERCEL_OIDC_TOKEN` (che su Vercel c'è sempre), e da lì risolve il modello cercando prima un match sul provider `vercel-ai-gateway`. Se l'id che chiediamo non sta nel `models.json` del nostro provider, non arriva un errore che dice «modello sconosciuto»: arriva un 403 di un provider che non abbiamo scelto, su un modello che nessuno ha chiesto, mentre i nostri log stampano l'id che avevamo selezionato. Segnale: `originalModelId` nel `providerMetadata` diverso dal `Model:` del nostro log. Mossa: dichiarare le credenziali a pi come `customEnv` (con un customEnv configurato l'ambiente non viene più guardato) e mettere l'id del turno fra i modelli dichiarati, sempre — non basta la lista dell'env, perché il default esce dal database e il listino del gateway è freddo al primo turno del processo.

### Il test della PR può aspettare il vecchio contratto
`toHaveBeenCalledWith` con 6 argomenti contro un executor passato a 7 (dev ha aggiunto la riga `job`): fallisce nel merge senza che nessuno abbia toccato il file. Mossa: nel riesame di un merge, fai girare PRIMA i test dei file in conflitto — sono gli unici che fanno da spec su entrambi i lati.

## Testare la piattaforma nel browser: worker locale ed ambiente

### Il websocket Realtime non si collega dalla stack locale: quello che arriva per broadcast non lo verifichi qui
Il broadcast HTTP del server risponde 202 e il container lo logga, ma il browser non apre mai il canale: `channel(...).subscribe()` non risolve, e in `read_network_requests` non c'è una sola richiesta verso `localhost:8000`. Tutto quello che il prodotto consegna via `thread-changed` / `turn-state` / `kit_stream` — il turno scritto dal worker che deve comparire da solo, il pallino in sidebar, il riaggancio a uno stream partito altrove — nella stack locale non si vede, e la tentazione è di dichiararlo rotto nel codice. Segnale: il POST `/api/broadcast/...` esce 202, i log di `realtime-dev.anomalia-realtime` non mostrano nessun join di canale, e la UI resta ferma. Mossa: verifica quel percorso dal lato che NON dipende dal socket — scrivi la riga in `chat_messages` mentre la scheda è nascosta e torna sulla scheda: se il ricontrollo al focus la porta a schermo, il difetto non è lì. E dillo nel PR invece di far passare per verificato ciò che la macchina non poteva provare.

### Due dev server su localhost si rubano la sessione: il 404 «Brand not found» non è un bug tuo
Per un confronto prima/dopo viene naturale tenere due porte accese insieme (dev su 5201, branch su
5200). I cookie però stanno sull'HOST, non sulla porta: entrambi i server ruotano lo stesso refresh
token di GoTrue, e chi arriva secondo se lo trova già speso. Da lì la pagina risponde 404 con
`{"error":"Brand not found"}`, oppure ti sbatte su `/app/onboarding` come se l'utente non avesse
brand — e sembra un difetto del codice appena scritto. Segnale: la stessa URL rende su una porta e
404 sull'altra, con lo stesso `.env` e lo stesso `PUBLIC_SUPABASE_URL=http://localhost:8000`; un
`fetch` all'endpoint dice «Brand not found» invece di «Unauthorized». Mossa: **un dev server alla
volta** per qualunque verifica nel browser. Il confronto prima/dopo si fa in sequenza — misuri il
branch, spegni, accendi il baseline, misuri — non in parallelo.

### Il worker locale è un build vecchio che compete per la stessa coda
La stack Docker porta un'app pronta (`anomalia-app`, immagine `anomalia-selfhost-app`) che prosciuga `chat_jobs` dallo stesso DB del dev server: il cron chiama `app:3000`, non la tua porta. Con l'immagine più vecchia del checkout, il codice nuovo **non gira mai** (il team contact post-onboarding non parte) e i due reaper si contendono i turni: `chat turn died mid-flight (heartbeat lost)` su turni vivi, `Failed to load url credits.ts` da moduli che nel checkout esistono. Segnale: `chat_jobs` failed con errori che il codice attuale non può produrre. Mossa: identificare chi prosciuga la coda prima di giudicare il flusso — `docker logs anomalia-app`, data dell'immagine (`docker images`) contro `git log -1` — e fermare o ricostruire il container stantio (ricordarsi di riaccenderlo).

### Le env del repo puntano all'hosted; la stack locale porta le sue chiavi in kong.yml
Il `.env` del repo punta a un progetto Supabase hosted, mentre la compose gira da un altro checkout con le chiavi veramente valide dentro `anomalia-kong:/usr/local/kong/kong.yml`. Il seed (`scripts/db-seed.mjs`) pretende `DATABASE_URL` e fallisce con parse error leggendo `.env` a mano (contiene valori con `<...>`). Mossa: overlay env a parte — `PUBLIC_SUPABASE_URL=http://localhost:8000`, chiavi estratte da kong.yml, `DATABASE_URL` dalla compose — e avviare il dev con quello; mai puntare all'hosted "per comodità".

### Misurare fuori dal percorso dell'app e concludere sull'app
`curl` con `response_format: json_schema` strict su `z-ai/glm-5.3-flash` risponde 200 e resta aperto 180s con soli spazi di keep-alive: sembra un modello rotto. L'app però non usa quel percorso — usa `generateObject` dell'AI SDK, che negozia diversamente — e sullo stesso schema quel modello risponde in 107s (gemini in 15s). Lento, non rotto. Segnale: una conclusione su un componente tratta da una prova che quel componente non esegue mai. Mossa: misurare chiamando la FUNZIONE che il prodotto chiama (`llmStructured`), non l'endpoint a mano; e diffidare di «rotto» quando l'unico sintomo è «non è ancora tornato».

### Una colonna aggiunta a mano al DB locale non esiste per PostgREST finché non ricarichi lo schema
`alter table ... add column` via `psql` non risveglia la cache di schema di PostgREST: ogni `.update()` che nomina la colonna nuova viene rifiutato (PGRST204), e il codice che scarta l'errore (`const { data } = await supabase...`) prosegue come se non fosse successo niente — nel caso pagato, l'approvazione di una rubrica non ha scritto la modifica e ha marcato la riga `rejected`. Segnale: una scrittura che tocca SOLO la colonna nuova non ha effetto, mentre le letture della stessa tabella funzionano. Mossa: `docker exec anomalia-db psql -U postgres -d postgres -c "notify pgrst, 'reload schema';"` subito dopo ogni migration applicata a mano, prima di aprire il browser.

### La porta 5173 può appartenere al vite di un altro worktree
Un `vite dev` di un altro worktree risponde 404 a tutto e resta lì in ascolto; il CLI ci si punta da solo. Mossa: `lsof -nP -iTCP:5173 -sTCP:LISTEN` e `ps` sul PID prima di `npm run dev`; se occupata, porta esplicita (`npm run dev -- --port 5175`).

### Il profilo del browser di test conserva sessioni e localStorage
`agent-browser` riutilizza cookie e localStorage tra le run: un test "guest" parte loggato, e l'onboarding di un utente nuovo legge `localStorage['anomalia:first-agent:<altro-brand>']` dell'utente prima — fetch di thread altrui (404 rumorosi ma disordini nella diagnosi). Mossa: `cookies clear` **e** `storage local clear` prima di ogni persona nuova; verificate sempre chi siete (`location.href`, sidebar) prima del primo click.

### `agent-browser` è un daemon: path relativi e storage Puliti col suo contesto
Il CLI parla con un daemon che gira col **suo** cwd: una screenshot con path relativo muore con `No such file or directory` anche se la cartella esiste nel caller. E `storage local clear` alza `Uncaught` se non c'è una pagina aperta. Mossa: path **assoluti** per le evidenze, e per partire puliti: open → `cookies clear` → `storage local clear` → reopen.

### La prima risposta non è il turno finito: la finestra del poll parte dalla fine del turno
Il turno di setup dell'onboarding consegna la prima risposta in ~20s e continua a lavorare per **minuti** (tool, memoria); il contatto del team nasce alla chiusura del job, non alla prima bolla. L'eval:ux misurava il contatto con la finestra della prima risposta: scaduta pochi secondi prima dei thread, riportava `team-of-agents-contact: ❌` per un contatto avvenuto (thread e firme in DB). Segnale: report FAIL ma le righe in DB dicono il contrario, con timestamp pochi secondi dopo la scadenza del poll. Mossa: aspettare la CONDIZIONE con la finestra giusta — poll del team separato (TEAM_WAIT_MS) dal poll della prima risposta.

### I rimount (`{#key}`) rendono stale i ref dell'automazione browser
Un click su un ref catturato prima del re-render non arriva a nessuno: il carosello dell'onboarding sembrava bloccato prima del pick — era il bottone rimontato ad ogni slide. Mossa: snapshot fresco e selettori stabili (`.wide-btn`), click lenti; un "blocco" va riprodotto con click lenti e selelettori nuovi prima di chiamarlo bug. Il falso positivo costa un'ora, la prudenza tre secondi.

### Un file input SSR accetta la selezione prima dell'hydration
`waitForSelector` può vedere il file input nel markup SSR mentre `onchange` non è ancora collegato; `setInputFiles` allora perde l'immagine senza errore, la strip non nasce e il turno parte cieco. Mossa: montare il picker solo dopo `onMount`, così il selettore trova solo un input interattivo.

### Un cookie di sessione malformato abbatte il dev server
Una curl con `sb-<host>-auth-token` corrotto produce `Invalid Base64-URL character` non gestito nella recovery della sessione e il processo muore (`curl` → 000, niente più risposte). È un finding prodotto, non rumore: la recovery non tollera input corrotto. Mossa: quando curl dà 000, guardare il log del server prima di incolpare la rete; e la richiesta che ha ucciso il server diventa un test.

### Il `.env` locale può mascherare la migration che stai verificando
La chat girava «bene» ma fuori dal percorso in esame: `CHAT_PROVIDER=openrouter` nel `.env` del worktree costringeva `activeProvider()` sull'harness openrouter, e il gateway (il cuore della PR) non vedeva un solo turno. Segnale: le righe `ai_calls` dicono `openrouter` quando ti aspetti `llm`. Mossa: prima di dire "funziona/non funziona", guarda quale provider il resolver effettivamente prende col `.env` locale — commenta le chiavi legacy (`CHAT_PROVIDER`, `KIE_API_KEY`, …) e riavvia. Lo stesso `.env` ha mostrato il rovescio: `LLM_DEFAULT_MODEL` su un modello solo-testo passava la probe `ai:text` di `/api/status` e moriva su un turno agentico con tool (`Stream ended without finish_reason`) — chiuso con la riga d'errore onesta e job `done`, mai un hang. La probe di stato non è un turno.

### L'attesa nel browser si misura sulla riga di database, non sul muro
Il secondo messaggio in chat sembrava morto a 120s: l'agente delega a un sub-agent (feature nuova) e il turno dura 2,5 minuti — il job era `done` alle 13:54, il test aveva mollato alle 13:53. Mossa: nel verificatore aspetta la riga `chat_jobs.status='done'` / `ai_calls` (poll sul DB via `docker exec psql`), non un timeout UI; e prima di chiamare "fallito" guarda `chat_jobs` e `agent_kit_runs` — raccontano il turno meglio dello schermo.

### Un 4xx che sembra un bug è spesso il contratto
GET su `/videos/review` risponde 400 (endpoint POST-only), POST senza url risponde 400 `missing_url`, transcribe senza file 400 con messaggio esplicito: non difetti, degradeos giusti. E i `run_autopilot` che restano `pending` per 20 minuti in locale non sono un blocco: è il gating worker-only che funziona — il drain serverless li salta per costruzione. Mossa: leggi la route prima di aprire un finding; un 4xx pulito con messaggio nominale è prova di robustezza, non guasto.

### **Il marcatore che matcha la bolla dell'utente è un falso positivo**
aspettare `document.body.innerText.includes(marker)` conferma anche il messaggio CHE HAI INVIATO TU: nel gate di oggi ha mascherato un 401 reale (nessuna risposta mai arrivata, "verde" lo stesso). Mossa: contare le occorrenze (≥ 2) oppure aspettare il selettore della bolla dell'assistente, non il body intero.

### **Un difetto che vive nella finestra di una load non si riproduce in locale senza rallentare la rete**
Segnalato: due agenti «riportano gli stessi identici 3 messaggi». In locale la load del thread
torna in decine di millisecondi, lo schermo si corregge prima che tu riesca a guardarlo, e il primo
verdetto è «non riproducibile, sarà stato il database» — che era falso: sul database i due thread
erano giusti. Vale per tutta la famiglia (liste che restano quelle di prima, testate che cambiano
prima del contenuto): il difetto NON è la finestra, è che dentro la finestra la pagina afferma una
cosa falsa, e in produzione quella finestra dura quanto la risposta. Mossa: `newCDPSession(page)`
+ `Network.emulateNetworkConditions` con `latency: 400`–`1500`, e campiona lo schermo ogni
100–150 ms invece di guardarlo a regime — il numero da riportare nel PR è per quanti millisecondi
la pagina ha mentito, prima e dopo. Attenzione a rallentare DOPO il caricamento iniziale, o è la
prima pagina a non arrivare mai e sembra un altro guasto.

### Build e dev server lungi dal tool di shell
`npm run build` di questo repo dura ~4 minuti: lancialo in `nohup … &` e sondalo col log, il timeout del tool di shell uccide il processo (e lascia esbuild a metà: la dev server dopo parte con `write EPIPE`). La dev server del worktree ha la sua porta (`--port 5185 --strictPort`) — il 5173 è di chiunque arrivi prima. E il comando che LA VA A PROVARE con `curl` in blocco va in timeout e trascina via il process group: lancia il server staccato (`disown`), verifica con un comando successivo.

## Codice

### Un blocco che dichiara CHI è l'agente va in TESTA, o perde contro il prompt che lo precede
Il brief del DM lo aveva già pagato — in coda il modello salutava l'utente per nome — e per questo
sta in testa in `live.ts` e in `queue.ts`. Il blocco del custom agent, che è la stessa cosa (una
dichiarazione d'identità, non un compito in più), è rimasto in coda: dopo
`You are Content Creator (…), an Anomalia agent.`, le istruzioni del mestiere, fino a 32 KB di
memoria e l'indice dei file. Segnale: un agente custom con una voce molto caratterizzata che **a
volte** si presenta col nome dello specialista sottostante — intermittente, perché fra le due
identità ci sono decine di migliaia di caratteri e vince chi capita. Mossa: ogni blocco che
dichiara identità o cornice va prima di `buildSystemPrompt`, non appeso in fondo; e quando ne
sposti uno, chiediti quali ALTRI blocchi hanno la stessa natura e sono rimasti indietro. Il
motore classico ha ancora la stessa forma in due punti (`chat/queue.ts`, `chat/lib/turn-prep.ts`).

### Una regola chiusa su una superficie sola resta aperta su tutte le altre
La migration `0187` dichiarava chiuso il buco del consenso all'immagine, e sul browser lo era:
`addPersonReal` rifiuta senza la spunta e timbra `consent_at`/`consent_source`. L'endpoint gemello
(`POST /api/v1/.../studio/people`, la porta di CLI e MCP) continuava a scrivere `consent: true`
incondizionatamente — e il gate a valle si fida di quella colonna, quindi passava. Nessun test era
rosso: la regola non stava in nessun posto, stava in due call site, e uno solo è stato aggiornato.
Segnale: una migration o un changelog che dice «da qui in poi si fa X», e un `grep` del valore che
X scrive che trova più di un punto che lo scrive. Mossa: la decisione diventa una funzione pura che
tutti chiamano (qui `people-consent.ts`), e il test sta sulla funzione — non su ciascuna superficie,
che è come si è arrivati a due.

### Un dettaglio eliminato non si invalida prima di uscire
Il reject del post cancellava la riga, poi aggiornava la pagina `/posts/:id`: il layout trovava
correttamente un 404 prima che il callback portasse al calendario. Segnale: la pagina 404 lampeggia
solo dopo una cancellazione dal dettaglio. Mossa: sul successo distruttivo navigare subito e lasciare
che la nuova pagina carichi i dati; `update()` resta per errori e modifiche non distruttive.

### Markdown venduto: file veri + `?raw`, non template literal
Skill e guide upstream restano file `.md` diffabili contro upstream, inlineati con `import x from './x.md?raw'` (pattern di `agent-files.ts`). 43KB di markdown in un template literal sono mine: backtick e `${` nel testo upstream rompono la compilazione in modo opaco.

### Un parser, due usi
Il frontmatter di una skill non si riscrive: `parseSkillFrontmatter` esiste già in `harness-skills.ts` e serve a chi vendeva skill da file o da stringa. Prima di duplicare un parser, cerca chi lo usa.

### Config senza consumatori non si scrive
Una colonna `skills` su `custom_agents` era la mossa ovvia per "skill per custom agent". Ma i custom agent girano sul motore classico, fuori dal percorso kit: nessuno l'avrebbe mai letta. Il criterio: questa separazione dà un beneficio reale **adesso**? Se la risposta è "quando i custom agent saliranno sul kit", la mossa è un commento in LESSONS, non una migrazione.

### Il fallback è parte del contratto
`skillsForAgent(unknown)` restituisce le skill di scrittura, non `[]`: un agente non noto non deve girare a mani vuote per una stringa sbagliata. Ogni selezione per-chiave decide esplicitamente cosa succede fuori mappa.

### `Object.fromEntries` non riempie un `Record<K, V>`
Il typechecker rifiuta: `Type '{ [k: string]: ... }' is missing properties from Record<TeamAgentId, ...>`. La mappa scritta a mano è anche più leggibile di una generata — scrivila letterale.

### L'ordine atteso va calcolato, non scritto a memoria
`expect(sorted).toEqual(['a', 'z', 'm'])` fallisce perché l'hai scritto in ordine di pensiero. `[...base, extra].sort()`, come il ricevente.

### La PR che dice "risolto" è verificata solo sul primo invio, non sul redo
La PR #24 verificava l'immagine allegata al primo messaggio: viaggia come data-URL, una **stringa**, e sopravvive a ogni trasformazione. Sul redo la history ricostruita porta l'URL come **oggetto `URL`**, e `stripProviderRefs` lo ricostruiva via `Object.entries` — che per un `URL` restituisce `[]` — lasciando `image: {}`: l'adattatore pi scarta in silenzio e il modello risponde di vedere solo il testo `[attached: url]`. Il difetto visivo tornava solo sui turni ricostruiti (redo, retry, continuazione), mai su quelli che la verifica aveva coperto. Segnale: il reasoning dell'agente dice "l'utente ha allegato un'immagine via URL… non percepisso nessun contenuto visivo". Mossa: riprodurre l'INTERA catena di trasformazioni che il messaggio subisce (ricostruzione history → strip → adattatore), non solo l'invio felice; e ogni funzione che riscrive ricorsivamente i messaggi ha il suo unit test su parti multimodali, non solo su parti testuali.

### Chi pota un log concorrente pota per ULTIMO, non nel punto semanticamente giusto
I `progress` del turno kit venivano cancellati accanto alla riga definitiva — il momento in cui
il messaggio davvero *supera* le istantanee. Ma `mirrorSseToRun` è un ramo concorrente al driver
che chiude il run: la sua scrittura in volo passa davanti alla cancellazione e lascia righe
orfane che nessuno supererà più. Segnale: un test di potatura che vede ancora le righe subito
dopo la chiusura, e le vede sparire se aspetti. Mossa: potare nel `finally` dell'ULTIMO scrittore
(lì lo specchio, che è anche l'unico a scrivere quelle righe), non dove la semantica sembra
chiederlo — e chiedersi se l'altra chiamata non fosse codice morto: lo era.

### Una migration che ELIMINA una firma rompe la produzione prima ancora del deploy
Qui i deploy non applicano le migration, quindi fra l'apply e il deploy del codice c'è una finestra
in cui la produzione chiama ancora la firma vecchia. `0229` toglieva `agent_kit_close_run` a cinque
argomenti per sostituirla con quella recintata dal lease: applicata da sola avrebbe fatto fallire
OGNI chiusura di turno finché il codice nuovo non fosse arrivato — e la chiusura è ciò che salva la
risposta. Segnale: una migration il cui diff contiene `drop function` o un cambio di firma, su una
funzione che il codice deployato chiama. Mossa: i parametri nuovi hanno un default e il vincolo vale
solo quando sono valorizzati, così la chiamata vecchia continua a risolvere; renderli obbligatori è
una migration DOPO il deploy. E la vecchia firma si elimina comunque nella stessa migration: due
overload che accettano gli stessi nomi rendono la chiamata ambigua (`function is not unique`).

### `git commit -a` non aggiunge i file NUOVI: la PR parte senza i documenti che cita
`-a` mette in stage solo i file gia` tracciati. In una sessione sola ha lasciato fuori dalla PR #90
due ADR, due changelog e un file di test — tutti creati in quella stessa sessione — e il corpo della
PR rimandava a `docs/adr/0004` che nella PR non c'era. Nessun errore, nessun avviso: il commit
riesce e il diff sembra completo. Segnale: `git status --short` dopo il commit mostra righe `??`.
Mossa: `git add -A <percorsi>` esplicito prima del commit, e `git status --short` come ultimo gesto
prima di aprire la PR — deve essere vuoto.

### Cancellare l'utente NON distrugge il brand di prova: gli eval perdono un brand per giro
La regola dice che il brand di prova va distrutto sempre, e `deleteEvalUser` sembrava bastare. Non
basta: il brand pende dall'ORGANIZZAZIONE, non dall'utente, e resta a terra. In produzione ci sono
4 brand `eval-mt*` dai giri di `eval:ux` fra il 24 e il 26 agosto, ognuno con la sua organizzazione.
Segnale: `select count(*) from brands where slug like 'eval-%'` maggiore di zero a eval fermo.
Mossa: nel `finally` si cancella l'ORGANIZZAZIONE per prima (il brand se ne va in cascata) e poi
l'utente. E il caso che perde davvero è la creazione fallita a METÀ — utente già creato, nessun
fixture restituito, `destroyFixture(null)` che esce subito: la creazione ripulisce da sola prima
di rilanciare.

### Una `list()` piatta su un bucket non pulisce uno Storage che annida per brand
Stessa pulizia, un piano più sotto. `deleteEvalUser` faceva `storage.from('media').list(userId)` e
cancellava `${userId}/${nome}`: ma sotto `<userId>/` ci sono CARTELLE, quindi chiedeva di
cancellare `<userId>/library` — che non è un oggetto — e Supabase rispondeva `200` con una lista
vuota. Intanto `brand-knowledge/<userId>/<brandId>/media/` non veniva nemmeno aperto. Segnale: la
pulizia "riesce" sempre e `storage.objects` continua a crescere; in produzione l'asset importato
di un giro di eval era ancora lì. Mossa: attraversare RICORSIVO (in `list` una cartella torna con
`id` nullo) su OGNI bucket — `listBuckets()`, non una lista di nomi scritta a mano che ricomincia
a perdere al primo tipo di asset nuovo — sempre sotto `<userId>/`, che è il prefisso imposto dalle
policy di Storage e non una convenzione. E il test che vede il difetto asserisce QUALI percorsi
sono stati cancellati: «la pulizia è stata chiamata» passa anche quando non cancella niente.

### Una pulizia best effort che fallisce in silenzio si accumula per mesi
Il `.catch()` muto sulla pulizia dello Storage è la ragione per cui nessuno ha visto i file
restare: best effort è giusto — un eval non deve fallire perché la pulizia è fallita — ma muto no.
Segnale: nessun errore da nessuna parte e lo spazio che cresce. Mossa: `swallow('…')` invece di
`catch(() => {})`, così l'errore finisce su stderr e su Sentry e la pulizia resta non bloccante.

### PostgREST tiene in CACHE lo schema: la migration applicata in locale non basta
Applicate 0226/0227/0229 allo stack locale, la chat continuava a ricadere sul percorso vecchio e la
lettura per cursore rispondeva 503. La RLS era sana (provata a mano: l'utente leggeva i suoi eventi),
il codice era giusto, e il colpevole era il container `rest`: PostgREST aveva la cache dello schema
di PRIMA della migration, quindi per l'API `thread_events` non esisteva. `loadThreadEvents` cattura
l'errore e torna `null`, e tutto scivola in silenzio sul fallback. Segnale: dopo una migration
locale, un endpoint che nomina la tabella nuova risponde vuoto o 503 mentre psql la vede benissimo.
Mossa: `notify pgrst, 'reload schema'` e, se non basta, `docker restart anomalia-rest`.

### Il `catch` muto nel load nasconde proprio la causa che ti servirà
`loadLiveRun(supabase, thread).catch(() => null)` sembrava prudenza: un caricamento pagina non deve
rompersi per una lettura accessoria. Ma quando il parziale non compariva, quel catch aveva ingoiato
l'unica informazione utile, e ho perso mezz'ora a interrogare il database invece di leggere l'errore.
Mossa: il catch che protegge il caricamento LOGGA sempre prima di tornare `null`. Ingoiare l'errore
e ingoiare la diagnosi sono la stessa riga.

### Vite: dopo aver toccato un `package.json` di `packages/`, il browser resta su hash morti
Aggiunta una subpath export a `@anomalia/agent-kit`, la pagina ha smesso di idratarsi con
`Failed to fetch dynamically imported module: .../nodes/150.js`. Non era il mio modulo: era
`/node_modules/.vite/deps/@lucide_svelte.js?v=<hash>` in 404 — l'ottimizzatore aveva rigenerato le
dipendenze con hash nuovi. Segnale: la pagina non idrata, nessun effetto gira, e in console un
`Failed to fetch dynamically imported module` su un nodo di rotta che via `curl` risponde 200.
Mossa: `rm -rf node_modules/.vite .svelte-kit/generated` e riavvia il dev server.

### Un turno kit reale dura ~80s: il test che asserisce a 10 secondi misura il nulla
Il primo stress nel browser dava tutto verde in 9 secondi, e in chat non c'era nessuna risposta: il
modello (glm-5.3-flash, con reasoning) impiega ~80s e le mie asserzioni guardavano `body.innerText`,
che comprende la barra laterale — quindi «testo presente» era sempre vero. Segnale: un turno che
«finisce» in pochi secondi e conteggi di caratteri a quattro cifre che non cambiano. Mossa: asserire
sulla BOLLA (`.assistant-msg-wrap`), non sul body, e considerare finito un turno solo quando la riga
assistant esiste in `chat_messages` — il DOM dice cosa si vede, il database dice cosa è successo.

### `progress` a zero dopo un turno finito è la POTATURA che funziona, non un difetto
Cercavo le istantanee durevoli a turno concluso e ne trovavo zero, e per un momento ho creduto che
la corsia non scrivesse. Le scrive: guardate DURANTE il turno erano 259 in 90 secondi, la cadenza dei
250ms. A fine turno il messaggio definitivo le supera e il `finally` dello specchio le cancella —
esattamente il disegno della ADR 0004. Mossa: una corsia potata si osserva in volo, non a terra.

### Un glob di intercettazione che prende anche il MODULO col nome dell'endpoint accusa il prodotto
`page.route('**/kit-run**')` per provare cosa succede quando il poll fallisce: intercettava anche
`src/routes/app/[brand]/chat/components/kit-run.ts`, cioè il modulo sorgente con lo stesso nome.
Abortito quello, la pagina non si idrata, niente si disegna, e i tre casi provati (rete caduta, 500,
204) risultavano TUTTI E TRE rotti — compreso quello che funzionava. Segnale: intercettando qualcosa,
il conteggio delle richieste è 1 e non decine, e il difetto sembra colpire anche i casi che il codice
gestisce chiaramente. Mossa: intercettare per PATHNAME esatto (una regex sull'URL), mai per un glob
che un file sorgente può soddisfare — e prima di credere a un difetto, misurare il caso base senza
intercettazione.

### Un cancello messo un livello sopra il chokepoint non è un cancello: è una delle porte
Il consenso alla likeness era controllato in `resolvePeopleVisualRefsDetailed` — un livello sopra
`signPersonImages`, che è il punto dove la foto di una persona reale diventa davvero un URL
firmato. Otto chiamanti firmano quelle foto; uno solo passava dal cancello. `media-refs` non
selezionava nemmeno la colonna `consent`, e il workbench renderizzava una persona che la chat
rifiutava per nome: stessa regola, due risposte secondo la porta. Segnale: una regola che vale su
un percorso e non su un altro, e un `select` che non nomina la colonna su cui la regola decide —
la regola non è stata aggirata, non è mai stata chiamata. Mossa: il cancello sta **sul
chokepoint**, cioè sulla funzione che tutti devono attraversare per ottenere la cosa pericolosa,
e prende la riga intera invece del campo già estratto; se sta più in alto, prima di dirlo chiuso
conta i chiamanti del chokepoint e verifica ciascuno.

### Un trigger `after insert` su una riga che poi viene AGGIORNATA perde tutto ciò che viene dopo
`thread_events` — il log da cui la UI della chat proietta il thread — si riempiva da
`chat_messages_capture_event`, un trigger `after insert`. Ma il checkpoint del battito
(`bridge/live.ts`) INSERISCE la riga dell'assistente vuota e poi la AGGIORNA a ogni battito: nel log
restava la fotografia del primo istante. Un thread reale in produzione aveva 60.700 caratteri di
reasoning e 10.236 di tool_calls nella riga di `chat_messages`, e `0` e `0` nell'evento — con
`loadThreadUiHistory` che ricade su `chat_messages` solo quando gli eventi sono ZERO, quindi non ci
ricadeva mai. Per l'utente il turno era sparito; nel database non mancava niente.

Segnale: un turno che «è scomparso» ma di cui il modello ha memoria, o due messaggi identici di
salvataggio in coda a un lavoro lungo. Confronto che chiude la diagnosi in una query:
`length(payload->>'content')` dell'evento contro `length(content)` della riga, sullo stesso id.

Mossa, e vale oltre questo caso: **prima di scrivere un trigger `after insert`, chiedi se qualcuno
aggiorna quella riga.** Se sì, o il trigger copre anche l'UPDATE, o il log è una bugia dal secondo
battito in poi. Qui l'evento resta immutabile (`append_thread_event` solleva sul payload diverso, ed
è giusto): l'aggiornamento entra come evento NUOVO con la sua `source_key`, di cui se ne tiene UNA
sola, e il reducer sostituisce il messaggio con lo stesso id invece di accodarlo.

## Build e bundle

### Nel bundle esbuild un modulo che lancia in cima lancia UNA volta sola
`billingProvider()` dichiara assente il provider anomalia nel modo ESM naturale: il modulo lancia
in valutazione, il `try/catch` assorbe e si ricade su quello aperto. In ESM standard regge per
sempre — un modulo in errore rilancia lo stesso errore a ogni import. Nel bundle esbuild del
worker no: `__esm` azzera il proprio flag PRIMA di eseguire il corpo, quindi dal secondo giro
l'init non lancia piu`, torna il namespace vuoto, e la destrutturazione da` `undefined`. In
produzione: primo job dopo ogni restart ok, tutti gli altri morti con `Cannot read properties of
undefined (reading 'gate')`. Segnale: un errore che sul worker c'e` e su Vercel no, e che risparmia
la prima invocazione dopo ogni deploy. Mossa: l'assenza di un modulo non si legge dal `throw` — si
legge dall'export (`x ?? fallback`), col `try/catch` a coprire solo il primo giro.

### Un chunk sovradimensionato non è il colpevole del build che muore per memoria
`index3.js` (5,4 MB, dieci volte il secondo chunk) era `simple-icons` intero, bundlato via `ssr.noExternal` per un motivo Vercel-only (nft duplica il pacchetto per funzione) che non vale per `DEPLOY_TARGET=node`. Rimuoverlo lo porta a 295 KB (-94,5%) — ma bisecando `--max-old-space-size` (4096/4608/5120) il build muore e riesce agli stessi tetti prima e dopo: zero spostamento. Strumentando `adapter-node`'s `adapt()` (scritture sincrone `appendFileSync`, non `console.error` — l'OOM abort salta il flush dei buffer stdio e perde l'ultimo log) l'heap è già a ~3,4 GB PRIMA che `adapt()` faccia alcunché di suo, durante la sola copia/compressione asset. Segnale: bisecare il tetto di memoria prima e dopo un fix e vedere la stessa soglia di crash — il chunk grande era un difetto reale (fix corretto, va tenuto) ma non la causa del crash. Mossa: non fidarsi della dimensione di un chunk come proxy del picco di memoria; misurare il picco stesso, e quando serve isolare DOVE cresce, strumentare con scritture sincrone perché un OOM non flush-a l'output normale.

### `git checkout --ours <file>` in un merge BUTTA anche le fusioni riuscite di quel file
Un conflitto solo in `live.ts` fra il lease (dev) e la sandbox riusata (#96): risolto con
`git checkout --ours src/lib/agent/bridge/live.ts`, che NON risolve il pezzo — riporta il file
INTERO alla versione nostra, cancellando tutte le hunk che git aveva gia` fuso bene da `theirs`.
Sparito in silenzio tutto il lavoro del lease appena mergiato: `claimRun`, `publishProgress`,
`RUN_LEASE_TTL_MS`, `resumeRunId` a zero occorrenze, nessun errore, nessun marcatore residuo.
Segnale: dopo `--ours`/`--theirs` su un file, i simboli che l'ALTRO ramo aveva portato non ci sono
piu`. Mossa: contare le occorrenze dei simboli di ENTRAMBI i rami dopo ogni risoluzione, e risolvere
la singola hunk (a mano o con un merge tool), mai il file intero.

### `describe.skipIf` salta i TEST, non il corpo della suite
`sandbox-leases.integration.test.ts` costruiva il client Supabase dentro il corpo della describe
saltata: vitest esegue comunque quel corpo per raccogliere i test, quindi su ogni macchina senza
`SANDBOX_TEST_SUPABASE_URL` la RACCOLTA moriva con «supabaseUrl is required» e si portava giu` la
suite intera per un test che non doveva nemmeno partire. Segnale: `Test Files 1 failed` con
`Tests: no tests` — un file che non arriva neppure a eseguire un caso. Mossa: tutto cio` che ha
bisogno dell'ambiente nasce in `beforeAll`, che una suite saltata non esegue.
### Una guardia su una variabile che l'harness mette SEMPRE non e` una guardia
`onboarding.real.spec.ts` si proteggeva con `test.skip(!PUBLIC_SUPABASE_URL, ...)`, e in CI falliva
sempre: quella variabile la mette `playwright.config.ts` come SEGNAPOSTO
(`http://localhost:54321`), quindi c'e` sempre e lo skip non poteva scattare. La sua presenza non
dice che dietro ci sia un database vero con l'utente seminato — dice solo che l'app ha di che
partire. Segnale: un test «condizionale» che non salta mai, e che fallisce solo dove l'ambiente e`
piu` povero. Mossa: consenso ESPLICITO come per gli altri test di integrazione del repo
(`E2E_REAL_STACK=1`, come `SANDBOX_HOLDER_INTEGRATION=1`), e poi provare che con lo stack vero il
test passa davvero — una guardia che nasconde un test rotto non vale niente.

### Un finto client che IGNORA la select regala colonne che il database non ha
`team_activity` chiedeva `speaker` a `chat_messages`, dove la colonna si chiama `name`: PostgREST
risponde 42703, supabase-js torna `data: null` SENZA alzare, e lo strumento restituiva vuoto in
silenzio. I test passavano perché il loro `fakeClient` restituiva l'array seminato tale e quale,
select o no — quindi il campo inventato c'era sempre. Segnale: `schema-drift-check` che segna una
colonna «che il codice nomina e non esiste» mentre la suite e` verde. Mossa: il finto PROIETTA le
colonne chieste e applica gli alias `alias:colonna`, come fa PostgREST; con quello i test sono
diventati rossi da soli, e solo dopo si corregge la query. Un finto piu` generoso del database non
e` un finto, e` una benda.

### La CI verde non dice che la produzione si COSTRUISCE: `npm ci` contro `npm install`
Due deploy di produzione di fila in ERROR su `patch-package cannot apply`, con la CI verde sugli
stessi commit. La CI usa `npm ci`, che CANCELLA `node_modules` prima di installare; Vercel usava
`npm install`, che riusa l'albero ripristinato dalla cache — e su un albero gia` patchato
patch-package si rifiuta, dicendolo esplicitamente («Try removing node_modules and trying again»).
Segnale: build di produzione rossa su patch-package mentre `npm ci` in locale e in CI passa, e
nessun file di patch e` cambiato nel commit incriminato. Mossa: `installCommand: "npm ci"` in
`vercel.json`, cosi` la produzione costruisce con lo stesso comando che i test hanno provato — e un
test che lo pinna, perche` la prossima volta il sintomo sara` di nuovo «ma la CI e` verde».

E la lezione dietro la lezione: un merge in `main` che passa i check NON e` un rilascio. Il
deployment va guardato (`state`), o si festeggia una consegna che non e` avvenuta.

### La suite spediva DAVVERO: un test non sveglia nessuno
Ops riceveva segnalazioni `agent_kit_stream` con dentro `thread: t-retry-no-sandbox`, `brand b1`,
`user u1` e uno stack che punta a `live.test.ts`: la suite gira col `.env` di chi la lancia — chiavi
vere di Sentry, PostHog e Resend — e `reportChatError` partiva sul serio. Segnale: una segnalazione
il cui `detail` nomina entita` che esistono solo nei fixture. Mossa: la guardia sta nella SORGENTE
(`reportChatError` e `sendEmail` escono subito sotto `process.env.VITEST`), mai nei mock dei singoli
file — `live.test.ts` non mockava `report-error`, e bastera` un altro file distratto perche' ricominci.
Il `console.error` resta: serve a chi guarda la suite. Il danno peggiore non e` il rumore, e` che una
segnalazione finta rende sospette anche quelle vere.

## Prodotto

### La differenza per-agente si chiama mappa, non sottosistema
"Ogni agente ha le sue skill" non ha richiesto colonne, UI né permessi: un `agentId` nel contratto del turno e una `Record<TeamAgentId, string[]>`. La generalizzazione vera è il posto dove la prossima differenza è una riga.

### Una skill va assegnata se il mestiere la tocca, non per simmetria
Motion prende `remotion-best-practices` perché è l'unico che scrive sorgente Remotion. Assegnare skill a tutti "per uniformità" ricrea il problema di partenza: il mazzo uguale per tutti.

### La continuazione senza testo per il modello muore due volte
Una ripresa accodata con `user_message` vuoto è morta due volte prima di chiamare il modello: prima col gate `Missing user_message`, poi — superato il gate — col prompt vuoto, perché il provider rifiuta una conversazione che non apre con un turno `user` e `dropLeadingAssistant` mangia l'apertura firmata. Il segnale: `chat_jobs.status='failed'` con errori diversi per lo stesso job. La mossa: una continuazione porta SEMPRE un testo solo-per-il-modello (mai salvato, mai mostrato), come `enqueueTurnContinuation`; `open_session_with_user` era nata rotta così ed è sopravvissuta mesi perché la coda è buio per i test unitari — è la verifica nel browser che l'ha vista.

### Una media di produzione non dice che quel percorso sia ancora vivo
`onboarding_step_jobs` dava medie perfettamente credibili — research 301s, competitors 31s — e su
quelle stava per partire una PR che accorciava il wizard. Ma l'ultima riga di QUALUNQUE tipo era
del 12 agosto, e la diagnosi era del 1 settembre: il percorso era morto da tre settimane, staccato
dal flusso critico quando l'early-create ha portato l'utente dritto in chat. Una `avg()` non ha
data; sembra viva per sempre. Segnale: numeri che descrivono un percorso che nel codice non ha
nessun ingresso — cerca chi linka la rotta prima di crederci. Mossa: con la media chiedi SEMPRE
`max(created_at)` e un conteggio a finestra (`count(*) filter (where created_at > now() - '7
days')`), e incrocia con lo stato che il percorso lascia (qui: zero `onboarding_completed_at` dal
3 agosto, mentre i piani editoriali continuavano a nascere — dalla chat).

### I selettori di una pagina pubblica sono un contratto con l'eval, che in CI non gira
Riscrivere la seconda fase di `/start` ha tolto `button.scard`, e `scripts/eval/ux/walk.ts` ci
clicca sopra. `npm run eval:ux` costa soldi e si lancia a mano: la rottura non sarebbe diventata
rossa in nessuna PR, sarebbe marcita fino alla prossima run manuale, che è il modo più lento
possibile di scoprirla. Segnale: tocchi il markup di `/`, `/start`, `/login` o dell'onboarding.
Mossa: `grep` dei selettori che cambi dentro `scripts/eval/` PRIMA di considerare finito il
lavoro — la camminata è codice che nessun test protegge, quindi la protezione sei tu.

## L'immagine del self-host non entra in un builder Docker da 8 GB

**Segnale.** `docker compose build` sull'immagine app fallisce in due modi diversi, e vanno
distinti: `ResourceExhausted: cannot allocate memory` è la VM che rifiuta, `FATAL ERROR:
Ineffective mark-compacts near heap limit` è il tetto di heap troppo basso. Il primo dice che hai
chiesto troppo, il secondo che hai chiesto troppo poco.

**Mossa.** Non bisezionare `--max-old-space-size`: con 7,75 GiB di VM la finestra è chiusa (4096
va in heap overflow a 3,4 GB, da 4608 in su la VM non alloca). Il consumo viene da `adapter-node`
su un chunk server da 5,1 MB, non dal flag. Misura il picco con `/usr/bin/time -l` e riduci il
bundle; alzare la memoria di Docker Desktop nasconde il problema senza risolverlo per chi installa.

## Una funzione che pretende un ordine va chiamata col nome dell'ordine che pretende

**Segnale.** La conversazione intera capovolta — la risposta sopra la domanda — e i messaggi più
vecchi al posto dei più recenti quando il thread supera il limite. Non «ogni tanto disordinata»:
sempre, e solo sulla lettura che passa dal log degli eventi.

**Causa.** `chronologicalTail(newestFirst, limit)` fa `slice(0, limit).reverse()`: è corretta solo
se l'input arriva `order('created_at', desc)`. Un secondo chiamante le ha passato la proiezione del
log, che esce in ordine di `seq` — cioè al contrario. Il tipo era `T[]` in entrambi i casi, quindi
il compilatore non aveva niente da dire, e il ramo di fallback restava giusto: la suite verde per
tutti e due.

**Mossa.** Il presupposto sta nel NOME, non in un commento: `chronologicalTail` per una lista
`desc`, `newestTail` per una già cronologica. E un ramo di lettura aggiunto senza test è il posto
dove questo ricapita: il test che ordina quattro messaggi costa tre righe.

## Un `$effect` che legge lo stato che scrive è un cappio, non un poll

**Segnale.** Ricaricando a metà turno la chat resta «attiva» ma non si muove più niente: il
contatore fermo, nessun testo, nessun tool, nessun pensiero. Sembra uno stream perso; è il
contrario, è troppo lavoro.

**Causa.** Il corpo dell'effetto chiamava `poll()` in modo sincrono, e `poll()` leggeva `orphanRun`
prima del primo `await` — quindi lettura tracciata. La risposta riscriveva `orphanRun`,
invalidando l'effetto, che si smontava e rimontava chiamando subito `poll()`. Misurati **3378 giri
in 10 secondi** contro uno ogni 350ms previsti: il thread principale saturo non ridipinge, e da
fuori si legge come «lo stream si è perso».

**Mossa.** Le letture che servono a decidere il ritmo passano da `untrack`. E la misura che
distingue le due diagnosi opposte è una sola: contare le richieste. `window.fetch` avvolto per
dieci secondi dice in un colpo se il problema è che non parte niente o che parte tutto.

**E il test che non si può scrivere va dichiarato.** Il cappio è reattivo, e in questa suite gli
effetti Svelte non vengono eseguiti (`$effect.root` + `flushSync` conta zero esecuzioni del corpo):
un test lì passa identico con e senza il fix. Lasciarlo è peggio che non averlo — è una guardia
finta che il prossimo leggerà come copertura. Va tolto e il buco va scritto qui.

### In locale non gira nessun cron: il wizard che «pensa» per sempre non è un difetto del prodotto
L'onboarding resta a *«Drafting your editorial plan…»* all'infinito sullo stack locale, e sembra un
hang del piano editoriale. Non lo è: i job di `onboarding_step_jobs` vengono ripresi dal cron
`*/2 * * * *` su `/api/v1/onboarding/steps/work`, che in locale **non esiste**. Il job stalla dopo
`STALL_MS` (6 minuti), nessuno lo rimette in coda, e la pagina continua a pollare una riga
`running` che non avanzerà più. Il `[swallowed] fetch failed` nel log è il kick fire-and-forget del
worker che non ha risposto entro il timeout di undici — sintomo, non causa.
Mossa: fai il cron a mano prima di diagnosticare, e tienilo acceso per tutta la camminata:
`for i in $(seq 1 45); do curl -s --max-time 4 -X POST -H "x-autopilot-secret: $AUTOPILOT_SECRET" \
http://localhost:5220/api/v1/onboarding/steps/work; sleep 60; done`.
Vale per ogni `*/N` in `vercel.json` (radar, knowledge, chat queue, designer, webhooks): in locale
nessuno di quei lavori parte da solo, e ciò che sembra un blocco è una coda che nessuno drena.

### Una data «futura» scritta a mano in un test è una bomba a orologeria
`web_schedule_article` e `content_reschedule_post` passavano `scheduled_for: '2026-09-01T10:00'`, e
il test la chiamava «una data futura». L'1/9/2026 alle 10:00 quella data è diventata passato: i due
tool l'hanno rifiutata, giustamente, e i test sono diventati rossi **su ogni branch nello stesso
istante**, per sempre. La suite completa era verde alle 08:43 e alle 08:59 dello stesso giorno.

Il danno peggiore non è il rosso, è il verde che c'era prima: `content_reschedule_post` asserisce
`isError === true`, quindi ha continuato a "passare" mentre l'errore arrivava da un'altra causa —
un test che non verificava più la regola che dichiara di verificare, e che senza l'asserzione sul
messaggio non avrebbe mai detto niente.

Segnale: **«era verde stamattina e non ho toccato niente»**, con i file rossi lontanissimi dal tuo
diff. Prima di cercare il colpevole nel codice, guarda l'orologio e cerca date scritte a mano.
Mossa: la data si deriva da `Date.now()`, mai si scrive — `aDateInTheFuture()` in
`packages/agent-kit/src/testkit.ts`. Restano della stessa forma quattro `periodEnd: new
Date('2026-09-01')` (credit-warning, tool-policy, brand-studio-tools, content/ugc plugins): oggi
innocui perché nessuno li confronta con l'orologio, domani no.

### `npm run check` esce 0 con centinaia di errori: il verde è finto, conta la DIFFERENZA
Il typecheck di questo repo non è pulito — 346 errori su 171 file, tutti pre-esistenti — e
`svelte-check` **esce comunque 0**. Quindi «il check passa» non significa niente: né in locale né
in CI, dove un gate costruito sull'exit code sarebbe cieco per definizione.

È già costato un difetto vero, sfuggito a una suite di 6102 test verdi. Estraendo i fetcher in
`@anomalia/leads-core/feed` il factory era stato legato a `const sources = createSources(...)` a
livello di modulo, ma `sources` è già il nome delle righe di `brand_news_sources` lette dal
database in TRE funzioni di `radar.ts`: ognuna lo ombreggiava, e `sources.fetchSourceFeed(...)`
risolveva sull'array del database. I test non l'hanno visto perché quei percorsi
(`buildRadarFeedCache`, `radarDiagnose`, `radarScan`) toccano il DB e non hanno unit test — cioè
proprio la forma di guasto che i commenti di quel file raccontano: una sorgente che smette di
funzionare in silenzio e riporta «0 item».

Segnale: nessuno. Non c'è un rosso da cercare — la suite è verde e l'exit code è 0. L'unico
segnale è il **conteggio**: `COMPLETED <n> FILES <m> ERRORS` nell'ultima riga dell'output.
Mossa: prima di dire che il typecheck regge, confronta `m` con quello della base e cerca i tuoi
file per nome fra le righe `ERROR` (`grep ERROR out.txt | grep <i tuoi file>`). E l'output va
rediretto su un file tuo: quello del task in background viene troncato alla coda, quindi ci leggi
gli ultimi 40 errori e concludi il falso.

Corollario di progettazione: legando in un modulo grande le funzioni che arrivano da un factory,
**destrutturale** invece di tenere l'oggetto. Un oggetto con un nome generico (`sources`, `items`,
`data`) prima o poi lo ombreggia una locale, e TypeScript è l'unica cosa che te lo dice.

### PostgREST non risolve un overload: `is_approved()` + `is_approved(uuid)` = PGRST202 su ogni chiamata
Due funzioni con lo STESSO nome e firme diverse: quella senza argomenti finisce nella schema cache,
quella con il parametro no. `supabase.rpc('is_approved', { p_user })` torna
`PGRST202 — Could not find the function public.is_approved(p_user) in the schema cache`, e un
`notify pgrst, 'reload schema'` non la sistema. Segnale: un RPC che fallisce con PGRST202 su una
funzione che in psql esiste ed è eseguibile. Mossa: nomi distinti (`is_approved()` /
`is_user_approved(uuid)`), mai un overload esposto via PostgREST.

### Un predicato di accesso che fallisce chiuso chiude fuori i clienti che pagano
Corollario del precedente, ed è il difetto vero: con `return data === true` l'errore PGRST202
diventava un 403 per OGNI utente della API, approvati e paganti compresi. Una porta commerciale
non è un confine di sicurezza: il costo dei due lati non è lo stesso. Mossa: `if (error) return true`
— si fallisce aperto, e il caso sta in un test che nomina l'incidente.

### Il riempimento di una migrazione ri-approva tutti alla seconda esecuzione
`alter table ... add column if not exists` seguito da `update ... where <colonna> is null` sembra
idempotente e non lo è: la seconda applicazione riempie anche le righe nate DOPO la prima. Qui un
utente in attesa è diventato approvato senza che nessuno lo approvasse. Segnale: un backfill
condizionato sul valore della colonna invece che sulla sua esistenza. Mossa: il backfill sta dentro
un `do $$ ... if not exists (select 1 from information_schema.columns ...) then ...`, così gira
esattamente una volta, alla creazione della colonna.

### L'embed di Calendly si monta DUE volte se lo lasci allo scan automatico
Lo script `assets.calendly.com/.../widget.js` cerca da solo gli elementi `.calendly-inline-widget`.
Con l'idratazione di SvelteKit quello scan corre contro il mount del componente e inizializza due
iframe nello stesso div: quello che resta non finisce mai di caricare. Segnale:
`performance.getEntriesByType('resource')` mostra DUE richieste alla pagina Calendly per un solo
widget. Mossa: contenitore senza quella classe, script caricato in `onMount` e
`Calendly.initInlineWidget({ url, parentElement })` chiamata una volta sola.

### Una scheda vecchia lasciata aperta rimette in piedi la sessione che hai appena chiuso
Verificando un gate con due account, una scheda ferma su `/app/<brand>` con la sessione precedente
rinfresca il token e riscrive il cookie: il logout appena fatto nell'altra scheda viene annullato, e
l'utente non approvato risulta di colpo dentro. Segnale: dopo un cambio account atterri su una
dashboard a cui quell'utente non ha accesso. Mossa: chiudi ogni scheda dell'app prima di cambiare
identità, una sola scheda per verifica.

## Due app locali sulla stessa porta, una su IPv4 e una su IPv6

**Segnale.** `curl http://localhost:5174/...` risponde con la tua pagina, il browser sulla
stessa porta mostra un'altra applicazione, e `/app/...` dà 404 in browser mentre in curl è 200.

**Cosa succede.** `localhost` risolve a `::1` e `127.0.0.1` a IPv4: due processi Vite possono
tenere la *stessa* porta, uno per stack, senza che nessuno dei due dica "porta occupata". Qui
erano `anomalia` e `anomalia-leads`, entrambi su 5174.

**La mossa.** Avvia il dev server con una porta esplicita e un host esplicito, e prima di
crederci chiedi all'app chi è:

```bash
npm run dev -- --port 5200 --host 127.0.0.1
curl -s http://127.0.0.1:5200/login | grep -oE 'Anomalia|anomalia/leads' | head -1
```

Vite può comunque slittare di porta se trova occupato ("Port 5199 is in use, trying another
one"): l'unica porta di cui fidarsi è quella stampata nel log, verificata con la riga sopra.

## Un test che mocka il cancello di cui parla non dimostra niente

**Segnale.** Un test di route asserisce un comportamento di autorizzazione — «una chiave di sola
lettura passa», «un utente scaduto viene fermato» — e passa al primo colpo, senza essere mai stato
rosso per la ragione giusta. In cima al file c'è `vi.mock('$lib/server/cli-auth', …)`.

**Cosa succede.** Il verdetto che il test crede di misurare lo produce il mock, non il sistema.
È capitato con `check_content`: la route non chiama `checkApiKeyWriteAccess` perché sarebbe
ridondante, e il test concludeva che quindi una chiave di sola lettura arriva a calcolare. Falso:
`resolveCaller` nega **ogni** non-GET a una chiave `read` prima che la route parta. Il test
asseriva uno stato che la produzione non può produrre, quindi non poteva fallire mai — e intanto
diceva al prossimo lettore l'opposto della verità, che è peggio di non dire niente.

**La mossa.** Prima di asserire su un permesso, leggi dove il permesso viene deciso davvero, e
chiediti se il mock lo sta scavalcando. Se lo scavalca, resta una sola asserzione onesta: dato il
verdetto che l'upstream produce sul serio, la route lo rispetta e non lavora. Il resto — che
l'upstream produca quel verdetto — è un test dell'upstream, e va scritto lì o non va scritto.

## Un valore che il CHECK rifiuta è invisibile a una suite che mocka il database

**Segnale.** Una funzione che deposita qualcosa in una tabella «riesce» in ogni test e in
produzione la riga non c'è. Il codice scrive una stringa in una colonna con un `CHECK ... in (…)`,
e quella stringa non è nella lista. Nei log non c'è niente, perché il fallimento è gestito
best-effort: `{ error }` restituito al chiamante e mai stampato.

**Cosa succede.** Il vincolo vive nel database, il valore vive nel codice, e la suite mocka
Supabase: un insert finto accetta qualunque stringa, quindi il test è verde per costruzione. È
capitato a `brand_media.source`: `saveRenderedVideoToLibrary` scriveva `'ai'` e il `save_to_library`
della sandbox scriveva `'sandbox'`, nessuno dei due nel vincolo. Ogni video renderizzato veniva
pagato, caricato su storage e poi rifiutato dalla libreria con 23514 — l'esatto vicolo cieco che
quella funzione era stata scritta per chiudere. Il best-effort è la scelta giusta (non si fa fallire
un render pagato per un INSERT) ma trasforma il difetto in lavoro pagato e buttato in silenzio.

**La mossa.** L'insieme ammesso diventa **una costante esportata accanto al modello che governa la
colonna**, il campo è tipato su quella costante, e tre asserzioni la tengono onesta: la costante
confrontata con l'array dell'ultima migration che definisce il vincolo; una scansione del sorgente
che pretende ogni literal scritto in quella colonna dentro la costante; un `@ts-expect-error` sul
valore vecchio, che fa fallire `npm run check` il giorno in cui il tipo smette di mordere. Il test
che vale non è «il mock ha accettato l'insert» — quello non può fallire — ma «il valore è
nell'insieme che il database ammette», e va munito di un guardiano contro il passaggio a vuoto
(`written.length > N`): una scansione che non trova più niente deve fallire, non passare. E il
fallimento best-effort si fa sentire — `swallow()` dove `$lib` è già in casa, `console.error('[X] …')`
dove non lo è: resta non fatale, smette di essere muto.

**Il corollario che è costato due minuti in più.** `supabase-js` **risolve** con `{ error }` su un
23514, non rigetta. Un `.then(() => {}, () => {})` o un `.catch(() => {})` su una insert non vede il
vincolo nemmeno volendo: è gestione d'errore che non può funzionare. L'errore va letto dal valore
risolto.

## Il vocabolario di una colonna non si decide senza sapere CHI la legge

**Segnale.** Una correzione ovvia: un valore fuori dall'enum, sostituito con quello «giusto»
guardando la costante. Nessun test rosso, il vincolo passa, la PR sembra più pulita di prima.

**Cosa succede.** `posts.content_type` sembrava nomenclatura, e `post-from-asset.ts` ci scriveva
`image` e `carousel` — che sono FORMATI, non tipi. Sostituirli con `uploaded_image` era corretto
guardando `POST_CONTENT_TYPES` e sbagliato guardando `publish.ts:380`, che fa
`aiGeneratedMedia: !content_type.startsWith('uploaded')`: quel prefisso **è** la dichiarazione di
contenuto AI al momento della pubblicazione. Prima di quella modifica tutte e tre le forme
dichiaravano; dopo, immagini e caroselli presi dalla libreria smettevano di dichiarare. Un enum
allineato e una conformità spenta, nello stesso commit, senza un solo test rosso — perché nessun
test lega il prefisso di una stringa a ciò che viene dichiarato a un social.

**La mossa.** Prima di cambiare un valore in una colonna, `grep` di chi la **legge**, non solo di
chi la scrive — e in particolare di chi ne legge un *pezzo* (`startsWith`, `includes`, uno `split`),
perché quello non compare cercando il valore intero. Se un lettore ne ricava una decisione di
conformità, di pagamento o di pubblicazione, il valore non è nomenclatura: è un contratto, e la
riga accanto va letta prima di toccarlo. Il default in caso di dubbio lo dice già il commento
accanto a quella riga: sovra-dichiarare non è un rischio, sotto-dichiarare sì.

**Il corollario sul metodo.** A trovarlo non è stato un vincolo né la suite: è stato un altro
agente che leggeva la riga accanto per un lavoro diverso. E non e' «due persone attente»: ognuno
ha preso il difetto dell'ALTRO, mai il proprio. Chi scrive la modifica la rilegge da autore, e la
riga accanto la vede solo chi non ha una posta in gioco su quella modifica.

## Un `onConflict` sbagliato ha due facce: una non scrive, l'altra cancella

**Segnale.** Due segnali opposti, stessa causa. O una funzione riporta di aver salvato N righe e la
tabella non le ha — nessun log, nessuna eccezione, risultato positivo al chiamante. Oppure la
scrittura riesce e una riga che c'era prima non c'è più.

**Cosa succede.** `onConflict: 'brand_id,name'` esige un indice UNIQUE su quella coppia. Se non
c'è, Postgres risponde **42P10** (*no unique or exclusion constraint matching the ON CONFLICT
specification*) e `supabase-js` **risolve** con `{ error }` — non rigetta. Una chiamata che non
destruttura `error` non se ne accorge: su `competitors` esisteva solo `competitors_brand_idx`, che
è un indice normale, e il job «ri-cerca i concorrenti» riportava i concorrenti trovati scrivendo
zero righe. Non è un caso raro: `create index` e `create unique index` si leggono uguali di
sfuggita, e l'`onConflict` viene scritto guardando le colonne, non gli indici.

**L'altra faccia, che è la peggiore.** Se l'indice unico c'è ma è su una coppia DIVERSA da quella
che hai in testa, non c'è nessun errore: l'upsert riesce e **sovrascrive**. `brand_social_handles`
è unica su `(brand_id, platform)` — un handle per rete, non uno per nome — quindi scrivere un
secondo handle Instagram per lo stesso brand non ne aggiunge uno: cancella quello che c'era. È
stata una quasi-vittima in questa stessa PR, in due punti: la migration che spostava gli handle dal
campo sito (guardia scritta su `username`, cioè sulla colonna sbagliata: sarebbe morta con un 23505
abortendo TUTTA la migration) e il codice che li raccoglie in onboarding, che avrebbe silenziosamente
rimpiazzato un handle dichiarato dall'utente con uno dedotto da un campo compilato male. Il primo
caso fa rumore, il secondo no.

**La mossa per questa faccia.** Prima di un `onConflict`, leggi la coppia unica REALE e chiediti
cosa significa come regola di prodotto: `(brand_id, platform)` non è un dettaglio di indice, dice
«un brand ha un solo account per rete». Se la tua scrittura può produrre due righe che collidono su
quella coppia, stai scegliendo quale delle due sopravvive — quindi scegli esplicitamente
(`do nothing` per tenere l'esistente, `do update` per sostituirlo) invece di scoprirlo dopo.

**La mossa, per entrambe.** Ogni `onConflict` va verificato contro `pg_indexes` della tabella, non
contro l'intenzione: `select indexdef from pg_indexes where tablename = '<t>'` e cercare `UNIQUE`. È una
riga di SQL contro un difetto che non lascia tracce. E l'errore va **letto**: `const { error } =
await supabase.from(...).upsert(...)`, sempre — vale per il 42P10 come per il 23514.

## Un `catch` muto su un percorso di ricavi nasconde il difetto finché non lo cerchi a mano

**Segnale.** Nessun errore, nessun allarme, tutto verde — e un limite che non limita niente. Qui:
il gating crediti è stato spento in produzione per circa una settimana, l'AI girava senza quota
per chiunque, e non esisteva **una sola riga di log** che lo dicesse. È emerso solo perché
qualcuno è andato a leggere `billingProvider()` per un altro motivo.

**Cosa succede.** Un fallback permissivo scritto per un caso legittimo (il fork self-hosted senza
billing) copre anche il caso illegittimo (il provider a pagamento che non si carica in
produzione), e i due sono indistinguibili da fuori: entrambi restituiscono lo stesso provider che
concede tutto. Il `catch` senza log li appiattisce.

**La mossa.** Su un percorso che decide se si può spendere o incassare, il fallback si riporta —
`swallow()` (console + Sentry), una volta per processo se il chiamante è un hot path. E si
distingue sempre **la scelta** dall'**incidente**: `BILLING_PROVIDER=open` impostato di proposito
resta silenzioso, il fallback non voluto no. Un allarme che suona anche quando va tutto bene viene
ignorato, e allora tanto valeva il silenzio.

**Il test che lo tiene.** `src/lib/server/billing/fallback-report.test.ts`: il fallback riporta,
la scelta esplicita no, e riporta una volta sola.

## Una guardia che legge il nome dell'host, e segue i redirect, non è una guardia

**Segnale.** Una funzione scarica un URL e la difesa è una lista di pattern di hostname
(`isUrlSafe`, `!u.includes('localhost')`, una regex su `.local`), oppure il tetto di byte sta
DOPO un `await res.arrayBuffer()`, oppure `fetch` è chiamata senza `redirect: 'manual'`. Tre
sintomi diversi dello stesso difetto: ciò che viene controllato non è ciò che viene raggiunto.

**Perché non regge.** Il nome è scelto da chi attacca e il DNS pure: `cdn-innocuo.example` può
risolvere su `127.0.0.1` o su `169.254.169.254` e la stringa resta impeccabile. Il redirect è
peggio, perché la destinazione non l'hai nemmeno vista: un URL pubblico risponde `302 Location:`
e la guardia aveva già approvato l'unico URL che ha guardato. E un tetto applicato dopo aver
bufferizzato è un tetto che si applica a memoria già consumata — 100MB entrati per rifiutarne 5.

**Mossa.** Tre proprietà, e servono tutte e tre insieme:

- **risolvi, poi controlla** l'indirizzo che torna dal resolver, non l'hostname;
- **ricontrolla ogni hop** (`redirect: 'manual'` + ciclo tuo), schema compreso: un `302` da https
  a http consegna il file a chiunque stia sul percorso;
- **applica il tetto mentre il corpo arriva**, e per un file **rifiuta** invece di troncare — un
  JPEG tagliato è un asset corrotto salvato come se fosse intero.

In questo repo tutto ciò esiste già in `safeFetchBytes` (`tool-guard.ts`): **riusala, non
riscriverla.** Due copie di una guardia SSRF sono due guardie che divergono, e la seconda diverge
in silenzio. Se un chiamante ha bisogno di regole diverse (solo https, un tetto più alto, un altro
User-Agent) quelle sono *parametri* della guardia — mai un `if` prima della chiamata, che il ciclo
dei redirect non vedrebbe.

**Dove guardare per prima.** Le funzioni il cui URL lo sceglie un MODELLO: lì l'input è già
collegato a contenuto ostile, e il difetto smette di essere teorico.

**E il test che lo prova non è quello dell'esito.** Bufferizzare-e-poi-misurare restituisce lo
stesso rifiuto di fermarsi a metà: il test passa e non prova niente. Conta i pezzi che il lettore
TIRA — prima ne chiedeva 400 su un tetto di venti.

## Un fake che risponde alla domanda sbagliata nasconde il difetto che cercavi

**Segnale.** Uno stub di `fetch` fatto a mano: `headers: { get: () => 'image/png' }`, più un
`arrayBuffer()` e nessun corpo. Risponde `'image/png'` a `location` e a `content-length`, cioè
racconta una risposta che nessun server manderebbe mai — e il giorno che il codice sotto comincia
a leggere quegli header, o a leggere il corpo a stream, il test si rompe per il motivo sbagliato.

**Mossa.** Negli stub di rete usa una `Response` vera: `new Response(bytes, { status, headers })`.
Costa una riga in meno e non può mentire su un header che non hai previsto.

**Corollario sulle fixture.** Un URL di prova come `https://cdn.example` smette di funzionare nel
momento in cui la guardia RISOLVE l'host invece di leggerlo: il rifiuto arriva da `ENOTFOUND` e
non dalla proprietà sotto esame. Usa un indirizzo scritto per esteso (`https://93.184.216.34`):
`dns.lookup` lo restituisce senza interrogare nessuno, e resta pubblico.

## Un timeout nella suite completa non è un difetto finché non lo riproduci da solo

**Segnale.** `npm run test:unit` riporta `Hook timed out in 60000ms` o `Test timed out in
30000ms` su file che non hai toccato, e la stessa suite era verde un'ora prima.

**Cosa succede.** Il costo è il *transform* di Vite, non il test: con la cache fredda — o con
altri lavori pesanti sulla stessa macchina — il grafo di `$lib/agent/tools/index` supera da solo
il budget del `beforeAll`. Nella stessa sessione lo stesso file è passato in 53s e fallito a 60s
solo perché in parallelo girava un'altra suite.

**La mossa.** Prima di diagnosticare, isola: esegui il file DA SOLO, a macchina scarica. Se serve
la prova che il difetto non è tuo, salva le modifiche in una patch
(`git diff > /tmp/x.patch`, mai `git stash`), ripristina i sorgenti, riesegui: se fallisce anche
senza le tue modifiche, è ambiente. Il timeout del `beforeAll` scritto nel file vince sul flag
`--hookTimeout` della CLI, quindi per una diagnosi va alzato nel file e rimesso subito dopo.

## Un IPv6 può portarsi dentro un IPv4, e il divieto va all'indirizzo dentro

**Segnale.** Un classificatore di indirizzi privati che tratta l'IPv6 per come *comincia* —
`::1`, `^f[cd]`, `^fe[89ab]` — e l'IPv4 con le sue regole, senza che i due si parlino. Provalo
con `::ffff:127.0.0.1`: se risponde "pubblico", il buco c'è.

**Cosa succede.** `::ffff:127.0.0.1` (mapped), `2002:7f00:1::` (6to4) e `64:ff9b::7f00:1` (NAT64)
sono tutti modi di scrivere `127.0.0.1` dentro un IPv6, e l'indirizzo che viene chiamato davvero è
quello dentro. `dns.lookup(host, { all: true })` restituisce i record **AAAA verbatim**, quindi la
forma arriva alla guardia esattamente così: basta un AAAA su un nome pubblico. La forma con le
parentesi è rifiutata solo perché `URL.hostname` le tiene e la risoluzione fallisce — un rifiuto
per **effetto collaterale**, che sparisce il giorno che qualcuno normalizza l'hostname.

**Mossa.** Estrai l'IPv4 incapsulato e rimandalo alle regole IPv4, invece di allungare la lista
dei prefissi vietati: una lista si allunga a ogni forma nuova, e la forma nuova la scopri dopo che
ti è passata davanti. Espandi il `::` e leggi gli hextet per posizione — `::ffff:7f00:1` e
`0:0:0:0:0:ffff:7f00:1` sono lo stesso indirizzo e una regex sul prefisso ne vede uno solo.
Un IPv4 pubblico incapsulato deve restare pubblico: la regola è quella dell'IPv4, non un divieto
sul prefisso.

**E il test giusto non è quello del classificatore.** Quello prova la funzione; la proprietà che
conta è che `assertPublicUrl` rifiuti un host il cui **AAAA** è una di quelle forme — con
`lookup` sostituito perché restituisca `family: 6`. È il test che resta vero anche se domani il
rifiuto smettesse di arrivare dal ramo che lo produce oggi.

**Corollario generale.** Quando un rifiuto arriva "per fortuna" da un ramo diverso da quello che
dovrebbe produrlo (qui: «could not resolve» invece di «non è pubblico»), non è protezione: è una
coincidenza con la data di scadenza. Fissala in un test che nomina la proprietà, non il
meccanismo.
## Il file che leggi non è sempre il file che è in produzione

`https://mcp.anomalia.so/.well-known/oauth-protected-resource` annunciava
`authorization_servers: ["https://anomalia.so"]` mentre `authServerUrl()` in `cli/lib/config.ts`
— letto in questo repo, su `dev` e su `main` — restituisce `https://www.anomalia.so`. Nessuna
delle due letture era sbagliata: il progetto Vercel che serve quel dominio (`anomalia-cli`) è
agganciato al repo **pre-monorepo** `andreabuttarelli/anomalia-cli`, il cui `authServerUrl()`
ritorna ancora l'apex, e la cui ultima deploy di produzione è di tre settimane prima
dell'import nel monorepo. Il codice giusto non è mai arrivato in produzione perché nessuno
deploya quel dominio da qui.

Segnale: la produzione contraddice il codice che hai appena letto, e il `git log` del file
mostra un solo commit — quello di import — senza traccia della modifica che stai cercando.
Mossa: prima di diagnosticare, chiedi a Vercel **da quale repo e da quale commit** è servito
quel dominio (`list_projects` → `link.repo`, `list_deployments` → `meta.githubCommitRepo`).
Una funzione letta in locale non è una prova su cosa gira: il repo di origine è parte della
domanda.

**La regola dietro**: quando un dominio del prodotto non è servito dal repo in cui stai
lavorando, il repo non può ripararlo — può solo smettere di regredire. Il test di contratto
serve comunque, perché il giorno in cui il dominio torna a essere servito da qui il difetto
non rientra; ma la riparazione è ripuntare il progetto, e va detta come tale invece di essere
spacciata per un fix di codice.
## Una colonna che la migration non ha mai creato si traveste da «brand non trovato»

**Segnale.** Una lettura che «non può fallire» torna `null` per tutti — non per un tenant, non a
intermittenza: per tutti — e la superficie sopra risponde con un errore di chi chiama (404, «Brand
not found»). La suite è verde, perché il client Supabase è mockato e un mock non ha uno schema.

**Cosa succede.** `orgBillingForBrand` seleziona `plan, stripe_customer_id, stripe_subscription_id`
da `organizations`. In produzione quelle colonne non ci sono: la migration `20260903190000_org_billing_schema.sql`
non è mai stata applicata, perché i deploy di questo repo non applicano migration. PostgREST
risponde 400, `supabase-js` **risolve** con `{ data: null, error }`, la funzione ignora `error` e
restituisce `null`, e il chiamante legge quel `null` come «questo brand non ha un'org». Il bottone
del portale su `/app/billing` risponde 404 a chiunque, e sembra un problema di permessi.

**La mossa.** Prima di diagnosticare il codice, `node scripts/schema-drift-check.mjs`: è in sola
lettura, punta alla produzione senza paura, ed esce 1 con l'elenco delle colonne che il codice
nomina e il database non ha. Va eseguito **dopo ogni migration scritta e prima di ogni PR che
tocca il database** — non solo quando qualcosa è già rotto. Un `select` di colonne che potrebbero
non esistere non è mai «non può fallire»: o si legge `error`, o il difetto arriva travestito da
colpa di chi chiama.

## Una rotta SvelteKit esiste perché esiste un file di pagina

**Segnale.** Una pagina risponde `Not found` per tutti, e lo stack punta a `resolve()` dentro
`@sveltejs/kit`, non a codice tuo:

```
Error: Not found: /app/anomalia
    at resolve (node_modules/@sveltejs/kit/src/runtime/server/respond.js:711:13)
```

Nel `git log` recente c'è una PR che parlava d'altro — un cookie, un redirect, un ordine di
esecuzione — e che, fra le altre cose, ha **cancellato** un `+page.server.ts`.

**Cosa succede.** SvelteKit costruisce il manifest dai file. Senza né `+page.server.ts` né
`+page.svelte` la rotta non esiste, e il 404 nasce prima che parta un solo `load` — layout
compreso. Un rimando spostato «in cima al layout» non viene mai raggiunto: il guscio non entra
nemmeno in scena. È capitato a `/app/[brand]`: la home del brand è rimasta irraggiungibile per
tutti mentre i quattro test del rimando restavano verdi, perché provavano il `load` del layout e
il 404 avviene prima di lui.

**La mossa.** Svuotare una pagina del suo contenuto e lasciarci solo un `redirect` è legittimo;
**cancellare il file no**, perché toglie la rotta. Quando una pagina diventa un rimando, il file
resta e la ragione per cui resta si scrive dentro — è l'unica cosa che il prossimo lettore vede
prima di ricancellarlo. E la proprietà si fissa in un test che legge la cartella dal disco
(`readdirSync`, come gli altri 71 di questo repo), non nel `load`: quel test è l'unico che può
fallire per la ragione giusta. Munirlo del negativo, o passa a vuoto — qui una cartella di solo
endpoint (`credits/`, con un `+server.ts` e basta) che **non** deve risultare una pagina.

**Il corollario, se due rimandi sembrano uno di troppo.** Le due strade del server non si
comportano allo stesso modo, e la differenza decide chi vince: per una richiesta di pagina
(`server/page/index.js`) i `load` partono in parallelo ma i risultati si consumano **in ordine di
nodo**, quindi vince il layout; per la `__data.json` di una navigazione dal client
(`server/data/index.js`) è un `Promise.all` che rilancia il `Redirect` appena arriva, quindi vince
**il primo che rigetta**. Un rimando piazzato nella pagina chiude la risposta mentre il layout è
ancora dentro le sue query, e il `cookies.set` del layout trova la risposta già generata. Prima di
dichiarare ridondante una guardia, leggi quale delle due strade la esercita.

## Una patch «scaduta» può esserlo solo sulla tua macchina

**Segnale.** `patch-package` dice `Patch was made for version: X / Installed version: Y`, con Y più
nuova. Sembra ovvio: la dipendenza è andata avanti, la patch è da buttare.

**Cosa succede.** In questo repo ci sono due lockfile: `package-lock.json`, tracciato, che la CI usa
con `npm ci`, e `bun.lock`, non tracciato, che vive sulla macchina di chi ha lanciato `bun install`.
Divergono. Il primo pinnava `@ai-sdk/harness@1.0.87` — esattamente la versione della patch — mentre
bun aveva risolto la 1.0.101. La patch era **viva per tutti tranne che lì**, e cancellarla ha fatto
diventare rossa la CI e ha tolto due comportamenti veri: le scritture in blocco di `writeSkills`
(6,9 secondi di attesa) e la conservazione delle parti immagine nell'adattatore pi, che senza patch
**degrada in silenzio** invece di fallire.

**Mossa.** Prima di dichiarare scaduta una patch, leggi la versione nel lockfile **tracciato**, non
quella in `node_modules`. Se coincide con quella della patch, la patch è viva e il problema è
l'install che hai davanti.

**Corollario, e qui è il punto.** Tre errori nello stesso blocco sembravano tre conferme
indipendenti: due dicevano «la patch non applica», il terzo «il pacchetto non c'è». Erano tre
sintomi di **una causa sola** — l'albero di `node_modules` rotto — e nessuno dei tre parlava delle
patch. Dopo un `npm install` pulito applicano tutte e tre. Più errori insieme invitano a
concludere; guarda invece se hanno un antenato comune.

## Il catalogo di un gateway non elenca le sue superfici separate

Tre volte in un giorno abbiamo concluso «OpenRouter non lo fa» interrogando `GET /api/v1/models`,
e tre volte era falso. I **video** non compaiono lì: stanno su `POST /api/v1/videos` con catalogo
proprio su `GET /api/v1/videos/models`, 28 modelli. Il **text-to-speech** non compare lì:
`google/gemini-3.1-flash-tts-preview` vive su `POST /api/v1/audio/speech` e risponde
`audio/pcm; rate=24000; channels=1`, esattamente il formato che il nostro tagliatore pretende.

Il costo delle tre volte: una famiglia di tool video rimandata come impossibile, un `MISSING` che
dichiarava `tts` assente su openrouter mentre funzionava, e un'ora spesa a cercare un ripiego per
un limite che non c'era.

**Segnale**: un catalogo interrogato per modalità risponde «zero» per una capacità che il
fornitore documenta o pubblicizza. Un `GET` su un endpoint che vuole `POST` risponde 404, che si
legge identico a «non esiste».

**Mossa**: chiama il modello sull'endpoint che credi sbagliato e **leggi l'errore per intero** —
un gateway ben fatto ti dice dove sta la superficie giusta:

> `google/gemini-3.1-flash-tts-preview is a text-to-speech model and cannot be used with the
> chat/completions endpoint. Use the /api/v1/audio/speech endpoint instead.`

Vale anche per il messaggio che rifiuta un parametro: `does not support 'wav' when stream=true.
Supported values are: 'pcm16'` conteneva già la risposta, e chi si è fermato alla parola
«rifiutato» ha concluso che la voce non si potesse spostare.

**La regola dietro**: «l'ho cercato e non c'è» non è una misura finché non sai **dove** hai
cercato. Un'assenza va dichiarata con l'endpoint interrogato accanto, o è un'opinione travestita
da fatto — e finisce in `MISSING`, dove la testata promette «fatti misurati, non ipotesi di
listino».

## Un ciclo di import tenuto in piedi dall'ordine cade quando togli un import morto

Cancellato `genWithRetry` — zero chiamanti — e con lui l'`import` che stava alla **riga 2** di
`content-preview/images.ts`. Il server ha smesso di partire: `500` su ogni rotta, e nei log
`[vite] The dependency module is not yet fully initialized due to circular dependency`.

Il ciclo non l'avevo creato io. Era già lì, e si chiudeva così:

```
referrals → credits → scheduler → director → content-preview → caption-quality
    ↑                                                                │
    └───────────────── blog-site ◄─── images ◄───────────────────────┘
```

`images.ts` importava `blog-site.ts` per **una funzione pura di cinque righe** (`firstLogoUrl`,
che legge il primo logo da un array), e `blog-site.ts` è il blog pubblico intero: Marked, client
admin, referral. Finché la riga 2 tirava dentro `plan-pipeline` per primo, i moduli si
inizializzavano in un ordine in cui il cerchio si chiudeva dopo che i pezzi che servivano erano
già pronti. Togliere quell'import ha cambiato l'ordine, e basta.

**Segnale**: una cancellazione di codice morto — un import inutilizzato, una funzione senza
chiamanti — fa comparire `circular dependency` su moduli che non hai toccato. Il file nell'errore
(qui `referrals.ts`) non è il colpevole: è solo dove il cerchio si è chiuso per primo.

**Mossa**: non rimettere l'import morto, e non spostare la cancellazione. Trova il ciclo leggendo
in ordine i `Error when evaluating SSR module` nel log — sono la catena, dall'ultimo al primo — e
**taglialo dove il pezzo condiviso non ha dipendenze**: `firstLogoUrl` è finita in
`$lib/brand-fields.ts`, che è un foglio (zero import) fatto apposta per le funzioni pure sui campi
del brand. Un modulo pesante importato per un helper puro è sempre l'anello da tagliare.

**E la lezione più larga**: un ciclo che regge solo grazie all'ordine di inizializzazione è già
rotto, semplicemente non te l'ha ancora detto. Vale la pena scoprirlo togliendo un import morto in
un pomeriggio, invece che aggiungendo una riga a un file qualunque un venerdì.

**Il controllo che l'ha preso, e quello che non l'avrebbe preso**: `npm run dev` sulla rotta vera.
I 7.289 test unitari erano verdi, `svelte-check` non aveva niente da dire, e il build non era
ancora stato provato. Un ciclo di inizializzazione si vede solo eseguendo — è precisamente il
motivo per cui il cancello del browser non è sostituibile con una suite verde.

## Un mock incompleto non fa fallire un test: fa cadere la suite, e a intermittenza

CI rossa con **7.309 test verdi su 7.309**. Il job falliva su un `Unhandled Rejection`:
`TypeError: supabase.rpc is not a function`, con dentro `home-redirect.test.ts` un file che il
commit non aveva toccato. In locale non si riproduceva.

La catena: `+layout.server.ts` lancia `loadDeferred`, una promessa che **nessuno attende** (SvelteKit
la trasmette in streaming). Il mock supabase del test rispondeva a `from()` con un Proxy che
accetta qualunque metodo — l'autore il rischio l'aveva previsto, e l'aveva scritto nel commento
sopra — ma non rispondeva a `rpc()`. Dentro il differito ci si arriva:
`remaining()` → `getCreditsUsage()` → `fetchStripePeriodStart()` → `supabase.rpc(...)`.

Quindi il rifiuto c'era sempre. Quello che cambiava era **se atterrava prima che il run finisse**,
e quello dipende da quanti file di test esistono e in che ordine vitest li distribuisce. Il commit
ne aveva rimosso uno e aggiunto un altro: abbastanza per spostare la schedulazione e far uscire
allo scoperto un guasto che era lì da prima.

**Segnale**: `Test Files N passed`, `Tests M passed`, e il job rosso lo stesso, con `Errors 1` e un
`Unhandled Rejection` che nomina un file che non hai toccato. Un `grep` su `FAIL|Tests ` nell'output
locale **non lo vede**: la riga da cercare è `Errors` / `Unhandled`.

**Mossa**: completare il mock alla fonte (`rpc: () => chain`, come `from`), non inseguire l'ordine
dei test e non ritentare il job sperando che vada. Un mock che copre solo i metodi che il percorso
felice usa è una bomba a orologeria: il primo cambiamento di schedulazione la innesca, e il file
che esplode non è quello che l'ha piazzata.

**La regola dietro**: dove il codice lancia una promessa che nessuno attende, un mock parziale non
degrada — abbatte tutto il processo. O il mock risponde a qualunque cosa (Proxy), o quel percorso
va atteso e asserito.

## `set role` non è `auth.role()`: una security-definer interrogata da psql risponde zero

Verificando che `sum_org_ai_cost_usd` contasse finalmente una riga senza brand, la funzione ha
risposto **0** mentre la stessa somma scritta a mano sulla tabella rispondeva `0.033646`. Sembrava
esattamente il difetto che stavo chiudendo — la migration non applicata, o il `left join` che non
teneva.

Non era né l'una né l'altro. La funzione porta una guardia:

```sql
and ( auth.role() = 'service_role' or p_org_id in (select public.auth_org_ids()) )
```

`auth.role()` legge il **claim del JWT** (`request.jwt.claims`), non il ruolo Postgres. Da psql
quel claim non c'è, quindi la guardia è falsa per ogni riga, il `where` non ne seleziona nessuna e
`coalesce(sum(...), 0)` restituisce uno zero perfettamente legittimo. `set role service_role` non
cambia niente: è l'altro concetto di ruolo.

**Segnale**: una funzione `security definer` sotto RLS risponde `0` o zero righe da psql, mentre la
query equivalente scritta a mano risponde. Nessun errore, nessun permesso negato — solo un vuoto
che si legge come un difetto della funzione.

**Mossa**: mettere il claim prima di chiamarla, nella stessa sessione.

```sql
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.sum_org_ai_cost_usd(...);
```

**La regola dietro**: una funzione che decide chi può vedere cosa va interrogata con l'identità che
avrà in produzione. Interrogarla senza è come chiamarla da un utente anonimo e concludere che la
tabella è vuota — e la conclusione sbagliata qui è la peggiore possibile, perché «somma zero» è
proprio la forma del difetto che si sta cercando.

## Un test rosso può importare `bun`, non `bun:test` — e vitest non ha un alias per quello

In un worktree pulito la suite chiude con `Test Files 2 failed | 664 passed` e **`Tests 7387
passed`, zero test falliti**: i due file non falliscono, non si caricano proprio. Uno è
`hooks.server.test.ts` (manca `.env`, già qui sopra). L'altro è `cli/mcp/vercel-config.test.ts`:

```
Failed to load url bun (resolved id: bun) in cli/mcp/vercel-config.test.ts
```

`vite.config.ts` aliasa `bun:test` → `vitest`, che è ciò che fa girare i test della CLI sotto
vitest. Ma quel file importa anche `import { $ } from 'bun'` — il **runtime**, non il framework di
test — e per quello non c'è alias possibile: è l'eseguibile bun.

**Segnale**: `Test Files N failed` con `Tests M passed` e **zero** `×`. I file non hanno test
rossi, hanno un import che non risolve. Cerca `Failed to load url`, non `FAIL`.

**Mossa**: prima di attribuirsi il rosso, `git log -1 <file>` — se non l'hai toccato tu,
riproducilo sul checkout principale. E poi **aggiustalo**, perché blocca la CI di tutti: in questo
caso `$` serviva a una riga sola (`git ls-files`), e `execFileSync` da `node:child_process` la fa
girare sotto entrambi i runner.

**La regola dietro**: un file di test che vive sotto due runner può usare solo ciò che entrambi
hanno. `bun:test` ha un alias; il **runtime** `bun` no, e non può averlo — è un eseguibile.
## Un client service role più un identificatore che arriva da fuori

**Segnale.** Da qualche parte c'è `createAdminClient()` — o, sul percorso a chiave API, il
`supabase` che `authenticate()` restituisce, che è la stessa cosa con un altro nome — e nella
stessa funzione c'è un id preso da `params`, dal corpo della richiesta, o da un `formData`. Il
codice attorno ha l'aria protetta: un `.eq('brand_id', …)` da qualche parte, un `canEnter`, un
404 sul brand. Sembra a posto, e in quattro casi su quattro non lo era.

**Cosa succede.** `service_role` ha `bypassrls=true`: le policy non vengono nemmeno valutate.
Quindi la protezione è solo quella scritta a mano, e si rompe in tre modi che sembrano diversi e
sono lo stesso:

1. **Il `WHERE` è scopato, il bersaglio no.** L'update sull'articolo porta `brand_id`, la delete
   sui tag che segue no. La riga vicina protetta fa sembrare protetta anche quella dopo.
2. **Il `WHERE` è scopato, il `SET` no.** Il corpo grezzo finisce nell'update: la riga si trova
   nel tuo brand e si riscrive col `brand_id` di un altro.
3. **Non c'è nessun `WHERE` da scopare: il tenant È il valore che arriva da fuori.**
   `insert({ brand_id: body.brandId })`. Qui non attraversa il dato, attraversa il **conto** —
   `credits.ts` somma quelle righe di `ai_calls`, quindi il consumo di uno lo paga un altro.

E il fallimento è muto in tutti e tre: **zero righe toccate non è un errore per PostgREST**,
quindi un update scopato che non trova niente lascia `error` nullo e il codice prosegue fino alla
scrittura non scopata che gli sta dietro. Un endpoint che risponde `200 {"ok":true}` su una riga
che non ha toccato è la stessa disonestà, un gradino più in basso.

Perché nessuno se n'era accorto: il cancello che sembrava un confine non lo era. `canEnter` si
descrive da sé come *«una porta commerciale, non un confine di sicurezza»* — chi leggeva la route
vedeva un `403` in cima e smetteva di cercare.

**La mossa.** `src/no-cross-tenant-writes.test.ts`, tre regole sul sorgente, una per forma. Non
sono state scritte per essere verdi: ognuna è stata provata sul sorgente **prima** della
correzione e ha trovato il proprio difetto lì — 1, 1 e 6 occorrenze. Una guardia che non è mai
stata rossa non dimostra niente, e ne abbiamo trovate cinque così in una sola giornata.

Niente allowlist: la prima regola incontra sette scritture di quella forma e sei sono sane, ma
un'allowlist da sei voci diventa un timbro alla settima. Le sei si sdoganano sul merito — una
lettura scopata che torna indietro, o `updateBrandRow`/`deleteBrandRow`, che contano le righe che
hanno toccato. Un update scopato che nessuno conta **non** vale come prova: quella riga sola è la
differenza fra la regola e un placebo.

Per il caso 3 la verifica sta in `ownsBrand` (`access.ts`): gira la domanda al database col client
dell'utente, dove le policy di `brands` rispondono con la stessa regola che `loadBrandForUser`
riapplica a mano. Un client non marchiato `markRlsScoped` riceve `false` — il default è il
rifiuto, così un percorso nuovo che si dimentica di marchiarsi resta chiuso invece di aprirsi.

Quattro occorrenze trovate solo perché qualcuno è andato a cercarle: la quinta arriverà, e allora
il costo di questa lezione è già stato pagato.
## Il fatto che ti passa un altro agente è un'affermazione, non una prova

**Segnale.** Stai scrivendo una descrizione — o un commento, o un test — su un fatto che non hai
letto tu, ma che ti è arrivato da chi sta lavorando su quel codice. Sembra la fonte migliore
possibile: è l'unica persona che lo sta toccando.

**Cosa succede.** In una sessione con quattro agenti sullo stesso contratto, un fatto è girato
tre volte e si è rivelato falso alla terza. «Il renderer video non ha un canale per lo stile
visivo»: su quella base ho scritto *«The brand's look does not reach a clip filmed from a prompt
alone»*, che sarebbe finita in `tools/list`. `RenderVideoOpts.visualStyle` esiste
(`src/lib/server/video.ts:331`) ed entra nel prompt sul ramo text-to-video (`video.ts:481`). Il
fatto vero era un altro e più stretto: `startVideo` non lo passava sul percorso MCP mentre il
percorso dei post sì — un difetto di comportamento, non un'assenza di progetto.

Una descrizione falsa è peggio di una descrizione vaga: quella vaga fa cercare altrove, quella
falsa fa smettere di cercare. Ed è esattamente il difetto che questo lavoro esisteva per chiudere.

**Come nasce, che è la parte utile.** Chi me l'ha passato non se l'è inventato: aveva letto
`startVideo`, aveva visto che non passa `visualStyle`, e ne ha concluso che il canale non esiste.
**Ha letto il chiamante e ha concluso sul chiamato.** Quello che sapeva davvero era «`startVideo`
non lo passa» — verificato, vero, e già di per sé il difetto — ma è arrivato a me nella forma più
larga e più falsa. Un'assenza in un chiamante non è un'assenza nel chiamato: dice solo che
quel percorso non la usa.

**Mossa.** Il fatto si verifica dove è DEFINITO, non dove è usato, prima di scriverci sopra una
frase — anche quando arriva da chi ha le mani in quel file: `grep` del campo, lettura del ramo, e
il commento accanto alla definizione. In quel caso diceva già tutto («Solo nel prompt di ripiego
TEXT-TO-VIDEO: con una cover allegata lo stile è già nei pixel», `video.ts:330`), e avrebbe
prodotto una frase MIGLIORE di quella che mi era stata data, non solo una vera. Costa un minuto e
vale quanto la frase che stai per spedire a ogni agente che userà il prodotto.

**Corollario.** Vale in entrambe le direzioni: un fatto che passi tu a un altro agente va marcato
per quello che è. «Verificato in `file:riga`» e «me l'hanno detto» non sono la stessa cosa, e chi
riceve non può distinguerle se non gliele distingui tu.

**È la stessa forma a tre distanze diverse, e le abbiamo commesse in tre in una sessione sola.**
Un agente ha letto un chiamante e ha concluso sul chiamato. Io ho classificato ventidue letture
come «esprimibili con `query`» leggendone le descrizioni invece delle rotte — due erano sbagliate,
e una avrebbe fatto uscire dalla memoria del brand le note private di un altro agente. Il terzo ha
messo una frase dove era comodo, in `references/tools.md`, e il test l'ha dichiarata verde: il test
leggeva quel file concatenato a `SKILL.md`, mentre la regola che pretendeva di far rispettare era
«la superficie che si legge PER PRIMA instrada la domanda». Tre volte lo stesso movimento: il
controllo che ci trovavamo davanti ha detto sì, e abbiamo smesso di guardare.

**La domanda che le prende tutte e tre, e costa una riga:** *di che cosa è prova questo verde?*
«Il chiamante non lo passa» non è una prova sul chiamato. «La descrizione dice una tabella» non è
una prova sulla rotta. «`findability` è verde» non è una prova sulla superficie sempre caricata, se
il test ne legge due concatenate. Va fatta **una volta sola, prima di citare il verde** — non è un
protocollo, è la ragione per cui verrà davvero eseguita.

Tre errori uguali fatti da tre persone diverse nello stesso giorno non sono tre sbagli: sono la
forma di un controllo che non guarda dove crede di guardare.

**Due meccanismi, e non coprono lo stesso terreno.** La domanda sopra scala a UNO: prende il caso
in cui la prova ce l'hai già davanti e non l'hai guardata — «`findability` è verde» con il test che
legge due file concatenati si smonta da soli, in dieci secondi, senza nessun altro sveglio. È la
metà che sopravvive quando lavori da solo, ed è la ragione per cui vale scriverla.

Quello che la domanda NON prende è la cosa che non hai motivo di guardare. `get_memory` sembrava
una lettura di tabella: nessun verde da interrogare, nessun sospetto da inseguire, e chi stava per
toglierlo non aveva ragione di aprire `brand-memory.ts` — dove ci sono i due filtri che gli
avrebbero fatto uscire dalla memoria del brand le note private di un altro agente. Lì serve
qualcun altro, con un contesto diverso, che legga la stessa affermazione.

**E la pratica che l'ha fatto succedere ha un costo, o non è replicabile.** Ha funzionato perché
chi stava per rimuovere ha detto QUALI TRE tool, prima di toccarli: «rimuovo qualche tool di
lettura» non avrebbe dato niente da controllare. Quel messaggio si scrive quando il codice non
esiste ancora — cioè quando viene peggio, e la tentazione è scriverlo dopo, a risposta nota.
Scritto dopo non serve a niente: è un resoconto, e un resoconto non si può contraddire in tempo.
