# Il crawler risolve l'indirizzo prima di aprire il socket

`isUrlSafe` in `packages/site-analysis/src/crawl.ts` confrontava **pattern di hostname** e non
risolveva mai. Un nome pubblico il cui record DNS risponde `127.0.0.1` — o `169.254.169.254`, il
metadata service — lo superava senza storie: la stringa è innocua, è la risposta del resolver a
non esserlo. Nessuna riga in più in una lista di pattern può vedere quel caso, perché il pattern
guarda il nome e il socket va all'indirizzo.

Conta più di un difetto teorico perché il crawler apre socket verso indirizzi **che gli detta il
materiale che sta leggendo**: la pagina dice dove sono le immagini, il `302` dice dove andare, il
catalogo dice da dove leggere. E `isUrlSafe` ha ~30 punti di chiamata, parecchi dei quali ricevono
URL scelti da un modello — quindi contenuto con prompt injection può nominarle.

## Cosa è stato fatto

Il package risolve l'indirizzo alle **otto porte da cui esce davvero**, tutte già `async`:
`fetchPage` (URL iniziale e ogni hop di redirect), `loadPageHtml`, `extractColorsFromImage`,
`defaultEntryProbe`, `resolveEntryUrl`, `fetchShopifyProducts`, `fetchWooCommerceProducts`.

La guardia nuova è `isUrlSafeToFetch`: il pre-filtro di sempre, poi `lookup(host, { all: true })`
e il giudizio **sull'indirizzo**. Tre proprietà che vanno dette perché non sono ovvie:

- **Basta un solo record privato fra due** perché l'URL sia rifiutato. Un nome con un A pubblico e
  un A privato sceglierebbe altrimenti quale usare al momento della connessione, e non è una
  scelta nostra.
- **Un nome che non risolve non si dialoga.** Se il resolver non sa dov'è, non lo sappiamo nemmeno
  noi. È anche ciò che rifiuta i letterali IPv6 in parentesi quadre residui.
- **Le parentesi quadre e la zone id si tolgono prima** del confronto: `[fc00::1]` e `fe80::1%eth0`
  non sono indirizzi, ed entrambe le forme basterebbero a far mancare ogni pattern.

`node:dns/promises` è stdlib, quindi il confine di `packages/no-app-imports.test.ts` regge senza
toccare niente: il divieto è su `$lib` e `$env`, non sui builtin. Il test è nella suite mirata.

## La tabella, e le righe che mancavano

`lookup` restituisce i record **verbatim**, quindi un nome può consegnare un indirizzo in una
forma che nessuno digiterebbe a mano. La tabella dei pattern era ferma alle forme che si digitano,
e cinque passavano — provate rosse prima di essere chiuse:

| Forma | Esempio |
| --- | --- |
| CGNAT | `100.64.0.1` |
| multicast / riservati | `239.255.255.250` |
| IPv4-compatible | `::169.254.169.254` |
| 6to4 | `2002:7f00:1::` |
| NAT64 | `64:ff9b::7f00:1` |

Le due tabelle IPv4/IPv6 sono ora **una sola** funzione, `isPrivateAddress`, usata sia sul nome
(quando è già un indirizzo scritto per esteso) sia su ciò che il resolver risponde: la riga nuova
vale per entrambi i casi il giorno che si aggiunge, e nessuno dei due può restare indietro.

6to4 e NAT64 sono rifiutati **in blocco**, per prefisso, invece di estrarne l'IPv4 e rimandarlo
alle regole IPv4: sono due righe contro venticinque, e il relay 6to4 è tecnologia morta. Estrarre
l'IPv4 embedded è quello che fa `isPrivateAddress` in `tool-guard.ts` con la PR #225 — vedi sotto
perché non è stato copiato qui.

## Cosa è stato scartato

**Rendere `isUrlSafe` `async` e migrare tutti e ~30 i chiamanti.** È la riparazione che il
committente aveva suggerito, ed è quella che chiude tutto insieme. Non è stata fatta, per una
ragione che non è la pigrizia: `if (!isUrlSafe(u))` con un `await` dimenticato valuta una
**Promise, che è truthy** — la guardia diventa un no-op silenzioso, in un punto di sicurezza,
senza che niente diventi rosso. Fra i chiamanti ce ne sono dentro `.filter()` e `.some()` sincroni
(`design-visual-refs`, `create-content-tools` ×3, `post-editor-tools`) e dentro funzioni sincrone
che a loro volta cascano (`demo-account.normalizeHttpUrl`): trenta conversioni, in tredici file,
in una PR che nessuno riesce a rivedere davvero. Il rapporto rischio/beneficio è pessimo.

**Spostare `isPrivateAddress` di `tool-guard.ts` dentro il package** (app → package è la direzione
lecita, e sarebbe l'unico modo di avere un classificatore solo). La PR #225 sta riscrivendo
esattamente quella funzione in questo momento: spostarla adesso trasforma uno dei due merge in una
risoluzione manuale di conflitti su codice di sicurezza. Si fa dopo, quando #225 è dentro.

**Allungare la lista dei pattern e basta.** È il diff più corto e non chiude il caso che conta: il
nome pubblico che risolve in casa.

## Cosa resta scoperto, esplicitamente

1. **I ~30 chiamanti applicativi di `isUrlSafe` continuano a confrontare nomi.** La maggior parte
   filtra URL da consegnare a un generatore di immagini di terze parti (fal, kie) — lì il socket
   lo apre il fornitore, dalla sua rete, e risolvere qui non prova niente su cosa dialogherà lui.
   Ma quattro lo aprono davvero da noi e vanno migrati: `brand-analysis.fetchImageInlinePart`,
   `design-render.toDataUri`, `youtube-thumbnail`, `prepublish-check.probeMediaUrl`. La strada per
   quelli non è `isUrlSafeToFetch`: è `safeFetchBytes` di `tool-guard.ts`, che oltre a risolvere
   ricontrolla ogni hop e applica il tetto di byte mentre il corpo scorre. Due (`studio-actions`,
   `catalog-tools`) ci passano già a valle e sono di fatto coperti.
2. **Due classificatori di indirizzi convivono**: questo e quello di `tool-guard.ts`. Convivevano
   già; questa PR non peggiora la situazione ma non la risolve. L'unificazione è il seguito
   naturale di #225.
3. **`website-capture` passa l'URL a Browserless**, che lo scarica dalla sua rete. È una minaccia
   diversa e non la tocca né questa guardia né l'altra.

## Effetti collaterali da sapere

Ogni pagina scaricata costa ora una `dns.lookup` in più. La risoluzione la fa `getaddrinfo` sul
thread pool (default 4 thread), e il sistema operativo tiene la cache: un'analisi che legge la
homepage più sei pagine interne dello stesso dominio fa una risoluzione vera e sei dalla cache.

I test esistenti di `crawl.test.ts` chiamavano `loadPageHtml('https://example.com')` con `fetch`
finto ma DNS vero: dopo questa modifica sarebbero diventati dipendenti dalla rete. Il resolver è
ora finto anche lì, con una risposta pubblica fissa — quei test provano cosa fa il crawler con la
risposta, non il resolver, e restano gli stessi con o senza rete.
