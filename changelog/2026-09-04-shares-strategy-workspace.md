# Un link pubblico che porta il lavoro, non l'app

La richiesta era «rendere `/app/[brand]/*` visibile a chi ha un link pubblico»: il cliente finale
deve poter vedere il lavoro senza un account. La forma però non poteva essere quella letterale.

## Cosa NON è stato fatto, e perché

Non si è aperto l'albero dell'app sotto token. Sotto `/app/[brand]` vivono 96 pagine, e fra queste
`settings/api-keys` (le chiavi API), `settings/danger` (`DELETE FROM brands` più la disdetta),
`settings/demo-account` e `settings/blog-integrations` (segreti nel Vault), oltre a billing, team,
account collegati e consumi. Un link su quell'albero consegna credenziali e tasto di cancellazione
a chiunque lo riceva o lo inoltri.

Anche potendo elencare le pagine ammesse, l'elenco sarebbe di **esclusioni**: la pagina aggiunta il
mese prossimo sarebbe pubblica per difetto, a meno che qualcuno si ricordi di escluderla. Nessuno
si ricorda. E c'è un secondo motivo, tecnico: ogni pagina carica attraverso
`+layout.server.ts` → `event.parent()` e interroga tabelle vive con `locals.supabase`. Renderle
anonime vuol dire o la chiave di servizio (ogni confine RLS che salta insieme) o una sessione
finta. Entrambe hanno un raggio d'azione più largo delle 96 pagine.

## Cosa è stato fatto

Esteso il meccanismo della PR #221 — snapshot congelato, token con impronta, revoca e scadenza —
con due tipi di vista in più:

- **`strategy`** — il lavoro concordato: la strategia editoriale, il ritmo, il mix di piattaforme,
  le settimane (data, tema, focus, stato) e la fase GTM che governa il mese chiesto con i suoi
  obiettivi (`kpi` → `target`). Solo i piani **attivi**: una proposta è una conversazione ancora
  aperta con chi decide, e `revision_feedback` ne è letteralmente il testo. Restano fuori
  `rationale`, `brief` e `products` di ogni settimana — gli appunti di chi pianifica, non il piano
  — insieme a `voice`, `changes_summary`, `reply` e ogni `actual`/`metric`/`value` dei goal.
- **`workspace`** — un link solo invece di quattro: dashboard, calendario, report e strategia
  dietro schede. Non è una vista in più, è la **somma esatta** delle altre: ogni sezione è lo
  snapshot che quella vista consegnerebbe da sola, quindi non può mostrare un campo che uno dei
  link singoli non mostrerebbe già. Un test lo verifica chiave per chiave.

`buildDashboard` si è spezzato in `composeDashboard` (puro) più il wrapper che fa le query, così
il workspace legge calendario e storia **una volta sola** invece di quattro.

La fase GTM è scelta dal **mese chiesto**, non dall'orologio. Presa dal clock, uno snapshot
congelato a settembre mostrerebbe una fase decisa dall'istante della creazione anziché dal mese di
cui il link parla — e non si proverebbe senza toccare il tempo.

## Come si impedisce che l'elenco si allarghi da solo

Una cosa diventa pubblica solo attraversando **quattro porte**, tutte deliberate:

1. `SHARED_VIEW_TYPES` nel contratto — l'enum che l'endpoint valida (`view: 'settings'` è un 400).
2. Il builder in `SNAPSHOT_BUILDERS`, che nomina campo per campo cosa copia. È un
   `Record<SharedViewType, …>`: un tipo senza builder non compila.
3. Il vincolo `check (view_type in (…))` su `shared_views`.
4. La pagina `/share/[token]`, che deve saperla disegnare.

La rotta pubblica non ha nessun percorso dentro l'albero dell'app: legge una tabella sola e una
colonna sola. Una pagina aggiunta domani non attraversa nessuna delle quattro, quindi resta
invisibile **senza che nessuno debba ricordarsene**.

La terza porta è l'unica che TypeScript non copre, ed era già divergita: `dashboard` stava nel
contratto e non nel check, e ci volle una seconda migration. In produzione quella divergenza è un
`23514` che nessuno sa leggere. Ora un test legge le migration, estrae l'ultimo
`view_type in (…)` e lo confronta con l'enum — e diventa rosso prima del deploy. È stato visto
fallire: allargato il contratto senza la migration, la suite è andata rossa; scritta la migration,
è tornata verde.

Un secondo test tiene che sotto `src/routes/share/` viva **una** rotta sola, `[token]`: un secondo
punto d'ingresso pubblico aggiunto per distrazione fa fallire la suite invece di esistere in
silenzio.

## Migration da applicare

`supabase/migrations/20260904210000_shared_views_strategy_workspace.sql` allarga il check a
`strategy` e `workspace`. **Non applicata**: questo repo non esegue migration al deploy. Senza,
la creazione dei due nuovi tipi viene rifiutata da Postgres — le viste già esistenti non cambiano.
