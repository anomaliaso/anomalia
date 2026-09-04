# «Costo ignoto» non vuol più dire «gratis»

`ai_calls.cost_usd` a `null` significava DUE cose incompatibili: *«esente, non addebitare»* e
*«non siamo riusciti a prezzarla»*. `credits.ts` somma solo le righe non nulle, quindi il secondo
significato non era prudente — era **gratis, in silenzio**.

Non è un ragionamento: è misurato in produzione prima di scrivere una riga di codice.

| | 30 giorni | ultimi 7 |
|---|---|---|
| chiamate RIUSCITE, con brand, prezzate a zero | **62** | 33 |
| token fatturati a nessuno | **6.099.353** | 3.722.174 |

Il 53% del totale di 30 giorni è caduto negli ultimi 7. Non è un residuo storico: è un buco che si
allargava.

Il caso che da solo giustifica il lavoro: `llm/deepseek/deepseek-v4-flash-vision-exp`, 1,72M token
a costo zero — ed è **in `chat_model_catalog`**, cioè un modello che l'utente può scegliere dal
menu e che nessuna tariffa scritta a mano copriva. È esattamente l'argomento della testata di
`llm-usage-cost.ts`: *«un listino a mano non regge un catalogo che sceglie l'utente»*.

## I due significati diventano due valori

- `0` → esente per costruzione. Le righe `internal` sono eventi dell'agente (`read_file`, `grep`,
  `glob`, `ls`, `db_query`), non chiamate a un modello: nessuno ce le fattura. Zero è un **fatto**.
- `null` → non siamo riusciti a prezzarla, e basta.

Da cui l'invariante che rende il buco **interrogabile** invece che invisibile:

    ok = true and cost_usd is null  ==>  guasto di prezzatura, sempre

Prima quella query restituiva un miscuglio di eventi interni e guasti veri, quindi non la si poteva
usare per niente.

## Perché non un sentinella, e perché non una colonna

Un `-1` avrebbe rotto **in silenzio** `sum_brand_ai_cost_usd` e `sum_org_ai_cost_usd`, che fanno
`coalesce(sum(cost_usd), 0)`: i totali dei crediti sarebbero scesi senza che niente fallisse. Una
colonna nuova avrebbe voluto dire una migrazione **più** ogni lettore che impara un secondo campo,
in un repo dove i deploy non eseguono migrazioni.

Zero non sposta una somma. Nessun totale di crediti cambia, sugli stessi dati.

## I fallimenti restano `null`, di proposito

Il primo disegno portava a `0` anche le chiamate fallite. Sbagliato per due motivi: `ok = false`
le disambigua **già** senza aiuto, e portarle a zero le avrebbe rese visibili al tetto orario della
chat — che oggi scarta le righe nulle — cioè avrebbe fatto **pagare all'utente i turni andati
storti**. Meno righe toccate e nessun cambio di comportamento accidentale.

## Ogni lettore di `cost_usd`, verificato riga per riga

È un percorso che tocca quanto paghiamo noi e i crediti che pagano i clienti, quindi non è stato
dato per buono nessun elenco:

- `sum_brand_ai_cost_usd`, `sum_org_ai_cost_usd` — sommano. Zero è neutro.
- `chat/rate-limits.ts` — **somma** (`creditsFromRows` è un reduce, non un conteggio di righe) e in
  più `resumeAtForWindow` scarta esplicitamente `credits > 0`. Doppiamente al sicuro.
- `motion-video/unfinished.ts` — somma.
- `api/v1/health/costs/tick` — somma con `c > 0`. Tiene anche un conteggio di righe, ma finisce
  solo nel **testo** dell'avviso, mai nella soglia che lo fa scattare.
- l'indice parziale di `0164` (`where cost_usd is not null`) — cresce di poche righe.

E le righe `internal` non portano **mai** un'etichetta di chat: le loro cinque etichette sono
`db_query, glob, grep, ls, read_file`, verificato in produzione. Il filtro `label in ('chat',
'chatCompact')` del limitatore non le può vedere in nessun caso.

## Le 65 chat che oggi non costano niente

Query collaterale, da tenere d'occhio: 65 turni di chat **riusciti** con `cost_usd` nullo (28
openrouter, 21 llm, 16 kie). Oggi non costano né crediti né tetto orario. Con questo cambio non
diventano gratis di meno — diventano **trovabili**, che è il primo passo per prezzarle.

## Il seguito

Questo è il pavimento sotto lo svuotamento di `RATES`: quando i trasporti riportano il costo
(`usage.cost` su OpenRouter, `credits_consumed` su kie), una tariffa scritta a mano si toglie e
quello che resta senza prezzo si **vede**, invece di sparire in un `null` che sembrava innocuo.

Nota per chi applica: il backfill delle 722 righe `internal` storiche è una scrittura su
produzione e **non** è in questo commit. Il codice qui riguarda le righe NUOVE; le vecchie restano
nulle finché qualcuno non esegue l'update, e fino ad allora la query dell'invariante va letta con
`created_at` maggiore della data di deploy.
