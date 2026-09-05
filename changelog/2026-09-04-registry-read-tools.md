# Otto letture di brand passano dal registry dei contratti

`packages/api-contracts` dichiara un endpoint una volta sola — nome, titolo,
descrizione, metodo, path, schema di richiesta, schema di risposta, fallimenti con
i loro status, annotazioni — e da lì il tool MCP nasce da solo. Funzionava già:
`list_media` è arrivato dopo il registry ed è comparso su CLI e MCP senza una riga
di `registerTool` e senza un metodo in `cli/lib/api.ts`.

Copriva 14 endpoint su 71 tool. Ora ne copre 22. Le otto migrate sono tutte letture:
`get_plan`, `get_weekly_plan`, `get_studio`, `get_seo`, `get_geo`, `get_keywords`,
`get_ads`, `list_articles`. Una lettura derivata sbagliata si vede subito e non
rompe niente; una scrittura derivata sbagliata pubblica o cancella. Per questo il
primo lotto è fatto solo di GET.

Nessuna rotta è stata scritta: esistevano già sotto `src/routes/api/v1/brands/[slug]/`,
e il contratto descrive quello che restituiscono davvero. Nessun metodo è uscito da
`cli/lib/api.ts`: tutti e otto sono ancora chiamati da un comando del terminale, e
`produce_week` legge `getWeeklyPlan` per trovare la bozza di seeds prima di produrla.

## Cosa vede un client, e cosa cambia

Nome, titolo, descrizione, campi con le loro descrizioni, insieme degli obbligatori
e `readOnlyHint: true` sono identici a prima — `cli/mcp/read-tools.test.ts` registra
quella superficie e la verifica a ogni run. Due aggiunte, entrambe dal contratto e
nessuna delle due una regressione:

- lo schema di input diventa `additionalProperties: false`, perché i contratti sono
  `.strict()`: un campo scritto male viene rifiutato invece che scartato in silenzio;
- le annotazioni guadagnano `destructiveHint: false` accanto al `readOnlyHint: true`
  che c'era già — che per una lettura non dice niente di nuovo.

`tools/list` è stato catturato attraverso il transport vero su `origin/dev` e sul
branch, e i due dump confrontati campo per campo: 71 tool prima e 71 dopo, nessun
nome aggiunto o tolto, i 63 tool non toccati byte per byte identici, e sulle otto
migrate solo le due aggiunte qui sopra. In `list_articles` cambia anche l'ordine
delle proprietà, perché il loop estende il contratto con `slug` invece di
anteporlo: `properties` è un oggetto e `required` un insieme, nessun client ne
legge l'ordine, e allinearlo vorrebbe dire cambiarlo per gli undici tool derivati
già in produzione.

## Cosa si è scoperto leggendo le rotte

I tipi del CLI avevano già preso il largo rispetto alle rotte, e il contratto lo
mette per iscritto: `/seo` restituisce anche `metrics` (da `buildSeoMetrics`) che
`SeoData` non conosce, e `/geo` restituisce anche `citability`, che vive dentro la
colonna jsonb `tech` e che `GeoData` non nomina. Nessuna delle otto GET chiama
`gateAiAction`: nessuna spende crediti, come devono essere delle letture.

`get_ads` aveva due fallimenti che il tool non dichiarava: 404 quando la feature ads
è spenta, 403 `ads_not_on_plan` quando il piano non la comprende. Ora stanno in
`failures`.

Gli output modellati larghi sono deliberati e sono quelli che nessuno può tipizzare
onestamente: una riga di `brand_kit`, un `summary` di ads, un `strategy` di keyword
salvato come jsonb. Di quelli il contratto fissa le chiavi che un chiamante
destruttura e lascia aperto il resto, invece di inventare una forma che rifiuterebbe
una risposta vera.

## Cosa resta scritto a mano, e cosa lo blocca

49 tool su 71. In gruppi, con il motivo:

- **25 pronti oggi, semplicemente non ancora migrati.** Di questi, 16 non hanno
  bisogno di nessun lavoro di design (`get_analytics`, `get_gtm`, `get_voice`,
  `update_voice`, `list_products`, `approve_posts`, `propose_plan`, `revise_plan`,
  `approve_plan`, `discard_plan`, `add_competitor`, `research_competitors`,
  `sync_history`, `seo_action`, `geo_action`, `refresh_keywords`); 8 hanno un input
  che il tool rinomina o completa prima di spedirlo — `week` diventa `week_index`
  (`save_brief`, `replan_week`, `plan_week`), `text` diventa `content_text` più un
  `kind` costante (`add_note`), `kind: 'real'` contro `kind: 'ai'` sullo stesso
  endpoint (`add_person`, `generate_person`), `action` costante (`generate_article`),
  `extra` sparso nel body (`ads_action`); e `get_dashboard` sta su
  `/api/v1/brands/:slug` senza niente sotto, mentre il registry pretende un
  `pathUnderBrand` che inizi per `/`.
- **12 hanno un `:id` nel path**: la PR #218 ha insegnato al registry a risolvere
  il prefisso e ha migrato `get_post`, `reschedule_post` e `render_post`; restano
  `approve_post`, `publish_post` e `reject_post` (pubblicano davvero), `edit_post`
  (è una PUT), i quattro tool su `/posts/:id/media` distinti da un `action`
  costante, e i quattro `*_article` di scrittura.
- **5 usano PUT o DELETE** (`update_brand_kit`, `set_colors`, `delete_document`,
  `delete_person`, `delete_competitor`): `BrandEndpoint.method` conosce solo
  `'GET' | 'POST'`.
- **3 non sono una sola chiamata**: `get_status` ne fa due e rimpasta il risultato,
  `produce_week` legge il piano per trovare la bozza e poi produce, `chat` non passa
  nemmeno per `/api/v1` (parla con `/app/:slug/chat`) e restituisce una stringa.
- **4 non sono legati a un brand**: `login`, `logout`, `whoami`, `list_brands`. Il
  registry, per costruzione, parla solo di `/api/v1/brands/:slug/…`.
