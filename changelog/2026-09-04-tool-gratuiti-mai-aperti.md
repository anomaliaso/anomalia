# I 15 tool gratuiti che nessuno ha mai aperto

`/tools` conteneva 24 tool. **Quindici di quei ventiquattro non sono mai stati aperti da
nessuno**: zero pageview in 90 giorni, misurati due volte e su due sistemi indipendenti —
PostHog (che qui è Tier 1, cookieless, senza gate di consenso, quindi vede tutto) e Vercel
Web Analytics. I due numeri coincidono. E nessuno dei quindici è mai stato messo in
`MARKETING_PATHS`, quindi non sono mai entrati in sitemap: Google non li ha mai visti.

Zero traffico + zero indicizzazione = si possono togliere davvero. È l'unico gruppo del sito
per cui questo è vero, ed è per questo che è la prima cancellazione.

## Cosa sparisce

Pagina, endpoint API e chiavi i18n (tutti e quattro i cataloghi) di:

`ai-visibility`, `backlink-checker`, `broken-links`, `competitor-gap`, `conversation-gap`,
`heading-audit`, `keyword-difficulty`, `long-tail`, `meta-tags`, `page-speed`,
`rank-checker`, `redirect-checker`, `robots-tester`, `schema-validator`,
`traffic-estimator`.

Con loro se ne va `src/lib/server/conversation-gap-public.ts` (un solo chiamante, il suo
endpoint; nessuna tabella letta, è analisi live) e le due fasce di costo `DFS_LABS` e
`DFS_BACKLINKS` in `tool-guard.ts`, che dopo la rimozione non le usava più nessun tool.

Restano i nove che qualcuno usa davvero: `agent-team`, `geo-audit`, `keyword-research`,
`sitemap-analyzer`, `social-media-roi`, `llms-txt-generator`, `llms-txt-validator`,
`caption-length`, `best-time-to-post`.

## Nessun 404, mai

`RETIRED_PAGES` in `src/lib/seo.ts` è la nuova tabella unica: percorso ritirato → pagina che
ne ha preso il posto. `hooks.server.ts` la legge prima di risolvere la rotta e risponde
**301**, tenendo la lingua in cui il visitatore è arrivato (`/it/tools/meta-tags` →
`/it/tools`).

La destinazione è **scelta**, non è la home: `keyword-difficulty`, `long-tail`,
`competitor-gap` e `traffic-estimator` vanno su `/tools/keyword-research`; `broken-links` e
`redirect-checker` su `/tools/sitemap-analyzer`; `ai-visibility` su `/tools/geo-audit`;
`robots-tester` su `/tools/llms-txt-validator`. Un 301 verso una pagina irrilevante vale
quasi quanto il 404 che sostituisce.

Perché in `hooks.server.ts` e non in `vercel.json`: il redirect di Vercel non esiste in
`vite dev`, quindi non sarebbe verificabile in locale e duplicherebbe la logica del prefisso
di lingua che il hook ha già risolto in `event.locals.locale`.

## Il test che tiene la promessa

`src/lib/seo.retired.test.ts` — scritto rosso prima del codice — impedisce le quattro cose
che rompono una pulizia come questa: un 301 verso una pagina che non esiste, una catena di
redirect, un percorso ritirato ancora in sitemap, e una riga in `RETIRED_PAGES` il cui file
di rotta esiste ancora (o il contrario).

## Aggiunte in sitemap

`/tools` e `/docs/mcp`, che il footer linka e che non erano in `MARKETING_PATHS`.
`/docs/mcp` in particolare: con il prodotto che si sposta sull'agente esterno del cliente,
è una delle pagine che contano di più, e Google non sapeva che esistesse.
