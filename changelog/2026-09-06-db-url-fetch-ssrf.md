# Gli URL che arrivano dal database passano dalla guardia che esisteva già

Cinque punti facevano `fetch` su un URL letto da una riga del database senza controllare dove
andava, e ognuno seguiva i redirect per conto suo. La forma è la stessa chiusa nel download dei
media, ma il bersaglio consentito è diverso: lì l'insieme legittimo è **solo lo storage del
brand**, qui è **qualunque host pubblico** — la miniatura di un concorrente vive davvero su una
CDN esterna, e un'allowlist la romperebbe.

Quindi le regole restano due, e ognuna in un posto solo:

- `isOwnMediaUrl` (`chat-media.ts`) — «deve essere roba nostra». Usata dal download dei media.
- `assertPublicUrl` / `safeFetchBytes` / `safeFetchUrl` (`tool-guard.ts`) — «può essere di
  chiunque, ma non della nostra rete interna». Risolve il DNS, rifiuta loopback, reti private e
  link-local, ricontrolla **ogni salto** del redirect, e conosce gli IPv4 incapsulati in IPv6
  (`::ffff:127.0.0.1`, 6to4, NAT64) che sono il modo con cui si aggira un controllo scritto in
  fretta.

Non ho scritto niente di nuovo: `tool-guard.ts` era già la risposta giusta, semplicemente nessuno
di questi cinque ci passava.

## I punti

`fetchImagePart` (`brand-context.ts`) è il più importante: è un helper condiviso da una ventina di
chiamanti, fra cui `read-tools.ts` che gli passa **lo stesso `posts.media_url`** scrivibile
dall'utente. Il filtro `/^https?:\/\//i` che aveva davanti non è un controllo di destinazione. Il
`content-type: image/*` limitava il difetto ma non lo chiudeva: `res.ok` da solo è già un oracolo
sulla raggiungibilità della rete interna, e i byte finiscono nel contesto del modello, che poi
parla.

Stessa sostituzione per `fetchLogoPart` (`content-preview/images.ts`) e `logoDataUrl`
(`motion-video/run-turn.ts`): ognuno tiene il **suo** tetto di byte e il suo timeout, che erano
già decisioni prese e non c'era motivo di uniformare.

`brands.website` era copiato in due punti — `chat/job-executor.ts` e l'endpoint `products` — che
scaricavano la homepage senza guardia. I prodotti a valle erano già protetti da
`isUrlSafeToFetch` nel package `site-analysis`; era solo la prima richiesta a non esserlo.

## Il webhook: il controllo era nel momento sbagliato

`brand_webhooks.url` era validato alla **creazione della riga** e mai più. Fra quel momento e la
consegna può cambiare tutto: il record DNS di un nome pubblico può puntare a `127.0.0.1`, e
l'endpoint può rispondere `302` verso un indirizzo interno che `fetch` seguiva da solo, ripetendo
la POST — firmata da noi — su un bersaglio che nessuno aveva approvato.

Adesso `assertPublicUrl` gira **a ogni consegna**, dentro il `try` che già registra il fallimento,
e la POST usa `redirect: 'error'`: un endpoint che redirige non è un endpoint, è un rimbalzo.

E `validateWebhookUrl` non tiene più la propria lista di intervalli privati scritta a mano —
undici regex che duplicavano, peggio, quello che `assertPublicUrl` fa risolvendo davvero il nome.
Ora delega. Resta alla creazione perché un errore immediato nel form vale, ma non è più la
difesa: la difesa è alla consegna, dove il valore viene usato.

## Cosa ho lasciato fuori

Il `signal` di cancellazione nel `sync_products` di `job-executor`: `safeFetchUrl` ha il suo
timeout e `cancel.assertActive()` resta subito prima. Un job annullato durante quei secondi
finisce la richiesta invece di troncarla — costa una richiesta, non una riga.

Su uno stack self-hosted interamente in loopback (`http://localhost:8000`) `fetchImagePart` ora
rifiuta anche lo storage locale, perché è loopback. Non tocca nessun deployment reale — pubblico o
self-host — dove lo storage è raggiungibile pubblicamente, e le funzioni sono tutte best-effort
(tornano `null`), quindi non rompe: non legge le immagini in locale. Se un giorno servisse, la
composizione onesta è «nostro storage OPPURE pubblico», non un allentamento di `assertPublicUrl`.
