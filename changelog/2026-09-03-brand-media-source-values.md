# `brand_media.source`: due valori che il database rifiutava da sempre

`brand_media_source_check` ammette otto valori:

```
'upload','chat_drop','shoot','generate','remotion_export','post_render','website_capture','agent'
```

Due punti del codice ne scrivevano altri due:

- `saveRenderedVideoToLibrary` scriveva `'ai'`;
- il `save_to_library` della sandbox scriveva `'sandbox'`.

Nessuno dei due è mai entrato in `brand_media`. Ogni insert prendeva 23514.

## Cosa costava

`saveRenderedVideoToLibrary` esiste per un motivo solo, e lo dice la sua stessa docstring: senza
quel passo «un video generato e' un file pagato che nessun tool sa raggiungere». Il render veniva
pagato, l'mp4 caricato su storage, e poi la riga in libreria veniva rifiutata — rimettendo la clip
esattamente nel vicolo cieco che la funzione era stata scritta per chiudere. La funzione è
deliberatamente best-effort (giusto: non si fa fallire un render già pagato per un INSERT), quindi
l'errore tornava al chiamante come `library_error` e finiva nel risultato del tool, letto
dall'agente e da nessun altro. Nei log del server: niente.

Stessa storia per la sandbox: un'immagine prodotta nella VM dell'agente e mai depositata.

## Perché nessun test l'ha preso

La suite (6394 test) mocka Supabase. Un insert finto accetta qualunque stringa: `source: 'ai'`
passava verde in ogni test che toccasse quel percorso. Il vincolo vive nel database, il valore vive
nel codice, e fra i due non c'era niente che li confrontasse. Anche
`scripts/schema-drift-check.mjs` ha già un confronto «literal contro CHECK» (sezione C), ma sa
leggere solo le catene `.from('x').insert({...})` scritte in chiaro: `insertBrandMedia(supabase,
{ source: 'ai' })` è una chiamata a un helper, e gli passava sotto.

## La scelta: mappare, non allargare

Due strade. Allargare il vincolo con una migration sarebbe stata la quattordicesima cosa che
qualcuno deve ricordarsi di applicare a mano — i deploy di questo repo non eseguono le migration —
e fino ad allora il codice sarebbe rimasto rotto in produzione. Non serviva: entrambi i valori
hanno già un sinonimo esatto nel vincolo.

- `'ai'` → **`'generate'`**. È il valore che il vincolo ha da sempre per «l'abbiamo generato noi».
  Prima di questo fix non lo scriveva nessuno: la provenienza esisteva nello schema e non nel
  codice.
- `'sandbox'` → **`'agent'`**. È il valore che la 0220 ha aggiunto descrivendo *esattamente* questo
  caso: «l'agente che carica un file dalla propria VM nella galleria del brand». Lo scrive già
  `bridge/attach.ts`, che fa la stessa cosa dallo stesso posto.

Zero migration. Funziona in produzione appena il codice ci arriva.

## Il fix durevole

`BRAND_MEDIA_SOURCES` è ora una costante esportata accanto al modello che governa quella colonna, e
`InsertBrandMediaInput.source` è tipato su di essa: un valore inventato non compila più.
`brand-media.source.test.ts` chiude il cerchio con tre asserzioni:

1. la costante è **identica** all'array dell'ultima migration che ridefinisce
   `brand_media_source_check` — costante e vincolo non possono più divergere;
2. ogni `source: '...'` scritto nell'oggetto di un `insertBrandMedia(...)` o di un
   `.from('brand_media').insert(...)` in tutto `src/` è nella costante;
3. un `@ts-expect-error` su `const rejected: BrandMediaSource = 'ai'` — se il tipo smettesse di
   mordere, `npm run check` fallirebbe per l'errore che non c'è più.

Il secondo è il test che avrebbe preso il difetto: non asserisce che un insert *finto* è riuscito,
asserisce che il valore è nell'insieme che il database ammette. Ha un guardiano contro il passaggio
a vuoto (`written.length > 3`): una scansione che non trova più niente fallisce invece di passare.
Oggi trova quattro punti — `attach.ts` `'agent'`, `sandbox-tools.ts` `'agent'`, `brand-media.ts`
`'generate'`, `website-capture.ts` `'website_capture'` — più il default `'upload'`, che ora passa da
una variabile tipata invece che da un literal dentro l'oggetto.

Verifica finale sul Postgres locale, in transazione e rollback: `upload`, `generate`, `agent`,
`website_capture` accettati; `ai` e `sandbox` rifiutati con 23514. `catalog_status` era già a posto
(`pending`/`ready`/`failed`, tutti scritti, tutti ammessi).

## E il silenzio

`saveRenderedVideoToLibrary` resta best-effort — il ragionamento della docstring è giusto, un render
pagato non si fa morire per un INSERT — ma ora il fallimento passa da `swallow()`, quindi
console.error più Sentry. I due chiamanti (`job-executor` `generate_video` e `create-content-tools`)
già restituivano `library_error` all'agente; quello che mancava era che lo sapesse anche chi gestisce
il prodotto.

`bridge/attach.ts` era il punto più buio di tutti: la sua insert in `brand_media` finiva in
`.then(() => {}, () => {})`. Peggio del previsto — supabase-js **risolve** con `{ error }` su un
23514, non rigetta, quindi quel gestore di rigetto non avrebbe visto il vincolo nemmeno volendo: era
gestione d'errore che non poteva funzionare. Ora l'errore risolto viene letto e stampato.

Lì il log NON passa da `swallow()`, e non per distrazione: `src/lib/agent/bridge/` non ha **un solo**
import di `$lib`, statico o dinamico, in nessuno dei suoi file — tutto arriva dai `deps`. Il primo
`import { swallow } from '$lib/server/swallow'` sarebbe stato un buco nel confine (e avrebbe tirato
`@sentry/sveltekit` dentro il grafo di `live.test.ts`, 372 s di test, per una riga di log). La
convenzione che il bridge usa già è `console.error('[AGENT_KIT] …')`, ed è quella che si segue.
