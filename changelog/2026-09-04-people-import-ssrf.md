# L'import della foto di una persona passa dalla guardia condivisa

`/app/onboarding/people/import` scarica la foto di un membro del team da un URL **esterno**,
scelto durante l'analisi del sito del brand: l'URL non lo digita nessuno, lo propone il crawler
sopra contenuto che non controlliamo. Aveva una copia propria della guardia SSRF — trenta righe di
espressioni regolari su `URL.hostname` — e la copia era più debole dell'originale in cinque punti.

## Cosa passava davvero

La premessa da cui è partita l'indagine era che *ogni* letterale IPv6 passasse, perché
`URL.hostname` conserva le parentesi quadre. È falsa: `isPrivateHost` le toglieva
(`replace(/^\[|\]$/g, '')`), quindi `[fc00::1]`, `[::1]` e `[fe80::1]` erano rifiutati. Il test
scritto per primo lo ha mostrato subito — quattro casi verdi su nove al primo giro. Quello che
passava è più interessante, e sono cinque cose:

1. **`http://[::ffff:127.0.0.1]/`** — `URL` normalizza l'esadecimale: `hostname` diventa
   `[::ffff:7f00:1]`. Nessun pattern lo vede: né `/^127\./` (non è più in decimale) né `/^f[cd]/`.
2. **`http://[2002:7f00:1::]/`** — 6to4, l'IPv4 sta nei due hextet centrali.
3. **`http://[64:ff9b::7f00:1]/`** — NAT64, stessa storia in coda.
4. **Un nome pubblico il cui DNS punta in casa.** `rebind.example.com → 127.0.0.1` è una stringa
   innocua: nessun confronto di nomi potrà mai vederla. Questo è il buco che conta, ed è quello
   che nessuna riga in più nella lista dei pattern avrebbe chiuso.
5. **Il corpo bufferizzato prima di essere misurato.** `await res.arrayBuffer()` porta in memoria
   *tutto* e poi confronta con `MAX_BYTES`: il tetto c'era e non serviva, perché la memoria è già
   finita quando lo si applica.

Il redirect veniva ricontrollato a ogni hop — quella parte era giusta — ma con la stessa guardia
rotta, quindi le prime quattro forme rientravano dalla finestra.

## Cosa è stato scartato

**Allungare la lista dei pattern.** Sarebbe stato il diff più corto e la riparazione più fragile:
una lista di prefissi vietati cresce una forma alla volta, e la forma nuova la si scopre dopo che
è già passata. Le tre forme IPv6 qui sopra sono esattamente questo — scoperte una dopo l'altra.
Nessuna lista di stringhe risolve il caso 4, che è quello serio.

**Scrivere una guardia nuova, o correggere quella locale.** `safeFetchBytes` in `tool-guard.ts`
esiste già, e fa le tre cose che servono: risolve l'host con `lookup(host, { all: true })` e
giudica **l'indirizzo**, ricontrolla a **ogni** hop di redirect, e applica il tetto *mentre* il
corpo scorre rifiutando invece di troncare (un JPEG tagliato è un asset corrotto salvato come se
fosse intero). Tre chiamanti ci erano già stati portati sopra — `storeBrandLogoFromUrl`,
`archiveImageToBucket`, `archiveMarketMedia`, PR #199. Questo è il quarto, con lo stesso metodo:
la guardia locale sparisce, non viene riparata.

## Cosa resta a carico di #225

I letterali IPv6 in parentesi quadre oggi vengono rifiutati dal ramo *sbagliato*: `lookup('[fc00::1]')`
risponde `ENOTFOUND` perché le parentesi non sono un nome, e la guardia risponde «Could not resolve
that host». Il rifiuto è reale — i test lo dimostrano — ma arriva da una coincidenza, non dalla
classificazione. La PR #225 (`fix/ipv6-mapped-private`) insegna a `isPrivateAddress` a leggere
l'IPv4 che un IPv6 porta dentro, e da lì in poi le stesse sei forme sono rifiutate dal ramo giusto
anche quando arrivano da un record AAAA vero, che `lookup` restituisce verbatim. Questa PR non
dipende da quella e non la anticipa: i test qui sono sull'endpoint, quindi passano prima e dopo.

## Cosa cambia per chi usa il prodotto

Niente, salvo che l'import di una foto rifiuta un indirizzo non pubblico. `http://` resta
ammesso — i siti brand vecchi servono ancora le foto del team in chiaro — e i redirect delle CDN
social continuano a essere seguiti, che era la ragione per cui la guardia manuale esisteva.
