# Leggere il sito, o dirlo — mai fingere di averlo letto

## Due sintomi opposti, una domanda mai posta

**illy.com.** L'onboarding ha creato un brand con categoria `Error page / inaccessible site`,
pubblico *«amministratori di siti che risolvono problemi CloudFront»* e pilastri
`["Error troubleshooting", "CloudFront documentation"]`. Il Brand Kit lo mostrava come
normale, al 50%. Il sito di illy funziona: `curl` restituisce 820 KB.

**ginshop.it.** L'onboarding ha risposto `Could not fetch URL`. Il sito esiste: quel dominio
rimanda a `ilgin.it`, un portale vivo dal 2015.

Sono lo stesso difetto visto dai due lati. La pipeline non sapeva rispondere a una domanda che
non si poneva da nessuna parte: **quello che ho in mano è davvero il sito di questa persona?**
Con illy inventava, con ginshop negava.

## Perché illy

`loadPageHtml` preferisce il render via Browserless quando è configurato. Browserless esce da IP
di datacenter e la CDN di illy li rifiuta: torna la pagina di blocco di CloudFront, non il sito.

L'unico controllo a valle era `renderedLen >= MIN_VISIBLE_TEXT_LENGTH`, con la soglia a 100
caratteri. La pagina di blocco ne ha **553**: passava larga. E siccome passava, `return rendered`
usciva subito — **la lettura diretta, che su illy funziona, non veniva nemmeno tentata.**

Quella soglia esiste per riconoscere le pagine quasi vuote, cioè le SPA che si idratano dopo.
Sa distinguere *poco testo* da *tanto testo*. Non sa distinguere *testo giusto* da *testo
sbagliato*, e nessun altro punto del file lo faceva: un `grep` per `403`, `CloudFront`,
`Access Denied` o `status >= 400` su `brand-analysis.ts` non trovava niente.

## Perché ginshop

`analyze/+server.ts` antepone `https://` a quello che l'utente scrive. `https://ginshop.it`
fallisce la verifica del certificato — che copre `ilgin.it`, non `ginshop.it` — e non esisteva
una seconda strada. Ma `http://ginshop.it` fa `301` verso `https://ilgin.it` e funziona
perfettamente: la destinazione risale subito a TLS.

È una forma comunissima: dominio vecchio, dominio parcheggiato, dominio comprato a difesa del
marchio. Con ogni probabilità una fetta dei `Could not fetch URL` in telemetria, che erano su
domini di utenti veri.

## Cosa si è deciso

**Le firme delle pagine di blocco stanno in una tabella sola** (`BLOCK_PAGE_SIGNATURES`),
accanto alla funzione che le usa: CloudFront, Cloudflare (blocco e sfida JS), Akamai, Imperva,
più i `<title>` di errore nudi. La prossima CDN è una riga. Sparse in tre `if` sarebbero
divergute al primo cambiamento, e in silenzio.

**Il discriminante contro i falsi positivi è la lunghezza, non la lista.** Una pagina di blocco
è corta per costruzione; una homepage vera che nomina «access denied» nel proprio testo non lo
è. Sopra 2000 caratteri di testo visibile nessuna firma viene nemmeno provata. Senza questo, un
manuale di sicurezza verrebbe scambiato per un blocco.

**Riconosciuto il blocco, si ritenta in diretta** — che è esattamente il caso in cui la CDN
lascia passare, perché il rifiuto è sull'IP del renderer. Se anche la diretta è bloccata si
restituisce stringa vuota, e chi chiama solleva il suo errore onesto: meglio dire *non ci sono
riuscito* che consegnare un brand inventato.

**Sul certificato si chiede a http dove rimanda, e si accetta solo se risale a https.** Se la
destinazione resta in chiaro l'indirizzo torna quello di partenza e l'analisi fallisce
onestamente: analizzare in chiaro un sito che l'utente crede protetto è una decisione sua, non
nostra. Il tentativo parte **solo** su errore di certificato (`TLS_ERROR_CODES`), mai su 404 o
timeout, così un sito che davvero non c'è non paga una richiesta in più.

**Scartato**: disabilitare la verifica del certificato. Chiudeva il sintomo aprendo un buco vero.

**Scartato**: fidarsi dello status HTTP del renderer. Browserless restituisce il contenuto, non
lo status: la firma della pagina è l'unico segnale che arriva davvero fin qui.

## Nel profilo finisce il sito che abbiamo letto

`runBrandAnalysis` risolve l'indirizzo prima di tutto il resto, e da lì in poi ci lavora sopra.
Su ginshop il profilo riporta ora `https://ilgin.it/` invece di `https://ginshop.it`: il brand
non si porta più dietro un indirizzo che non risponde.

## Verificato contro i siti veri

| Sito | Prima | Dopo |
| --- | --- | --- |
| `https://www.illy.com` | `Error page / inaccessible site` | `illy — Caffè e macchine da caffè premium`, Trieste, cialde E.S.E., capsule Iperespresso, illy Art Collection |
| `https://ginshop.it` | `Could not fetch URL` | `ilGin.it — portale dedicato alla cultura del gin`, pubblicato da That's The Spirit SRL, 8 pilastri |
