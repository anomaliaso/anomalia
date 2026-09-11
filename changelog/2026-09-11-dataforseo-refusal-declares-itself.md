# Il rifiuto di DataForSEO si dichiara: 96% di fallimenti che nessuno vedeva

`searchMetrics` in produzione: 89 chiamate su 93 fallite negli ultimi sette giorni. Non è un
campione sfortunato — settimana per settimana, da `ai_calls`:

| settimana | chiamate | fallite |
|---|---|---|
| 2026-07-27 | 15 | 0 |
| 2026-08-03 | 78 | 22 |
| 2026-08-10 | 101 | **101** |
| 2026-08-17 | 70 | **70** |
| 2026-08-24 | 130 | **130** |
| 2026-08-31 | 99 | 95 |
| 2026-09-07 | 89 | **89** |

Un solo messaggio d'errore, ripetuto 507 volte su nove endpoint diversi: `HTTP 402`.

## La causa non è nostra

Le credenziali sono valide. Chiesto conto all'endpoint gratuito `appendix/user_data`:

```
"money": { "total": 1, "balance": -0.050788 }
```

Il saldo dell'account DataForSEO (`andrea@teta.so`) è a **meno cinque centesimi**. Depositato in
tutto: un dollaro. Ogni task risponde `40200 Payment Required.` e costa zero, il che spiega perché
la cosa non è mai arrivata su una fattura. Ricaricare l'account è una decisione di prodotto, non
una riga di codice: qui si chiude solo la metà che è nostra.

## La metà che è nostra: il fallimento non arrivava a chi legge

Il difetto vero non è la chiamata rotta — è che tre forme diverse di «vuoto» erano indistinguibili
dal «rifiutato», e ognuna finiva davanti a un lettore che ne traeva la conclusione sbagliata.

**Uno.** `fetchSearchPerformance` fa due chiamate. Bastava che *una* rispondesse perché il pannello
si costruisse comunque, e tutti i numeri di testa (`organicKeywords`, `estMonthlyTraffic`,
`keywordsTop10`) vengono da `overview`: se era quella a essere rifiutata, il cliente riceveva
`0 / 0 / 0` sotto il commento «keep the zeros: "you're invisible on Google" is exactly the
diagnosis worth showing». Non era una diagnosi. Era nessuno che aveva contato. Ora senza `overview`
non c'è pannello.

**Due.** `post()` leggeva solo la busta HTTP. DataForSEO però risponde `HTTP 200` con il verdetto
vero sul task (`status_code: 40501`, `40400`, e anche `40200`): quel caso veniva loggato `ok: true`
e tornava `null`, cioè arrivava al chiamante identico a «questo dominio non ha dati». Un fallimento
che le metriche stesse non mostravano. Ora entrambe le forme rispondono in `refusalOf`, in un posto
solo.

**Tre.** I nove tool DataForSEO dell'agente rispondevano `{ gaps: [] }`, `{ keywords: [] }`,
`{ suggestions: [] }`. Il modello che scrive l'analisi SEO del cliente legge una lista vuota e
scrive «non hai keyword» — risposta sbagliata, indistinguibile da quella giusta. Ora ogni tool
passa da `declareUnavailable` e il rifiuto arriva come una frase da leggere, con dentro la
sentenza del fornitore: `Payment Required.`, non `HTTP 402`.

## Perché AsyncLocalStorage e non un throw

La strada ovvia era togliere i `catch { return null }` e lasciar propagare l'errore. Scartata: le
dieci `fetch*` hanno un contratto dichiarato in testa al file — «never throw into a request
handler» — e i chiamanti ci contano. `rank-tracker.checkKeyword` in particolare *deve* timbrare
`last_checked_at` anche quando la query fallisce, altrimenti la keyword rotta resta prima in coda
per sempre e brucia uno slot a ogni tick. Un throw lì avrebbe scambiato un difetto silenzioso con
uno rumoroso e più caro.

`AsyncLocalStorage` è già l'idioma di casa per far viaggiare un fatto lungo una catena async senza
infilarlo in dieci firme (`ai-log.ts` ne usa due). In più esprime una cosa che un throw non
esprime: la perdita **parziale**, cioè due chiamate di cui una rifiutata — che è esattamente il
caso uno. Zero firme cambiate, zero chiamanti a rischio.

Il nome del campo è `unavailable` per stare accanto a `truncated` di `query`/`read_posts`: stessa
idea, stessa forma — il risultato più la dichiarazione di cosa gli manca.

## Il test

Cinque test rossi prima della correzione, e quello che conta di più è l'ultimo:
`fetchSearchPerformance` con `overview` rifiutato e `ranked` buono tornava
`{ organicKeywords: 0, estMonthlyTraffic: 0, keywordsTop10: 0 }`. La prova che il cliente riceveva
una diagnosi costruita su una chiamata fallita. Il corpo 402 nel test è quello vero, catturato dal
fornitore l'11/09/2026, non inventato.

Poi nove test, uno per tool: nessuno dei nove può più rispondere «nessun dato» quando il dato è
stato rifiutato.

## Rimane fuori

`read_file` (111 fallimenti in 14 giorni) logga `error: null` — un fallimento registrato senza
motivo. Causa strutturalmente diversa, PR sua. `pagespeed` mescola `HTTP 400`, `500` e `network` su
numeri piccoli. `scrape` aveva 905 `HTTP 402` ma si è fermato da solo il 02/09.
