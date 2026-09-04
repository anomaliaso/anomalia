# Il look del brand passa dal registry, e gli script arbitrari no

Andrea ha chiesto che l'AI possa «modificare l'estetica del blog, aggiungere scripts js nell'head
del sito web, modificare logo, colori, templates». Il censimento ha dato tre risposte diverse, e
una di queste e' un rifiuto.

## Il censimento

**Esiste e non era esposto** — `brand_kit.logos`, `brand_kit.favicon_url`,
`brand_kit.graphic_style` (i due font con cui le grafiche sono davvero composte),
`brand_kit.visual_style`. Tutti scrivibili solo dal form dello Studio o dai tool della chat
in-app; nessun tool MCP, nessun comando CLI. Ora `get_appearance` / `set_appearance`.

**Esiste ed era gia' esposto** — i "template" del blog. Il layout (`navbar`/`sidebar`) e il font
(`sans`/`serif`/`rounded`/`mono`) sono due enum chiusi, e `set_blog_settings` li copre gia' dalla
PR #291. Non c'era niente da aggiungere: la parola "template" in questo prodotto vuol dire sette
cose diverse (agent_templates, brand_design_templates, i template Remotion, i template di copy,
il layout del blog, il preset di font, i template email) e solo due sono stato del brand.

I colori erano **parzialmente** esposti: `set_colors` scrive `brand_kit.brand_colors`, e
`blog_config.accent` passa da `set_blog_settings`. Restano fuori `theme_color` e `fonts`, che sono
scritti solo dall'analisi del sito — esporli significherebbe far scrivere a un agente il risultato
di una misura, non una scelta.

Il censimento ha anche trovato un difetto: lo schema di `set_colors` accettava `#aabbccdd`, la
rotta lo rifiutava con 400. L'agente credeva di aver salvato un colore. Il test confronta ora le
due forme e non le lascia divergere.

**Non esiste affatto** — un posto dove salvare script personalizzati. Nessuna colonna, nessuna
chiave in `blog_config`, nessun codice. Non e' stata inventata.

## Perche' gli script arbitrari non si espongono

Il blog di un brand esce da due porte:

```
   host del brand              anomalia.so
   (blog.cliente.com)          /blog/<slug>
          │                          │
     src/routes/_site        src/routes/blog/[site]
          │                          │
          └──────► BlogShell ◄───────┘
                                     ▲
                     stessa origine di /app e della
                     sessione Supabase di chi e' loggato
```

La seconda porta e' la nostra origine. Uno `<script>` di un brand caricato li' gira con i permessi
di anomalia.so: puo' leggere lo storage della sessione e chiamare `/api/v1` con i cookie di
chiunque stia guardando quel blog mentre e' loggato. Non c'e' CSP da nessuna parte nel repository
(verificato: zero occorrenze di `Content-Security-Policy` in `svelte.config.js`, `hooks.server.ts`,
`vercel.json`, `app.html`), quindi niente lo fermerebbe.

Quindi: **elenco chiuso**, quattro fornitori con un id, nessun campo per JavaScript libero. E
l'elenco chiuso arriva fino al JSON Schema che l'agente legge — `provider` e' un enum, quindi
`custom` non e' nemmeno esprimibile.

Vale anche per i fornitori dell'elenco: un container GA4 o GTM e' JavaScript arbitrario a
un'indirezione di distanza, perche' chi lo amministra puo' riempirlo quando vuole. Per questo i
tracker si caricano **solo sull'albero `_site`** — quello servito quando l'host non e' il nostro —
e solo dopo il consenso cookie che il blog gia' aveva.

Quel confine e' tenuto da un test, non da una convenzione: `siteAnalytics` sta fuori da
`brandProfile` (che alimenta entrambi gli alberi) e
`src/lib/server/blog-analytics-boundary.test.ts` verifica che la chiami un file solo,
`_site/+layout.server.ts`. Dimenticarsene significa non caricare niente; il contrario non e'
raggiungibile.

L'id passa per `blogAnalyticsIdOk` in tre punti — lo zod del contratto, la regola di campo accanto
al modello, il renderer — e un test prova che nessuno dei quattro alfabeti ammette `<`, `>`, una
virgoletta, uno spazio o un punto e virgola. E' l'unica ragione per cui interpolarlo dentro lo
snippet del fornitore e' sicuro.

## Cosa e' stato lasciato fuori, e perche'

- **Un campo `<script>` libero.** Sopra il perche'. Se un giorno servisse davvero, la strada non e'
  un tool: e' spostare `/blog/<slug>` su un'origine separata e aggiungere una CSP. Finche' quello
  non c'e', esporlo via MCP sarebbe consegnare una porta sull'account.
- **L'icona del blog e l'avatar di un autore.** Restano esclusi come nella #291: sono caricamenti
  di file. `set_appearance` copre logo e favicon perche' passano gia' da `storeBrandLogoFromUrl`,
  che scarica dietro `safeFetchBytes` e tiene i byte — non salva una URL di qualcun altro.
- **`brand_design_templates`.** La tabella esiste dalla migration 0108 e **nessun codice la legge
  o la scrive**. Esporre un tool su una tabella morta non fa funzionare niente.
- **`theme_color` e `fonts` di `brand_kit`.** Sono misure prese dal sito del brand, non scelte.

## Note

`blog_config` guadagna una chiave (`analytics`) — nessuna migration: la colonna e' jsonb dal 0064.

Il logo si scarica anche quando il campo si chiama `logo_url`, ed e' deliberato: salvare
l'indirizzo di chi chiama metterebbe in ogni grafica del brand un'immagine che un altro puo'
cambiare dopo averla fatta approvare. La risposta riporta l'indirizzo nostro, e la descrizione del
tool dice di rileggerlo.
