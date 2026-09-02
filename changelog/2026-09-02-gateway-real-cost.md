# Il turno lo prezza chi ce lo fattura

`computeCostUsd` prezzava per token con `RATES`: una tabella scritta a mano, un modello per riga.
Un modello che non c'è non vale «prudentemente null», vale **zero crediti**. Contato sul database:

| modello loggato | righe | con costo |
|---|---|---|
| `z-ai/glm-5.3-flash` | 181 | 175 |
| `llm/z-ai/glm-5.3-flash` | 54 | **0** |
| `google/gemini-3.7-flash` | 30 | **0** |
| `deepseek/deepseek-v4-flash-vision-exp` (il default di oggi) | 7 | **0** |

Cioè: il modello su cui gira la chat non ha mai toccato i crediti, e la stessa riga cambiava
prezzo a seconda di quale strada l'avesse scritta.

## Tre cose, in ordine di quanto sono profonde

**Il prefisso.** `llm/z-ai/glm-5.3-flash` e `z-ai/glm-5.3-flash` sono lo stesso modello: il
prefisso lo mette il bridge dell'harness (`adapters.ts`), la normalizzazione ne toglieva uno solo
(`openrouter/`). Una riga di regex, 54 righe di log che tornano a costare.

**La fattura vera, dove possiamo leggerla.** OpenRouter allega `usage.cost` alla risposta se glielo
si chiede (`usage: {include: true}`), streaming compreso, nell'ultimo chunk. `llmClient` lo chiede
e legge il costo da una **copia** della risposta (`res.clone()`), così l'originale continua a
scorrere verso l'utente alla sua velocità. Il costo si somma in una cassetta di scope — la stessa
idea dei crediti kie — e `logAiCall` la ritira: un turno di chat è N chiamate e la riga aggregata
le comprende tutte.

Scartato: `GET /generation?id=` con l'`x-generation-id` dell'header. Funziona, ed è stato scritto,
ma **misurato**: il record compare 9 secondi dopo la risposta. Tenere viva una funzione serverless
ad aspettarlo significa perdere anche la riga di log.

**Il listino, dove NON possiamo leggerla.** Il turno di chat passa dall'harness pi, che ha un suo
client HTTP: `usage.cost` non lo vediamo. Lì il prezzo arriva da `/models` di OpenRouter —
prompt e completion per token, più il tier di cache — caricato una volta per processo e tenuto sei
ore. È lo stesso modulo che servirà al selettore di modello: un modello nuovo non va aggiunto in
due posti, perché non va aggiunto in nessuno.

## Ordine di precedenza, e perché

`flatCostUsd` (fattura del gateway) → `RATES` (scritte a mano) → listino live → null. Le RATES
restano davanti al listino di proposito: contengono correzioni volute che un listino non ha —
alias storici che riprezzano righe vecchie alla tariffa su cui girarono davvero, e la nota che
DeepSeek raddoppia in fascia oraria.

`usage: {include: true}` si aggiunge **solo** verso `openrouter.ai`: su un altro gateway
OpenAI-compatibile un campo sconosciuto nel corpo è un 400 su ogni chiamata.

## Verificato sullo stack locale, non dedotto

Stessa chiamata, prima e dopo, su `deepseek/deepseek-v4-flash-vision-exp`:

```
08:37:56 | createSingleContent | (nessun costo)     ← prima
08:42:06 | createSingleContent | $0.003759          ← dopo, via usage.cost
08:43:48 | chat (harness)      | (nessun costo)     ← prima
08:46:16 | chat (harness)      | $0.008869          ← dopo, via listino live
```
