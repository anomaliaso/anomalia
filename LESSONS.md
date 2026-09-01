# LESSONS

Lezioni imparate lavorando a questo repo: problemi veri, il segnale che li fa riconoscere, e la mossa che li risolve. Una sezione per tema. Una lezione nova entra qui nel commit che l'ha pagata.

## Ambiente e worktree

### Il worktree nuovo ha bisogno di `npm ci` — e ancora dopo ogni rebase su dev
Un worktree parte senza `node_modules`, e `vite.config.ts` muore subito (`Cannot find package '@sentry/sveltekit'`). Ma il caso insidioso è l'altro: dopo aver ribasato su dev che ha accolto PR nuove, il `node_modules` installato col vecchio lockfile produce guasti **deterministici e fuori posto** — v. `extractUserText is not a function` in un test di immagini: il codice era giusto, le dipendenze vecchie. Segnale: un errore `X is not a function` su codice mai toccato, in un worktree ribasato. Mossa: `npm ci` nel worktree, sempre, dopo il rebase.

### Il worktree nuovo ha bisogno anche del `.env`
Dopo il `npm ci` la suite parte ma cade su 40+ test con `SUPABASE_SERVICE_ROLE_KEY not configured`: Vitest carica l'env dal `.env` del worktree, che non c'è. Segnale: errori di env mancante in un worktree fresco, deterministici, su file che passano nel checkout principale. Mossa: `cp ../anomalia/.env .` alla creazione del worktree, accanto al `npm ci`.

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

## Test: distinguere il tuo difetto dal rumore

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

### Il test della PR può aspettare il vecchio contratto
`toHaveBeenCalledWith` con 6 argomenti contro un executor passato a 7 (dev ha aggiunto la riga `job`): fallisce nel merge senza che nessuno abbia toccato il file. Mossa: nel riesame di un merge, fai girare PRIMA i test dei file in conflitto — sono gli unici che fanno da spec su entrambi i lati.

## Testare la piattaforma nel browser: worker locale ed ambiente

### Il worker locale è un build vecchio che compete per la stessa coda
La stack Docker porta un'app pronta (`anomalia-app`, immagine `anomalia-selfhost-app`) che prosciuga `chat_jobs` dallo stesso DB del dev server: il cron chiama `app:3000`, non la tua porta. Con l'immagine più vecchia del checkout, il codice nuovo **non gira mai** (il team contact post-onboarding non parte) e i due reaper si contendono i turni: `chat turn died mid-flight (heartbeat lost)` su turni vivi, `Failed to load url credits.ts` da moduli che nel checkout esistono. Segnale: `chat_jobs` failed con errori che il codice attuale non può produrre. Mossa: identificare chi prosciuga la coda prima di giudicare il flusso — `docker logs anomalia-app`, data dell'immagine (`docker images`) contro `git log -1` — e fermare o ricostruire il container stantio (ricordarsi di riaccenderlo).

### Le env del repo puntano all'hosted; la stack locale porta le sue chiavi in kong.yml
Il `.env` del repo punta a un progetto Supabase hosted, mentre la compose gira da un altro checkout con le chiavi veramente valide dentro `anomalia-kong:/usr/local/kong/kong.yml`. Il seed (`scripts/db-seed.mjs`) pretende `DATABASE_URL` e fallisce con parse error leggendo `.env` a mano (contiene valori con `<...>`). Mossa: overlay env a parte — `PUBLIC_SUPABASE_URL=http://localhost:8000`, chiavi estratte da kong.yml, `DATABASE_URL` dalla compose — e avviare il dev con quello; mai puntare all'hosted "per comodità".

### Misurare fuori dal percorso dell'app e concludere sull'app
`curl` con `response_format: json_schema` strict su `z-ai/glm-5.3-flash` risponde 200 e resta aperto 180s con soli spazi di keep-alive: sembra un modello rotto. L'app però non usa quel percorso — usa `generateObject` dell'AI SDK, che negozia diversamente — e sullo stesso schema quel modello risponde in 107s (gemini in 15s). Lento, non rotto. Segnale: una conclusione su un componente tratta da una prova che quel componente non esegue mai. Mossa: misurare chiamando la FUNZIONE che il prodotto chiama (`llmStructured`), non l'endpoint a mano; e diffidare di «rotto» quando l'unico sintomo è «non è ancora tornato».

### La correzione «globale» vale solo per chi chiama quella funzione
Il campo `reasoning` mancante è stato corretto in `llmStructured`/`llmText` e dichiarato risolto ovunque. Non lo era: i cicli d'agente chiamano `generateText` per conto loro (`harness/run.ts`) e non passano da lì, quindi il percorso peggiore — il planner settimanale, venti turni di modello dove ogni turno sprecava dodicimila token — è rimasto rotto dopo la correzione. Segnale: una modifica descritta come «ogni chiamata ora fa X» quando X vive dentro UNA funzione. Mossa: prima di dichiararla globale, `grep` del meccanismo grezzo che la funzione incapsula (`generateText`, `generateObject`, `fetch`) e verifica chi lo chiama scavalcandola.

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

### Build e dev server lungi dal tool di shell
`npm run build` di questo repo dura ~4 minuti: lancialo in `nohup … &` e sondalo col log, il timeout del tool di shell uccide il processo (e lascia esbuild a metà: la dev server dopo parte con `write EPIPE`). La dev server del worktree ha la sua porta (`--port 5185 --strictPort`) — il 5173 è di chiunque arrivi prima. E il comando che LA VA A PROVARE con `curl` in blocco va in timeout e trascina via il process group: lancia il server staccato (`disown`), verifica con un comando successivo.

## Codice

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

## Build e bundle

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

## L'immagine del self-host non entra in un builder Docker da 8 GB

**Segnale.** `docker compose build` sull'immagine app fallisce in due modi diversi, e vanno
distinti: `ResourceExhausted: cannot allocate memory` è la VM che rifiuta, `FATAL ERROR:
Ineffective mark-compacts near heap limit` è il tetto di heap troppo basso. Il primo dice che hai
chiesto troppo, il secondo che hai chiesto troppo poco.

**Mossa.** Non bisezionare `--max-old-space-size`: con 7,75 GiB di VM la finestra è chiusa (4096
va in heap overflow a 3,4 GB, da 4608 in su la VM non alloca). Il consumo viene da `adapter-node`
su un chunk server da 5,1 MB, non dal flag. Misura il picco con `/usr/bin/time -l` e riduci il
bundle; alzare la memoria di Docker Desktop nasconde il problema senza risolverlo per chi installa.
