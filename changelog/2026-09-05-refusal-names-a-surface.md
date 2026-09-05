# Il rifiuto di `query` mandava a cercare tre tool che il chiamante non ha

`NO_SESSION_ERROR.fix` diceva:

> *Use the purpose-built read tools (read_posts, read_brand_kit, read_plan, …) — they scope to this
> brand by construction.*

I tre nomi esistono davvero: sono tool della **chat**. Ma `query` si nega solo alla service role —
il percorso a chiave API e la coda — e su quelle superfici quei tre tool non ci sono. Il consiglio
mandava quindi a cercare nomi che chi lo legge non può vedere, che è il modo più efficace di far
riprovare la stessa cosa: un modello che non trova il rimedio suggerito conclude che il rimedio non
esiste, non che sta guardando nel posto sbagliato.

Ed è una lista di nomi dentro un messaggio d'errore, cioè qualcosa che invecchia da solo: i tool di
lettura si stanno unificando dentro `query`, quindi quei tre nomi sarebbero diventati due, poi uno.

Adesso nomina la **superficie**, che non cambia: «this surface's own read tools — there is one per
subject». E dice l'altra mossa, quella che risolve davvero il rifiuto invece di aggirarlo: tornare
con la propria sessione (`anomalia login`), perché è la sessione che manca, non il tool.

## Perché sta in un commit suo

È la regola numero 7 del lavoro sulle descrizioni — *gli errori dicono cosa fare, non cosa è andato
storto* — applicata al file che quella regola l'aveva inventata. `query-tool.ts` è il modello citato
in `AGENTS.md`: traduce gli errori PostgREST in mosse. Il suo unico rifiuto scritto a mano era
l'unico posto dove non la rispettava.

Segnalato da `a8c22181e602c7208` mentre spostava le letture dentro `query`.
