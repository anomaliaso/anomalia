# Footer: da 50 link a 21

Il footer elencava mezzo sito: 50 link su 5 colonne, con `Insights`, `Blog`, `Compare` e
`Changelog` ripetuti due volte ciascuno. Un footer che elenca tutto non è una mappa, è un
muro: nessuno lo legge, e i link che contano davvero — documentazione, prezzi, legale —
annegano fra le pagine SEO.

Ora sono quattro colonne e 21 voci:

- **Product** — usecases, autoposts, autoblog, ai-seo-agent, leads-finder, news-radar, pricing
- **Developers** (colonna nuova) — docs, docs/mcp, docs/cli, docs/api, agents
- **Company** — faq, changelog, privacy, terms, preferenze cookie
- **Resources** — blog, /tools, llms.txt, status

Le colonne «Problems we solve» (8 pagine dolore) e «Free tools» (9 tool singoli) spariscono
come colonne. Le pagine **non spariscono**: restano raggiungibili per URL e dalla sitemap, e
i tool si raggiungono dall'indice `/tools` che ora è nel footer. Togliere un link dal footer
è reversibile e non produce nessun 404 — è per questo che questa è la prima PR della pulizia
e l'unica che non cancella niente.

La colonna **Developers** è nuova per una ragione precisa: con il prodotto che si sposta
sull'agente esterno del cliente, MCP, CLI e API sono la superficie che conta, e finora non
avevano un posto nel footer. `/docs/mcp` in particolare non era linkato da nessuna parte e
non era nemmeno in sitemap.

Chiave i18n aggiunta: `marketing.footer.developers` in tutti e quattro i cataloghi (en, it,
es, fr) — il test `src/lib/i18n/locales.test.ts` pretende parità e ha ragione.

Le chiavi `pain*` e `freeTools` restano nei cataloghi: le pagine dolore esistono ancora e
`freeTools` ora è il titolo del link all'indice. Nessuna chiave orfana introdotta.

## Cosa NON è stato toccato

`marketing.footer.tagline` e `marketing.footer.ctaHeading` vendono ancora il prodotto
vecchio («An AI that runs your social media», «Anomalia plans, creates and publishes your
content»). Riscrivere la copy è un lavoro diverso da sfoltire i link, e va fatto insieme
alle pagine che raccontano la stessa storia — non di straforo dentro una PR di manutenzione.
