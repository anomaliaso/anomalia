# Il nucleo del lead finding esce dall'app: `@anomalia/leads-core`

La domanda che ha aperto il lavoro era commerciale, non tecnica: le feature di lead
hunting reggerebbero un SaaS verticale a sé? La risposta onesta era "sì, ma non copiando
`radar.ts`": 1782 righe con trenta import, di cui env SvelteKit, piani, editorial plan,
director, scheduler ed email. Quello che ha valore fuori da Anomalia era dentro, ma non
separabile a vista.

Ora cinque moduli stanno in `packages/leads-core/`, e il guardiano che già esisteva
(`packages/no-app-imports.test.ts`) li tiene puliti: al primo `$lib` o `$env` fallisce.

- `intent` — le bande di intento d'acquisto e il loro ordine in coda. Zero dipendenze.
- `match` — ritrovare la nostra bozza in un thread che ha pubblicato un umano, con il suo
  account. Shingle di tre parole e contenimento, non Jaccard.
- `contact` — "una persona, un tocco": il gate globale, la soppressione, il setaccio
  dell'opt-out, le scadenze di retention. E `authorProfileUrl`, che stava in `radar.ts` ma
  risponde alla stessa domanda di `platformOf`: dove si raggiunge questa persona.
- `prompts` — il drafter del commento e del DM, con i guard-rail nati dai modi in cui le
  bozze fallivano davvero, e la selezione degli N migliori del giorno.
- `feed` — dove si trovano le conversazioni: RSS, Google News, subreddit in rising, e le
  ricerche su Reddit, Threads, X Communities e LinkedIn. Più il parsing, le finestre di
  freschezza e il round-robin a quote eque.

## Le due dipendenze invertite, e le due lasciate stare

Il client Supabase era **già** un parametro ovunque in `radar.ts` e `lead-contact.ts`: non
c'era niente da invertire, solo da non aggiungere. L'unica inversione vera è `swallow`, che
riporta a Sentry via `@sentry/sveltekit`: diventa un `report` iniettato, con default in
console. Ogni call site dell'app passa `swallow`, quindi Sentry continua a vedere tutto, e
un test lo pinna — una scadenza fallita deve arrivare al reporter iniettato.

Non è stato invertito niente per simmetria. Il gating per piano (`radarPrefsOf`,
`radarPlatformEnabled`, `radarSourceLimit`) resta nell'app: è il pricing di Anomalia, e un
verticale ne avrebbe un altro — il package riceve limiti e sorgenti come parametri. Restano
fuori anche `radarScan`, `radarProduce`, `radarArticles`, il digest e il tick: sono
orchestrazione, e tirarli dentro avrebbe voluto dire una `Deps` con quindici campi per
guadagnare niente.

## I fetcher: un factory, non quindici parametri

I fetcher sono la parte più riusabile di tutte, e l'unica con dipendenze vere: il gateway di
scraping, il token del feed personale di Reddit, e Chrome vero per i feed che bloccano i
client HTTP da server. Non basta un `deps` per funzione, perché `radarScan` li passa come
callback per le query dinamiche e `radarEngage` usa `fetchRedditText` da solo — quindi
`createSources(deps)` restituisce le funzioni già legate, e i call site restano puliti.

`redditAuth` è una **funzione** e non un oggetto: il codice originale leggeva `env` a ogni
chiamata, e congelare le credenziali alla costruzione del factory avrebbe voluto dire che un
cambio d'ambiente non arriva mai. C'è un test che lo pinna, perché è esattamente il tipo di
regressione che nessuno nota finché non serve.

Lo script di pagina di Browserless resta nell'app: il package riceve "una funzione che dato un
URL torna il testo" e non sa che dietro c'è un browser.

È stato aggiunto un test che non esisteva, sull'instradamento di ogni `kind` verso il suo
endpoint. È la classe di bug che i commenti del file raccontano — `linkedin_query` che cadeva
su `fetchFeed` e scaricava le parole chiave come se fossero un URL RSS, e X chiamata con `id=`
dove l'endpoint vuole `url=`. Entrambi si presentavano come "0 item": un successo pulito e
vuoto, indistinguibile da "nessuna conversazione degna oggi". Ora un'inversione di quel tipo
fa fallire un test invece di spegnere una sorgente in silenzio.

## Difetti visti e non toccati

`radar.ts` importava `suppressAuthor` senza chiamarlo mai: import morto, rimosso.

Il tipo di ritorno di `pendingOutcomeChecks` ometteva `author_handle`/`author_platform` che il
mapper restituisce davvero. Leggendolo sembrava un difetto vivo — il ramo opt-out di
`checkLeadOutcome` che non parte mai — e invece **il test ha detto di no**: a runtime i campi
ci sono e la soppressione scatta. Il difetto era solo il tipo che mente, e vale comunque,
perché chi avesse rimosso quelle due righe dal mapper avrebbe spento la soppressione senza un
solo errore di compilazione. Ora il tipo li dichiara e due test coprono il giro completo
(`runOutcomeChecks` → thread con ritiro del consenso → riga in `lead_suppressions`), che prima
non aveva copertura alcuna.

Vale la pena registrare l'ordine: la diagnosi a vista era sbagliata, e a correggerla è stato il
test scritto prima del fix — non una rilettura più attenta.
