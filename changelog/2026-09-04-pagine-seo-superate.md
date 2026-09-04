# Otto pagine SEO che vendevano un prodotto che non c'è più

`/ai-vs-human`, `/automation`, `/caption-writer`, `/content-calendar`, `/content-ideas`,
`/no-results`, `/scheduling`, `/strategy`.

Tutte e otto: **zero pageview in 90 giorni**, su PostHog e su Vercel, indipendentemente. Ma a
differenza dei tool, queste **erano in `MARKETING_PATHS`**, quindi in sitemap da mesi: Google
le conosce. Non si cancellano e basta — ognuna lascia un **301**.

## Le destinazioni, una per una

La destinazione non è la home. Un 301 verso una pagina irrilevante vale quasi quanto il 404
che sostituisce, quindi ciascuna va sulla pagina viva che oggi fa la stessa promessa:

| ritirata | va su | perché |
|---|---|---|
| `/ai-vs-human` | `/cant-afford` | è la stessa tesi — l'AI al posto di una persona che non ti puoi permettere |
| `/automation` | `/autoposts` | la pagina prodotto che oggi racconta il "pubblica da solo" |
| `/caption-writer` | `/autoposts` | le caption sono dentro autoposts, non più un prodotto a sé |
| `/content-calendar` | `/posting-schedule` | calendario e calendario, stessa intenzione di ricerca |
| `/content-ideas` | `/autoposts` | "cosa pubblico" è ciò che autoposts risolve |
| `/no-results` | `/not-working` | erano due pagine per la stessa domanda |
| `/scheduling` | `/posting-schedule` | sovrapposizione quasi totale |
| `/strategy` | `/usecases` | la strategia oggi si racconta per caso d'uso |

## I link interni, tutti

Le pagine dolore si linkavano a vicenda con una riga «Related:» in fondo. Sei pagine che
restano puntavano a una che se ne va — un 404 interno è peggio di uno esterno, perché lo
produciamo noi ad ogni visita. Rimpuntate: `/analytics`, `/burnout`, `/consistency`,
`/engagement`, `/posting-schedule`, `/roi`.

Anche `src/lib/data/insights.ts`: due articoli avevano `/ai-vs-human` fra i `relatedPaths`, e
`insights.test.ts` pretende (giustamente) che ogni `relatedPath` sia una pagina in sitemap.
Ora puntano a `/cant-afford` e `/autoposts`; la voce corrispondente sparisce dalla mappa di
etichette in `insights/[slug]`.

Chiavi i18n rimosse in tutti e quattro i cataloghi: gli otto rami sotto `meta.pain.*`.

## Cosa NON è stato toccato, e perché

`/strategy` compare in mezzo codebase (`workbench-paths.ts`, gli agenti, i file `strategy.md`
del brand): quello è il percorso **dentro l'app**, `/app/[brand]/strategy`, e non c'entra
niente con la pagina di marketing. Stesso discorso per `/docs/api/strategy` e
`/docs/gtm-strategy`, che restano in sitemap.

Le pagine dolore con anche un solo pageview — `/burnout`, `/consistency`, `/engagement`,
`/roi`, `/posting-schedule`, `/analytics`, `/multiple-accounts`, `/not-working`,
`/cant-afford`, `/no-time`, `/overwhelmed` — **restano tutte**. Vendono ancora il racconto
vecchio, e vanno riscritte, ma riscrivere non è cancellare: finché non c'è il testo nuovo,
una pagina che porta qualcuno vale più di un redirect.
