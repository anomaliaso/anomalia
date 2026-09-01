# @anomalia/leads-core

Trovare conversazioni in cui un brand ha davvero qualcosa da dire, giudicarle, scriverne la bozza,
e non disturbare mai due volte la stessa persona. È la parte del prodotto che non dipende da
Anomalia: niente piani, niente `$env`, niente SvelteKit.

Il confine lo tiene un test, non la buona volontà: `packages/no-app-imports.test.ts` fallisce al
primo `$lib` o `$env` che entra qui dentro.

## Moduli

| Import | Cosa contiene | Dipendenze |
|---|---|---|
| `@anomalia/leads-core/intent` | Le bande di intento d'acquisto (`seeking_now` → `none`), il loro ordine in coda, la normalizzazione di quello che risponde il modello | nessuna |
| `@anomalia/leads-core/match` | Ritrovare la nostra bozza in un thread pubblicato da un umano: shingle di tre parole, contenimento, soglia | nessuna |
| `@anomalia/leads-core/contact` | "Una persona, un tocco": gate globale, soppressione, setaccio dell'opt-out, riga di opt-out nel DM, scadenze di retention | client Supabase iniettato |
| `@anomalia/leads-core/prompts` | Il drafter (commento pubblico + DM) e la selezione degli N lead migliori del giorno | `./intent` |
| `@anomalia/leads-core/feed` | Dove si trovano le conversazioni: RSS, Google News, subreddit in rising, ricerche su Reddit/Threads/X Communities/LinkedIn. Più parsing, finestre di freschezza e round-robin | gateway di scraping iniettato |

## Le dipendenze invertite

Il package non conosce il database, il reporter dell'app, il gateway di scraping né le
credenziali: entrano tutti dall'esterno.

```ts
// Il client Supabase è un parametro, mai un import: il package non legge env e non crea client.
await contactGate(admin, 'reddit', 'pippo');

// L'errore va dove decide l'app. Il default stampa in console; Anomalia passa `swallow`,
// che aggiunge Sentry.
await sweepLeadRetention(admin, swallow);

const sources = createSources({
  scrape,                                // il gateway di scraping
  redditAuth: () => ({ token, user }),   // funzione, NON oggetto — v. sotto
  fetchViaBrowser                        // Chrome vero, per i feed che bloccano i client da server
});
await sources.fetchSourceFeed({ kind: 'subreddit', value: 'saas' });
```

`redditAuth` è una **funzione** perché le credenziali vanno lette al momento della chiamata:
congelarle quando si costruisce il factory vorrebbe dire che un cambio d'ambiente non arriva mai.
C'è un test che lo pinna.

`scrape` deve lanciare errori nella forma `scrapecreators <status> <body>`: `isNoMatch404` ci
riconosce il "nessun risultato" di LinkedIn, che arriva come 404 ma è un insieme vuoto, non un
guasto. Le ricerche di conversazioni **propagano** gli errori di proposito — prima li
inghiottivano, e una chiave scaduta finiva nei log come "0 item", indistinguibile da "nessuna
conversazione degna oggi".

## Contratto di schema

`contact` e le query che lo circondano si aspettano queste tabelle. Sono l'unica cosa da
replicare per usare il package altrove:

- **`lead_suppressions`** — `platform`, `handle`, `source`, `reason`, con `unique (platform, handle)`.
  **Non ha `brand_id`, ed è deliberato**: il frequency cap è globale all'istanza. Chi lo scopa per
  brand rompe la promessa che rende difendibile l'outreach.
- **`brand_news_items`** — il lead: `url`, `title`, `status`, `author_platform`/`author_handle`
  (l'indice che serve al gate), `done_at`, `suggestion`, `dm_draft`, `gist`, `intent`.
- **`lead_outcomes`** — l'esito osservato, in append: `lead_id`, `found`, `method`, `match_score`,
  `upvotes`, `replies`, `removed`.
- **`radar_searches`** — telemetria di scansione, solo perché la retention la scade.

## Cosa è rimasto fuori, e perché

L'orchestrazione resta nell'app (`src/lib/server/radar.ts`): il giro sulle sorgenti, le scritture,
la produzione dei post, le email, il tick. Dipende da piani, cron, editorial plan e director —
cose di Anomalia, non del dominio lead. Fuori anche il gating per piano (`radarPrefsOf`,
`radarPlatformEnabled`): il package riceve limiti e sorgenti come parametri, non li decide.
