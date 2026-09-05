# I risultati nel frontend sottile — `/v2/:brand/results`

La quinta superficie del frontend sottile, dopo calendario (#229), post (#235), materiali (#247)
e strategia (#248). È "Risultati" nel mockup: quanto è uscito, come è andato, cosa non è uscito
e perché.

Sola lettura.

## Perché esiste

Anomalia produce e pubblica da sola. La domanda che resta è una: *sta funzionando?* Senza una
risposta, l'autopilot è un abbonamento a fiducia cieca — e il momento in cui la fiducia si rompe
non è il post mediocre, è il post che non è mai uscito e di cui nessuno ha saputo niente.

Per questo la sezione "Delivery" c'è anche quando è vuota: dire «0 falliti» è un'informazione, non
mostrarla lascia il dubbio.

## Cosa mostra, e da dove viene ogni numero

**`GET /api/v1/brands/:slug/analytics`** — è il grosso della pagina:

- le tessere in alto: pubblicati, programmati, in attesa di revisione, visualizzazioni;
- la tabella per piattaforma: post, views, likes, comments, shares, sommati da
  `social_post_history.metrics`, cioè da quello che le piattaforme hanno restituito;
- "What worked": i sei post migliori per punteggio pesato, con miniatura e link al vivo;
- "Delivery": il totale, i falliti, e le righe di `publish_logs` che portano un errore.

**`GET /api/v1/brands/:slug/seo`** e **`GET /api/v1/brands/:slug/geo`** — una striscia sola in
fondo, e solo se hanno misurato qualcosa.

## La regola che decide cosa si vede

`shown()`. Prende una lista di `{label, value}` e tiene solo le voci il cui valore **è un
numero**. `SeoMetrics` ha undici campi e sono tutti `number | null`: un brand senza sito, o con un
audit che non è mai girato, li ha nulli quasi tutti. La scelta era fra mostrare "—" undici volte e
non mostrare la voce. Non mostrarla: una tessera vuota promette un numero che non esiste, e la
somma di undici promesse vuote è una pagina che sembra rotta.

Uno zero misurato **resta**, perché zero backlink è un fatto. Il filtro è sul tipo, non sulla
verità: `typeof value === 'number'`. Se l'intera striscia è vuota, la sezione non si disegna.

## Cosa non si può mostrare, e perché non è stato inventato

**L'andamento nel tempo.** `/seo` restituisce `metrics.trend[]` e `/geo` un `trend[]`, quindi il
dato per una sparkline c'è. Ma per la parte social — quella che conta, e l'unica che ogni brand
ha — non c'è: `getAnalytics` somma `social_post_history` su tutta la storia e restituisce un
totale, senza finestra e senza confronto. Un grafico del solo SEO accanto a numeri social senza
grafico direbbe che il SEO è la cosa importante, che è il contrario di come sta il prodotto.

**La copertura per periodo.** Nessun numero di questa pagina ha una finestra temporale: sono
totali da sempre. `getAnalytics` non accetta né `from` né `to`. Un "questo mese" richiede un
parametro sull'endpoint, che usano anche CLI e MCP: è un PR suo, non questa pagina.

**Il grado SEO.** `plan.evaluation.grade` esiste ma è una lettera, non un numero, e `shown()`
tratta numeri. Aggiungere un secondo meccanismo per un solo valore avrebbe raddoppiato le regole
di "cosa si mostra" — la cosa che questa pagina ha esattamente un modo di decidere.

**`/web/audits` non è stato chiamato.** È l'indice storico degli audit
(`{id, at, tech_score, share_of_voice, citability_score, binding_constraint, citation_count,
finding_count}`): per lo stato attuale non aggiunge niente che `/seo` e `/geo` non diano già, e
per la storia servirebbe il grafico che (vedi sopra) non si può fare onestamente. Una quarta
richiesta a ogni caricamento per dati duplicati non si paga.

## Una nota sui numeri web

I nove cron che alimentano `brand_geo_audits`, `brand_seo_plans` e le tabelle dei backlink sono
in corso di spegnimento (`kill/seo-geo-pages`, non ancora mergiato al momento di questa PR: su
`dev` girano ancora tutti e nove). Se quel PR entra, la striscia "Web" continua a mostrare
l'ultimo audit disponibile e si ferma lì. È il comportamento giusto — sono dati storici veri, e
`shown()` li fa sparire da sé quando non ce ne sono — ma va saputo, perché un numero fermo
sembra un difetto se non si sa che la sorgente è stata spenta di proposito.

## Il contratto che manca

`/analytics` è una rotta viva senza voce in `BRAND_ENDPOINTS`: non ha `tool`, non ha schema di
output, e quindi non esiste per MCP. È l'unico dei sei endpoint letti dalle superfici `/v2` in
questa condizione. Questa PR non lo aggiunge — un contratto nuovo è una superficie MCP nuova, con
il suo nome di tool e la sua descrizione, e non si decide di sfuggita mentre si scrive una pagina.
Ma è la ragione per cui i tipi di lettura stanno scritti a mano in `+page.server.ts` invece di
arrivare dallo schema, ed è il motivo per cui vale la pena aprirlo.

## Cosa è stato scartato

**Nessuna libreria di grafici.** Non c'è un grafico, quindi non c'è niente da installare. Il
primo bundle di questa pagina è SvelteKit più un badge.

**Nessuna primitiva nuova.** Solo `badge`.

**Nessuna utility `grid`.** `app.css` ha un `.grid` globale
(`grid-template-columns: 1.7fr 1fr`). Tessere e tabelle sono flex.

**Nessuno stato client.** Nessun filtro, nessun pannello, nessun `replaceState`.

**Nessuna chat, nessun link alla chat.**

**Nessuna barra laterale.** Un link che darebbe 404 non si mette.
