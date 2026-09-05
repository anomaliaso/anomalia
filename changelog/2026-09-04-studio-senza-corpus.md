# `get_studio` smette di spedire il corpus

## Il campo non aveva un lettore

`getStudio` selezionava `content_text` per ogni documento del brand e lo spediva. Chi lo leggeva,
tracciato uno per uno:

| consumatore | cosa legge davvero |
|---|---|
| `cli/commands/studio.ts:181` | icona, titolo, id — **non stampa nessun testo** |
| `strategy-agent-reads.ts:134` | `studio.documents.length` |
| pagina Knowledge | `studio-deferred.ts:38`, una query **sua** |
| MCP `get_studio` | l'intero corpus, senza averlo chiesto |

`cli/lib/api.ts:179` lo dichiarava nel tipo e nessuno lo rendeva. L'unico effetto reale era
riempire la finestra di un agente esterno con il corpus che dovrebbe **cercare**: il tetto per
documento è 200.000 caratteri e `DOC_LIMIT_PRO` è 300, ma bastano 30 documenti da 20 KB per
~150.000 token in una risposta sola. Un agente che riceve tutto non chiama più `search_knowledge`.

## Cosa cambia

`documents: 'index' | 'full'`, difetto `index`.

- **`index`** — niente `content_text`. Al suo posto `textBytes`, che dice che il testo c'è e
  quanto pesa, accanto a `status` e `chunkCount` che dicono se è cercabile.
- **`full`** — la risposta di prima, byte per byte.

## Perché un parametro e non la rimozione

Nessun chiamante **dentro il repo** legge quel campo, e questo l'ho verificato. Ma i terzi che
usano una chiave API contro `/api/v1/brands/:slug/studio` **non sono visibili da qui**: toglierlo
in silenzio sarebbe scommettere su una cosa che non so. Un parametro con un difetto sicuro non
scommette — chi lo leggeva aggiunge una parola e ha indietro esattamente quello che aveva.

Solo `full` apre il rubinetto: qualsiasi altro valore — inventato, vuoto, assente — è `index`.
Il registry rifiuta comunque un parametro non dichiarato (`.strict()`), quindi un client vecchio
che non manda niente riceve il nuovo difetto, che è il punto.

## Cosa è stato scartato

**Il troncamento con un rimando a `search_knowledge`.** Cinquecento caratteri di un contratto non
sono né la risposta né il sapere che bisogna cercare: si paga il costo del campo per sempre e non
si risolve niente.

## Effetto collaterale gradito

`readBrandStudioForAgent` chiama `getStudio` senza opzioni e usa solo `documents.length`: adesso
quella lettura interna smette di tirarsi dietro il corpus che non guardava.

La CLI, che ora ha `status` e `chunkCount` sul filo, dice quali documenti non sono cercabili
invece di elencarli tutti uguali.
