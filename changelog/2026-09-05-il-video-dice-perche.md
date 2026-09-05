# Il video dice perché ha fallito, e quanto dura davvero

Prova capo a capo da un client MCP vero, stack locale, render veri. Immagini e video funzionano e il
`job_id` arriva a un `media_id`. Sono usciti due difetti, ed è lo stesso difetto due volte: **il tool
sapeva una cosa e non la diceva.**

## 1. `render_failed` nudo

L'agente esterno riceveva:

```
API 502: {"error":"render_failed"}
```

Il motivo — `Invalid reference URL: Localhost URLs are not allowed` — **esisteva già**, in
`submitVideoRender`: veniva `console.error`'ato e poi buttato con un `return undefined`. Chi chiamava
il tool non sapeva se riprovare, cambiare parametro o rinunciare. È probabilmente il motivo per cui
l'agente si è arreso: riprovare uguale è l'unica mossa che un errore muto suggerisce.

È lo stesso principio già applicato in `query-tool.ts` per gli errori PostgREST — *«un errore nudo
dice a un modello che ha sbagliato e non come si fa a non sbagliare, quindi riprova uguale»*.

Il motivo ora risale fino alla risposta, in un campo `reason` accanto a `error`. Quando il fornitore
non dice niente, **la chiave non c'è**: assente è meglio di una stringa di comodo che nessuno ha
pronunciato.

### Perché un canale a parte e non un valore di ritorno

`submitVideoRender` ha due chiamanti e uno vive in `src/lib/agent/tools/create-content-tools.ts`, che
è fuori dai file toccabili. Cambiargli la firma per far passare una stringa costava più di quanto
valesse: `onSubmitError?: (reason: string) => void` è additivo e i chiamanti esistenti non cambiano
di una riga.

## 2. La durata raddoppiata in silenzio

Chiesti **5 secondi**, salvati **10**. I video si pagano al secondo, quindi era il doppio del conto
senza che niente lo dicesse.

`clampVideoDuration` alza il pavimento a `MIN_DURATION = 10` **ignorando** `caps.minDuration` che
Grok Imagine dichiara a 1:

```ts
const floor = Math.min(Math.max(caps.minDuration, MIN_DURATION), caps.maxDuration);
```

**`MIN_DURATION` non è stata toccata.** È un pavimento di prodotto e vale per il percorso dei post,
dove una clip social da 2 secondi non ha senso: spostarlo avrebbe cambiato l'autopilot, che nessuno
ha chiesto di cambiare. Il difetto era sulla mia superficie, ed è lì che si chiude — **la durata si
contratta prima di inviare**: se il modello scelto non può filmare i secondi chiesti, si **rifiuta**
con `duration_out_of_range` dicendo il numero più vicino che accetta. Mai riportata di nascosto.

E la risposta porta `duration_seconds`, i secondi davvero mandati — stessa forma di `renders` e del
modello effettivo: la risposta dice cosa è successo, non cosa era stato chiesto.

Un test che passava è stato **corretto**: chiedeva 5 secondi e li vedeva accettati. Codificava il
difetto.

## Cosa NON era un difetto

L'animazione da `base_media_id` è fallita solo perché la copertina viaggia **come URL** e in locale è
`http://localhost:8000/...`, che OpenRouter non può raggiungere. In produzione è un URL Supabase
pubblico. Tutta la catena aveva funzionato: id risolto, modello immagine→video scelto, `first_frame`
costruito, invio partito.

Vale però sapere che quel percorso **dipende dal fatto che il fornitore possa scaricare il nostro
signed URL**. Se lo Storage diventasse privato si romperebbe lì — e con la correzione al punto 1,
adesso lo direbbe.
