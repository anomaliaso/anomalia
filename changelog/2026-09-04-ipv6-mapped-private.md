# `isPrivateAddress` leggeva il prefisso IPv6 e non l'IPv4 che ci stava dentro

La guardia SSRF di `tool-guard.ts` — `assertPublicUrl`, e quindi `safeFetchUrl` e
`fetchFollowingGatedRedirects` — risolve l'host e rifiuta gli indirizzi che non stanno
sull'internet pubblica. Il classificatore che decide *cosa* è privato aveva un buco suo.

## Il difetto

`isPrivateAddress` trattava un IPv6 solo per come comincia: `::1`, `fc00::/7`, `fe80::/10`. Ma un
IPv6 sa **portarsi dentro** un IPv4, e l'indirizzo che il kernel chiama alla fine è quello dentro,
non il prefisso davanti:

| Forma | Cosa contiene | Prima |
|---|---|---|
| `::ffff:127.0.0.1` | loopback, mappato | `false` |
| `::ffff:169.254.169.254` | metadata service, mappato | `false` |
| `::ffff:10.0.0.1` | rete privata, mappata | `false` |
| `2002:7f00:1::` | loopback via 6to4 | `false` |
| `64:ff9b::7f00:1` | loopback via NAT64 | `false` |

`assertPublicUrl` chiama `lookup(host, { all: true })`, che restituisce i record **AAAA così come
sono**. Un nome pubblico con un AAAA di `::ffff:127.0.0.1` passava la guardia e apriva la
connessione sul loopback. La forma con le parentesi (`https://[::ffff:127.0.0.1]/`) era già
rifiutata, ma **per caso**: `URL.hostname` tiene le parentesi, la risoluzione fallisce, e a
rispondere è il ramo «could not resolve». Un domani che qualcuno normalizzasse l'hostname, la
guardia si sarebbe aperta in silenzio — quindi la proprietà ora sta in un test, indipendente dal
meccanismo che oggi la produce.

Nessuno ha dimostrato un bypass vivo end-to-end: non è stato trovato un DNS wildcard pubblico che
serva quei record AAAA. Il buco nel classificatore è verificato; lo sfruttamento resta non provato.
Non cambia cosa fare: un classificatore che sbaglia è da riparare prima che qualcuno trovi il
record, non dopo.

## Perché era raggiungibile

Chi passa da questa guardia oggi su `dev` prende l'URL da uno **sconosciuto** o da un **modello**,
che è la differenza fra un difetto teorico e uno raggiungibile:

- `/start/preview` — l'anteprima pre-login, aperta a chiunque sia su internet;
- i nove tool gratuiti sotto `/api/tools/*`, via `safeFetchUrl` — stesso ingresso, nessuna sessione;
- `traceRedirects`, che il redirect-checker cammina hop per hop;
- i tre archiviatori che scaricano un URL remoto e lo depositano — il logo del brand scelto da un
  tool della chat, l'archivio immagini, l'archivio dei media di mercato — portati su questa stessa
  guardia dalla #209, dentro la #199, ora su `dev`;
- `importBrandMediaFromUrl`, l'import media di un agente esterno.

Il classificatore è l'unico pezzo che nessuna di quelle PR ha toccato: quelle hanno spostato i
chiamanti sulla guardia giusta, questa ripara la guardia.

## La riparazione

L'IPv4 incapsulato viene estratto e **rimandato alle regole IPv4**, che sono già quelle giuste.
Non una lista di prefissi vietati in più — una lista si allunga a ogni forma nuova e la forma nuova
la scopri quando ti è già passata davanti:

- **mappato e compatible** — `::ffff:x.x.x.x`, `::ffff:7f00:1`, `::x.x.x.x`;
- **6to4** — `2002:<v4>::`, dove l'IPv4 sta nei due hextet dopo il prefisso;
- **NAT64** — `64:ff9b::<v4>`, nella forma con i punti e in quella esadecimale.

Serviva espandere il `::` per leggere gli hextet per posizione: `::ffff:7f00:1` e
`0:0:0:0:0:ffff:7f00:1` sono lo stesso indirizzo, e una regex sul prefisso ne vede uno solo.

Un IPv4 **pubblico** incapsulato resta pubblico (`::ffff:8.8.8.8` → `false`): la regola applicata
è quella dell'IPv4, non un divieto sul prefisso. E le forme degeneri falliscono chiuse —
`2002::`, `64:ff9b::` e `::ffff:0:0` contengono `0.0.0.0`, che è già privato.

Aggiunto anche lo strip della zone id (`fe80::1%eth0`), che il resolver può restituire.

## Cosa dice il changelog pubblico

Una riga sola: un link che il cliente porta dentro — un'immagine importata, un sito analizzato —
viene controllato sull'indirizzo su cui il nome risolve, in IPv6 come già in IPv4. Non nomina quali
forme venivano lette male: è un dettaglio utile solo a chi lo volesse usare. L'entry del 2026-09-03
aveva già promesso la stessa cosa per i chiamanti; questa la rende vera anche in IPv6.
