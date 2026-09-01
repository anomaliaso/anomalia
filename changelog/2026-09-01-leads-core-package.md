# Il nucleo del lead finding esce dall'app: `@anomalia/leads-core`

La domanda che ha aperto il lavoro era commerciale, non tecnica: le feature di lead
hunting reggerebbero un SaaS verticale a sé? La risposta onesta era "sì, ma non copiando
`radar.ts`": 1782 righe con trenta import, di cui env SvelteKit, piani, editorial plan,
director, scheduler ed email. Quello che ha valore fuori da Anomalia era dentro, ma non
separabile a vista.

Ora quattro moduli stanno in `packages/leads-core/`, e il guardiano che già esisteva
(`packages/no-app-imports.test.ts`) li tiene puliti: al primo `$lib` o `$env` fallisce.

- `intent` — le bande di intento d'acquisto e il loro ordine in coda. Zero dipendenze.
- `match` — ritrovare la nostra bozza in un thread che ha pubblicato un umano, con il suo
  account. Shingle di tre parole e contenimento, non Jaccard.
- `contact` — "una persona, un tocco": il gate globale, la soppressione, il setaccio
  dell'opt-out, le scadenze di retention. E `authorProfileUrl`, che stava in `radar.ts` ma
  risponde alla stessa domanda di `platformOf`: dove si raggiunge questa persona.
- `prompts` — il drafter del commento e del DM, con i guard-rail nati dai modi in cui le
  bozze fallivano davvero, e la selezione degli N migliori del giorno.

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

## Cosa NON è stato fatto

I fetcher delle sorgenti (Reddit, Threads, X Communities, LinkedIn, RSS) sono la parte più
riusabile di tutte e sono ancora in `radar.ts`: dipendono da `scrapeCreatorsGet`, da quattro
variabili d'ambiente e dal fallback Browserless. Sono il prossimo lotto, e sono ~350 righe:
tenerlo separato lascia questo diff verificabile invece che enorme.

Due difetti trovati leggendo, non toccati per non mescolare spostamento e comportamento:
`radar.ts` importava `suppressAuthor` senza chiamarlo mai (rimosso, era import morto), e il
tipo di ritorno di `pendingOutcomeChecks` omette `author_handle`/`author_platform` che il
mapper restituisce davvero — quindi il ramo opt-out di `checkLeadOutcome` non parte mai da
`runOutcomeChecks`. Quello è un difetto vero e vuole il suo test, prima del suo fix.
