# `query` arriva su CLI e MCP, e il cancello smette di guardare la cosa sbagliata

`query` — la lettura diretta del database con i permessi dell'utente — esisteva già in
`src/lib/server/chat/query-tool.ts` ed era montata solo nel registro della chat. Su MCP non
c'era, e sul percorso REST si sarebbe rifiutata da sola. Qui diventa un endpoint, e il rifiuto
torna a coincidere con la ragione per cui esiste.

## Il difetto: la sonda misurava una cosa diversa da quella che decideva

Il cancello chiedeva `supabase.auth.getSession()` e leggeva solo con una sessione in mano. Sembra
la stessa domanda di «questo client ha i permessi dell'utente?» e non lo è.

`cli-auth.ts` costruisce il client del percorso JWT con la chiave anon e l'header `Authorization`
dell'utente, ma con i cookie a vuoto (`getAll: () => []`). Costruito quel client e chiamato
`getSession()`, la risposta è `null` — misurata, non dedotta:

```
getSession() on the RLS-scoped JWT client => null
=> query-tool would REFUSE (no_user_session)
```

Quindi il cancello chiudeva la porta esattamente al client giusto. In produzione:
`db_query:refused:no_session` 46 volte fra il 24 agosto e il 4 settembre, contro 5 chiamate
riuscite alla lista delle tabelle. E nell'altro verso era altrettanto sbagliato: una service role
che una sessione ce l'avesse avuta sarebbe passata, perché la sessione non dice niente su quale
chiave sta parlando.

Ora la domanda la risponde chi costruisce il client, che è l'unico a saperlo
(`src/lib/server/rls-client.ts`). Il marchio si mette in due punti soli — `hooks.server.ts` per il
browser, `cli-auth.ts` per il percorso JWT — e in nessun altro. Chi non è marchiato non legge: il
default è il rifiuto, quindi un percorso nuovo che si dimentica di dichiararsi resta chiuso invece
di aprirsi da solo. Sono gli unici due `createServerClient` del repo, verificato: nessun altro
posto costruisce un client con un'identità utente, `setSession` non compare da nessuna parte.

## Perché la chiave API resta rifiutata, anche in futuro

`SUPABASE_JWT_SECRET` non esiste: non in `.env`, non in `.env.local`, non nel codice, e non fra le
93 variabili su Vercel. Ci sono solo la chiave anon e la service role. Quindi coniare un JWT a vita
breve per il proprietario di una chiave non si può, e passare le claim sulla connessione nemmeno —
PostgREST verifica la firma.

**Ma la ragione vera non è il segreto mancante, ed è questa che va ricordata il giorno in cui un
segreto di firma ci sarà:** una chiave API porta `permissions.brand_ids`, spesso più stretto dei
brand a cui il suo proprietario appartiene. Un JWT vede *tutti* i brand dell'utente, e la RLS non
vede la restrizione della chiave. Coniare una sessione per una chiave allargherebbe in silenzio una
chiave deliberatamente ristretta — trasformando un limite scelto dal cliente in niente. Non è un
ripiego in attesa del segreto: è la decisione.

Sulla superficie che conta il punto è comunque teorico: **MCP non accetta chiavi statiche**
(`cli/mcp/verify-token.ts`, «never accepts a static API key»; `cli/mcp/server.ts`, «No static API
tokens»), e la CLI conserva una sessione Supabase vera che rinfresca da sola. Ogni richiesta MCP
porta già il JWT dell'utente, quindi il percorso corretto era già lì: mancava solo che il cancello
lo riconoscesse.

## `.rpc()` resta fuori, e la lista delle tabelle si genera

Nessun cambiamento sul primo: decine di funzioni `SECURITY DEFINER` sono eseguibili da
`authenticated`, una manda email. `query` parla solo `.from().select()`.

La lista delle tabelle era battuta a mano ed era **già invecchiata di 16 nomi** — `thread_events`,
`agent_kit_runs`, `agent_kit_effects`, `agent_kit_approval_requests`, `post_verdicts`,
`video_reviews`, `org_usage`, `shared_views`, `chat_model_catalog`, `lead_suppressions`,
`agent_computers`, `sandbox_holders` fra gli altri. In chat un nome mancante costava un giro; su
MCP la lista è un `enum`, e un nome mancante **rifiuta una tabella valida prima che la richiesta
parta** — un guasto peggiore di quello che risolve.

Ora si genera (`scripts/query-tables-from-migrations.mjs`), e **dalle migrazioni, non dal catalogo
di produzione**. La regola è una: *una tabella esiste se una migrazione la crea*. Generare dal
catalogo sembra più diretto e sbaglia due volte:

- rimetterebbe dentro `asset_projects`, `asset_project_files` e `mcp_logs`, che in produzione
  esistono ma da un'installazione da zero no — erano già stati tolti a mano proprio per questo, e
  l'agente ci sbatteva;
- rimetterebbe dentro `thread_events_backup_20260901`. Un backup sta in `public` ma non è un dato
  da leggere, e la regola lo esclude **senza un'eccezione scritta per lui**: nessuna migrazione lo
  crea. Vale per il prossimo backup allo stesso modo.

Lo script segue anche `drop table` e `alter table … rename to` (tre rinomine reali: `nango` →
`app`, `onboarding_competitor_jobs` → `onboarding_step_jobs`), e accetta solo `public`: un
`create table stripe.subscriptions` non entra. Risultato: 149 tabelle, che sono esattamente le 153
di produzione meno le quattro che nessuna migrazione crea. Un test rigenera e confronta, quindi
fallisce da solo il giorno in cui una migrazione aggiunge una tabella — che è il giorno in cui
serve.

## I due limiti chiesti erano già veri, e la PR lo dimostra invece di costruirlo

Interrogato il catalogo di produzione: 153 tabelle in `public`, **0 senza RLS**, **0 viste e 0
viste materializzate** (quindi la trappola della vista che esegue coi permessi del proprietario
qui non esiste), 29 tabelle con RLS e zero policy (deny-all), `authenticated` con
`bypassrls=false` e `statement_timeout=8s` — che conferma gli 8s dichiarati nella testata e mai
imposti dal codice — e `service_role` con `bypassrls=true`, che è la riga che spiega perché il
client non marchiato non deve leggere.

Le uniche 4 policy permissive con predicato `true` sono `blog_authors`, `blog_categories`,
`blog_tags`, `brand_article_tags`: tassonomia del blog pubblico. Nessuna tabella di dati di brand
è aperta ad `anon`. «Solo `public`» lo impone PostgREST, che espone solo gli schemi configurati:
`.from('auth.users')` non è una richiesta che esiste.

Non è stata scritta nessuna policy nuova, e nessuna tabella è stata sbloccata per far passare il
tool.

## Superficie

`QUERY_DATABASE` nel registro dei contratti (`packages/api-contracts/src/query.ts`), quindi REST,
CLI e MCP restano allineati; la rotta monta lo **stesso** tool della chat invece di riscriverne uno
— tetti, traduzione degli errori, confine del brand e rifiuto della service role sono un pezzo di
codice solo. POST per la forma dell'input (`where` è un array di oggetti), non per l'effetto: la
lettura non spende niente ed è `destructive: false`.

## Da sapere

Sei tabelle senza lettore applicativo trovate dallo sweep del codice morto ricadono in parte fra le
16 aggiunte qui (`shared_views`, `org_usage`, `post_verdicts`, `video_reviews`): nominate e basta,
il loro destino non si decide in questa PR.
