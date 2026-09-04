# La dashboard del nuovo frontend, e il link che la manda al cliente

Quarta superficie di `/v2` dopo calendario (#229), post (#235) e panoramica (#236). Assorbe la
panoramica: `/v2/[brand]` non è più un elenco di fatti sul brand, è la Home che dice cosa devi
fare adesso, cosa esce nei prossimi giorni e tre numeri.

La bozza da cui viene è un disegno: barra laterale col nome del brand, «Da fare» con le cose che
richiedono attenzione, «Prossime uscite» e tre riquadri di numeri.

## Cosa è stato preso dalla bozza e cosa no

Presi: la struttura (laterale + corpo), la gerarchia (prima cosa fare, poi cosa esce, poi i
numeri), la riga con giorno / piattaforma / titolo / stato, e le voci della laterale.

Non presi: i **valori**. La seconda scheda della bozza («Servono 3 foto del nuovo menù») descrive
una richiesta di materiali che il prodotto oggi non modella — non esiste una tabella di richieste
al cliente, e inventarne una in una pagina che deve solo leggere sarebbe stato inventare un dato.
Il terzo riquadro della bozza è «Copertura»: sulla dashboard autenticata è diventato «Waiting for
you», perché la copertura richiede `getAnalytics` (sei query più duecento righe di storico) per
un solo numero, mentre `pendingCount` arriva già con la lettura del brand. La copertura resta
dove serve davvero: nello snapshot che il cliente apre, dove è già pagata dal report del mese.

## «Da fare» è una tabella, non una catena di if

`ATTENTION` in `src/routes/v2/[brand]/dashboard.ts` è una riga per condizione: quando compare,
che titolo ha, e dove porta. Le voci senza una destinazione hanno `action: null` e non mostrano
nessun bottone — un bottone che non porta da nessuna parte è peggio del silenzio. Stessa regola
per la barra laterale: Materials, Strategy e Results non hanno ancora una pagina, quindi non sono
link, sono testo spento. Nessun 404.

`overview.ts` e il suo test sono stati cancellati: `nextOut` restituiva una sola uscita, e la
dashboard ne mostra cinque. Una funzione superata si toglie, non si lascia accanto alla nuova.

## La guida MCP sta in cima, e non finge di sapere se sei collegato

La richiesta era esplicita: come si collega il prodotto al proprio agente deve stare **nella**
dashboard, non dietro un link. Tre blocchi copiabili — la config MCP remota, il plugin di Claude
Code, l'installazione della CLI — presi da `cli/README.md` e `cli/docs/mcp.md`, non inventati.

Doveva collassarsi «quando è già connesso». **Quel segnale oggi non esiste, e non è stato finto.**
Cercato ovunque: l'MCP remoto autentica con un JWT Supabase che è indistinguibile da un login del
browser; `src/lib/server/oauth.ts` non tiene nessuna tabella di client (il `client_id` *è* la
registrazione, firmata — la scelta è dichiarata lì con un commento che dice esattamente quando
rivederla); `mcp_logs` non sta in nessuna migration ed è esclusa apposta da
`20260827130000_selfhost_schema_parity.sql`, non ha mai avuto righe e non popola `brand_slug`;
`api_keys.last_used_at` è per utente, non per brand, e il percorso MCP non lo tocca mai perché
`cli/mcp/verify-token.ts` rifiuta le API key statiche. Quindi il blocco è un `<details open>`
nativo che chiude chi legge, e la PR dice cosa servirebbe per saperlo davvero.

## Il link al cliente riusa tutto

Nessun meccanismo nuovo: `dashboard` è un terzo valore in `SHARED_VIEW_TYPES` e un builder in
`SNAPSHOT_BUILDERS`. Token, scadenza, revoca, hash, rotta pubblica e allowlist restano quelli di
#221.

`buildDashboard` non fa query proprie: compone `buildCalendar` e `buildMonthlyReport`. Una terza
allowlist sarebbe stata una terza cosa da tenere allineata a `posts`, e la prima colonna nuova
sarebbe uscita da lì.

Nella vista pubblica non c'è la guida MCP e non c'è nessuna azione: tre numeri e le prossime sei
uscite, con lo stato del cliente (`planned` / `published`), mai il workflow interno.

## La migration non è applicata

`view_type` ha un check che elenca i tipi ammessi: senza
`20260904190000_shared_views_dashboard.sql` un link `dashboard` viene rifiutato da Postgres con un
23514. La migration è scritta nel repo e **non** è stata applicata da qui. `npm run
schema-drift-check` la vedrà mancante finché non la applica una persona.
