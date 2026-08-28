# LESSONS

Lezioni imparate lavorando a questo repo: problemi veri, il segnale che li fa riconoscere, e la mossa che li risolve. Una sezione per tema. Una lezione nova entra qui nel commit che l'ha pagata.

## Ambiente e worktree

### Il worktree nuovo ha bisogno di `npm ci` — e ancora dopo ogni rebase su dev
Un worktree parte senza `node_modules`, e `vite.config.ts` muore subito (`Cannot find package '@sentry/sveltekit'`). Ma il caso insidioso è l'altro: dopo aver ribasato su dev che ha accolto PR nuove, il `node_modules` installato col vecchio lockfile produce guasti **deterministici e fuori posto** — v. `extractUserText is not a function` in un test di immagini: il codice era giusto, le dipendenze vecchie. Segnale: un errore `X is not a function` su codice mai toccato, in un worktree ribasato. Mossa: `npm ci` nel worktree, sempre, dopo il rebase.

### `@anomalia/*` si risolve dal `node_modules` del checkout principale
Un eval o un test lanciato da un worktree misura un ibrido: `$lib` punta alla copia del worktree, i pacchetti interni vengono dal checkout madre. Se hai toccato `packages/`, il worktree non lo vede. Per un confronto pulito: worktree di verifica con `node_modules` symlinkato a quello fresco.

### Verifica il `workdir` prima di ogni Edit
Con più worktree aperti (feature + verifica), un edit fatto nel checkout sbagliato tocca dev. È successo: `live.ts` modificato nel checkout principale per un secondo, poi `git checkout --` e riapplicato nel posto giusto. Il tool Edit non ti proteggere — proteggiti tu: guarda il percorso del file che stai per toccare, sempre.

## Test: distinguere il tuo difetto dal rumore

### La suite completa fallisce da sola: confronta run-per-run con dev puro
Sotto carico (worker paralleli) i test di timing e race cadono da soli: `redact` ≤ 200ms che ne impiega 404, JPEG ≤ 2MB, drain "executes exactly once". Lo stesso sottoinsieme, rilanciato isolato, passa. Prima di imputarsi un fallimento della suite completa: (1) rilancia il sottoinsieme isolato, (2) lancia la suite completa su **dev puro** nello stesso setup. Se dev fallisce uguale, il rumore non è tuo. Vero anche il rovescio: "tutta verde" sul tuo branch non dice niente se dev non lo è.

### Il `git rebase` scarta da solo il commit già squashato in dev
PR squash-mergiata + branch di lavoro con più commit: `git rebase origin/dev` riconosce il contenuto identico, salta il commit e resta solo quello nuovo. Zero conflitti. Poi `push --force-with-lease` e PR nuova con un commit solo.

### Guarda lo stato della PR prima di diagnosticare lag
`gh pr view` che mostra il vecchio head per minuti sembra cache di GitHub. Può essere che la PR sia **chiusa** e il branch cancellato — e che il tuo push l'abbia ricreato come orfano. `gh api repos/:org/:repo/pulls/N --jq '.state'` prima di ipotesi sulla freschezza dell'API.

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
