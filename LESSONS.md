# LESSONS

Lezioni imparate lavorando a questo repo: problemi veri, il segnale che li fa riconoscere, e la mossa che li risolve. Una sezione per tema. Una lezione nova entra qui nel commit che l'ha pagata.

## Ambiente e worktree

### Il worktree nuovo ha bisogno di `npm ci` — e ancora dopo ogni rebase su dev
Un worktree parte senza `node_modules`, e `vite.config.ts` muore subito (`Cannot find package '@sentry/sveltekit'`). Ma il caso insidioso è l'altro: dopo aver ribasato su dev che ha accolto PR nuove, il `node_modules` installato col vecchio lockfile produce guasti **deterministici e fuori posto** — v. `extractUserText is not a function` in un test di immagini: il codice era giusto, le dipendenze vecchie. Segnale: un errore `X is not a function` su codice mai toccato, in un worktree ribasato. Mossa: `npm ci` nel worktree, sempre, dopo il rebase.

### Il worktree nuovo ha bisogno anche del `.env`
Dopo il `npm ci` la suite parte ma cade su 40+ test con `SUPABASE_SERVICE_ROLE_KEY not configured`: Vitest carica l'env dal `.env` del worktree, che non c'è. Segnale: errori di env mancante in un worktree fresco, deterministici, su file che passano nel checkout principale. Mossa: `cp ../anomalia/.env .` alla creazione del worktree, accanto al `npm ci`.

### Un test che sceglie un ramo in base all'env locale non è un test
`queue-dm.test` girava o no il ramo kit secondo `AGENT_KIT` del `.env` locale: sul laptop di chi lo ha spento passava, su chi lo ha acceso il turno andava nel kit e `harnessCalls` restava vuoto (`expected +0 to be 1`). Segnale: un test che fallisce solo su un'altra macchina, senza cambiamento di codice. Mossa: chi fissa `$env/dynamic/private` nel test (`vi.mock('$env/dynamic/private', () => ({ env: { AGENT_KIT: 'off' } }))`), come già fa `queue-kit-heartbeat.test` — la scelta del ramo è parte del test, non del computer che lo esegue.

### `@anomalia/*` si risolve dal `node_modules` del checkout principale
Un eval o un test lanciato da un worktree misura un ibrido: `$lib` punta alla copia del worktree, i pacchetti interni vengono dal checkout madre. Se hai toccato `packages/`, il worktree non lo vede. Per un confronto pulito: worktree di verifica con `node_modules` symlinkato a quello fresco.

### Verifica il `workdir` prima di ogni Edit
Con più worktree aperti (feature + verifica), un edit fatto nel checkout sbagliato tocca dev. È successo: `live.ts` modificato nel checkout principale per un secondo, poi `git checkout --` e riapplicato nel posto giusto. Il tool Edit non ti proteggere — proteggiti tu: guarda il percorso del file che stai per toccare, sempre.

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

## Testare la piattaforma nel browser: worker locale ed ambiente

### Il worker locale è un build vecchio che compete per la stessa coda
La stack Docker porta un'app pronta (`anomalia-app`, immagine `anomalia-selfhost-app`) che prosciuga `chat_jobs` dallo stesso DB del dev server: il cron chiama `app:3000`, non la tua porta. Con l'immagine più vecchia del checkout, il codice nuovo **non gira mai** (il team contact post-onboarding non parte) e i due reaper si contendono i turni: `chat turn died mid-flight (heartbeat lost)` su turni vivi, `Failed to load url credits.ts` da moduli che nel checkout esistono. Segnale: `chat_jobs` failed con errori che il codice attuale non può produrre. Mossa: identificare chi prosciuga la coda prima di giudicare il flusso — `docker logs anomalia-app`, data dell'immagine (`docker images`) contro `git log -1` — e fermare o ricostruire il container stantio (ricordarsi di riaccenderlo).

### Le env del repo puntano all'hosted; la stack locale porta le sue chiavi in kong.yml
Il `.env` del repo punta a un progetto Supabase hosted, mentre la compose gira da un altro checkout con le chiavi veramente valide dentro `anomalia-kong:/usr/local/kong/kong.yml`. Il seed (`scripts/db-seed.mjs`) pretende `DATABASE_URL` e fallisce con parse error leggendo `.env` a mano (contiene valori con `<...>`). Mossa: overlay env a parte — `PUBLIC_SUPABASE_URL=http://localhost:8000`, chiavi estratte da kong.yml, `DATABASE_URL` dalla compose — e avviare il dev con quello; mai puntare all'hosted "per comodità".

### La porta 5173 può appartenere al vite di un altro worktree
Un `vite dev` di un altro worktree risponde 404 a tutto e resta lì in ascolto; il CLI ci si punta da solo. Mossa: `lsof -nP -iTCP:5173 -sTCP:LISTEN` e `ps` sul PID prima di `npm run dev`; se occupata, porta esplicita (`npm run dev -- --port 5175`).

### Il profilo del browser di test conserva sessioni e localStorage
`agent-browser` riutilizza cookie e localStorage tra le run: un test "guest" parte loggato, e l'onboarding di un utente nuovo legge `localStorage['anomalia:first-agent:<altro-brand>']` dell'utente prima — fetch di thread altrui (404 rumorosi ma disordini nella diagnosi). Mossa: `cookies clear` **e** `storage local clear` prima di ogni persona nuova; verificate sempre chi siete (`location.href`, sidebar) prima del primo click.

### I rimount (`{#key}`) rendono stale i ref dell'automazione browser
Un click su un ref catturato prima del re-render non arriva a nessuno: il carosello dell'onboarding sembrava bloccato prima del pick — era il bottone rimontato ad ogni slide. Mossa: snapshot fresco e selettori stabili (`.wide-btn`), click lenti; un "blocco" va riprodotto con click lenti e selelettori nuovi prima di chiamarlo bug. Il falso positivo costa un'ora, la prudenza tre secondi.

### Un cookie di sessione malformato abbatte il dev server
Una curl con `sb-<host>-auth-token` corrotto produce `Invalid Base64-URL character` non gestito nella recovery della sessione e il processo muore (`curl` → 000, niente più risposte). È un finding prodotto, non rumore: la recovery non tollera input corrotto. Mossa: quando curl dà 000, guardare il log del server prima di incolpare la rete; e la richiesta che ha ucciso il server diventa un test.

## Codice

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

## Prodotto

### La differenza per-agente si chiama mappa, non sottosistema
"Ogni agente ha le sue skill" non ha richiesto colonne, UI né permessi: un `agentId` nel contratto del turno e una `Record<TeamAgentId, string[]>`. La generalizzazione vera è il posto dove la prossima differenza è una riga.

### Una skill va assegnata se il mestiere la tocca, non per simmetria
Motion prende `remotion-best-practices` perché è l'unico che scrive sorgente Remotion. Assegnare skill a tutti "per uniformità" ricrea il problema di partenza: il mazzo uguale per tutti.

### La continuazione senza testo per il modello muore due volte
Una ripresa accodata con `user_message` vuoto è morta due volte prima di chiamare il modello: prima col gate `Missing user_message`, poi — superato il gate — col prompt vuoto, perché il provider rifiuta una conversazione che non apre con un turno `user` e `dropLeadingAssistant` mangia l'apertura firmata. Il segnale: `chat_jobs.status='failed'` con errori diversi per lo stesso job. La mossa: una continuazione porta SEMPRE un testo solo-per-il-modello (mai salvato, mai mostrato), come `enqueueTurnContinuation`; `open_session_with_user` era nata rotta così ed è sopravvissuta mesi perché la coda è buio per i test unitari — è la verifica nel browser che l'ha vista.
