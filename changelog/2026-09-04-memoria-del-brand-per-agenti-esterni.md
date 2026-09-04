# La memoria del brand esce da MCP, e il decadimento smette di punire chi non segnala

## Cosa mancava

`brand_memory` tiene quello che il brand sa: la voce, i vincoli, i fatti confermati, le preferenze
dichiarate, le osservazioni del lavoro passato. La rotta `/studio/memory` esiste dal principio ma
**non è mai stata nel registry**, quindi via MCP non c'era nessun tool: un agente esterno
ricostruiva a ogni conversazione cose che il prodotto già sapeva, e chiedeva all'operatore risposte
che l'operatore aveva già dato.

La categoria `skill` era l'unica servita, dalla PR delle skill di scrittura. Il resto no.

## Tre tool, non cinque

- **`get_memory`** — la memoria del brand, con `category` e `limit` (50 di difetto, 200 al massimo).
- **`save_memory`** — deposita quello che un agente ha imparato.
- **`record_memory_used`** — dice quali voci hanno davvero plasmato il risultato.

`promoteMemoryToProject`, `updateMemoryEntry` e `deleteMemory` restano dentro finché qualcosa non
li chiede davvero.

## Una rotta nuova, non `/studio/memory` irrigidita

`/studio/memory` è la superficie dell'**operatore**: `BrandMemoryPanel.svelte` ci scrive la
categoria che la persona sceglie, `voice` e `constraint` comprese, ed è giusto così. La superficie
dell'**agente** ha regole diverse, e regole diverse sulla stessa rotta sarebbero un `if`
sull'identità di chi chiama — la condizione sparsa che poi diverge. Due rotte, due pubblici, due
regole, ciascuna scritta in un posto solo; la logica condivisa (`loadMemoryEntries`, `writeMemory`,
`detectConflict`, `recordMemoryUsage`) è già estratta e non viene duplicata.

## Il `GET` resta puro, e non è un cavillo

Dentro, leggere e usare collassano: il turno inietta ciò che carica, quindi `read_memory` chiama
`recordMemoryUsage`. Fuori no — un agente elenca quaranta voci e ne usa due. Contarle tutte alla
lettura darebbe un dato **peggiore** di quello interno, e sarebbe un `GET` con effetto collaterale,
la stessa forma di `ensureReferralCode` che qui consideriamo un difetto.

Quindi la segnalazione è una scrittura esplicita, e il dato che produce è più fine: non «l'ho
caricata» ma «l'ho usata». Gli id si filtrano per brand **prima** di contarli — un id estraneo
terrebbe viva la memoria del vicino, e la risposta non lascia nemmeno capire che quell'id esista.

## La difesa che non dipende dall'adozione

Il rischio della segnalazione esplicita è asimmetrico e silenzioso: se nessuno chiama
`record_memory_used`, le voci decadono come inutilizzate, scendono sotto il pavimento di iniezione
e smettono di raggiungere i prompt. Quando te ne accorgi, il danno è già nei dati.

Una riga nella descrizione non basta. Quindi in `runDreamInner`:

```
const usageIsReported = (entries ?? []).some((entry) => !!entry.last_used_at);
```

**Se in questo brand nessuna riga è MAI stata segnalata, il decadimento sull'inutilizzo non parte.**
Un'assenza totale di dati non è un dato: l'ipotesi giusta non è «non le usa nessuno» ma «nessuno
sta segnalando». Appena una voce qualsiasi porta un segnale, il segnale è vivo e il decadimento
riprende per tutte.

Zero query in più — le righe sono già caricate. Nessuna migrazione. Il criterio è per brand e non
per riga di proposito: una riga mai usata mentre le altre lo sono **è** prova di inutilizzo (ha
perso la selezione sul budget di 800 token), e va trattata come oggi.

L'archiviazione non cambia: aveva già lo scudo `times_used > 0`, e una scadenza esplicita
(`expires_at`) vale comunque — l'ha decisa chi ha scritto la riga.

## La tabella delle scritture, e la riga che manca

| categoria | scrivibile da un agente | perché |
|---|---|---|
| `insight`, `preference` | sì | quello che impara lavorando, raggio d'azione corto |
| `skill` | sì, col tetto di 20 già applicato in `brand-memory.ts:411` | le procedure sono il senso del magazzino |
| `fact` | sì, ma `source: 'chat'` e confidenza 0.7 | un fatto sbagliato si propaga in ogni prompt |
| `voice`, `constraint` | **no** | governano tutto ciò che sta a valle: un modello che riscrive la voce è un cambio di marca in una chiamata |

## L'ultimo arrivato non vince

Un valore che contraddice quello che c'è risponde **409 con entrambi i valori e non scrive niente**:
l'agente se la discute con l'operatore, non vince per essere arrivato ultimo. Lo stesso valore
ripetuto resta un rinforzo, non un conflitto — `detectConflict` lo distingueva già.

## L'isolamento fra brand

Tre filtri, tutti con un test che li guarda cadere: la memoria di un altro brand non esce nemmeno
con la stessa chiave; la chiacchiera di sessione resta nel suo thread; le note di mestiere di un
altro agente non sono conoscenza del brand ma rumore, e `scopeToAgent(query, null)` le esclude.
