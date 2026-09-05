# L'audit SEO era irraggiungibile dal tool MCP: un vocabolario tradotto in un posto solo su due

`seo_action` dichiarava `action: z.enum(['run', …])`, l'handler di `/seo` si ramifica su
`if (action === 'audit')` e chiude con `Unknown action` → 400. L'intersezione fra ciò che lo schema
permette e ciò che la rotta gestisce **non conteneva l'audit**: `run` prendeva 400, `audit` lo
rifiutava zod prima ancora di partire. Le altre quattro azioni funzionavano; quella per cui il tool
esiste, no. In produzione.

## Perché nessuno se n'era accorto

`cli/commands/seo.ts` aveva una mappa: `{ run: 'audit', plan: 'plan', more: 'more', asset: 'asset',
article: 'article' }`. La CLI **traduceva** prima di chiamare, quindi da terminale l'audit partiva.
Il tool MCP è generato dal registro e manda il valore così com'è.

Stessa rotta, due vocabolari, e la traduzione esisteva **solo sul percorso che un umano prova a
mano**. Su quello dell'agente no — e l'agente è l'unico che non si lamenta. Vale la pena notare
anche la forma della mappa: quattro voci su cinque erano l'identità, e servivano solo a nascondere
la quinta. Una mappa che traduce `plan` in `plan` non traduce: mimetizza.

## Perché `audit` e non `run`

La cura non è aggiungere `audit` all'enum accanto a `run`: due nomi per la stessa cosa è il
difetto, non il rimedio — è la regola scritta in due posti che diverge al primo cambiamento. Si
sceglie un vocabolario e vale su tutti e tre i lati.

`audit` per tre ragioni, in ordine di peso:

1. **È quello che l'handler ha sempre gestito.** Spostare l'handler significherebbe cambiare il
   comportamento di una rotta che funziona per riparare una descrizione che non funziona.
2. **`geo_action` lo chiama già così** — `z.enum(['audit', 'fix'])`, e lì contratto e handler sono
   allineati. Un secondo vocabolario per la stessa idea, fra due tool fratelli, è come è cominciato
   questo difetto.
3. **A un modello che legge l'enum, `audit` dice cosa succede.** `run` non dice niente: eseguire
   cosa?

`run` resta una parola da terminale — `anomalia seo <slug> run` continua a funzionare — ma come
**alias**, non come vocabolario parallelo. E la CLI non tiene più una copia dell'elenco: importa
`SEO_ACTIONS` dal contratto, così l'unico posto dove il vocabolario può divergere è sparito.

## Il test non è «`audit` funziona»

Quello sarebbe passato anche prima, con `run` scritto al posto giusto. Serve quello che si rompe
quando i due elenchi divergono **di nuovo**, e in entrambe le direzioni: un valore dichiarato che
la rotta non gestisce, e un ramo della rotta che lo schema non permette di raggiungere.

Sta in `registry.test.ts`, accanto all'altro guardiano che confronta il registro con le rotte su
disco, ed è la stessa forma di `db-vocabularies.test.ts`: un elenco **derivato** da una fonte sola
invece che due copiati a mano. Per ogni endpoint con un `action`, legge i valori dichiarati
dall'enum di zod e i rami `action === '…'` / `case '…':` del suo `+server.ts`, e pretende che siano
lo stesso insieme.

Ed è **generalizzato**, perché la stessa struttura ce l'hanno anche `ads_action` e `geo_action`:
i tre sono controllati tutti, e i tre passano solo perché `ads_action` è stato tipizzato poco
prima. Due asserzioni difendono il test da sé stesso — che l'elenco dei tool con `action` non si
svuoti (o non misura più niente) e che ogni `action` sia un elenco chiuso e non una stringa libera
(o non c'è niente da confrontare).

Rosso prima su `seo_action` soltanto, verde dopo. `ads_action` e `geo_action` erano già allineati.

## Una nota su un test che pinnava il difetto

`cli/mcp/migrated-writes.test.ts` fissava `enum: ['run', …]` come la forma da conservare
attraverso la migrazione al registro. Faceva il suo lavoro — accorgersi che lo schema cambiava — ma
il valore che custodiva era quello che prendeva 400. È aggiornato con accanto il perché: un test
che pinna una forma la conserva anche quando è sbagliata, e la nota è l'unica cosa che impedisce
al prossimo di ripristinarla.
