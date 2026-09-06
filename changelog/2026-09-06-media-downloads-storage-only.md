# Lo ZIP dei media scarica solo dallo storage del brand

`zipPostMedia` faceva `fetch(url)` nudo su `posts.media_url` e `posts.media_urls`, e metteva il
corpo della risposta dentro l'archivio che l'utente scarica. `media_url` è nella allowlist di
`PUT /api/v1/brands/:slug/posts/:id`, quindi la catena era chiusa senza alcun privilegio: si
scrive l'indirizzo, si chiede lo ZIP, e il server legge dalla propria rete e restituisce il
risultato impacchettato. Loopback e endpoint di metadati erano raggiungibili sia direttamente sia
attraverso un redirect — `fetch` li segue da solo, quindi un controllo sul solo URL iniziale non
avrebbe coperto la metà del difetto.

## Cosa c'era già, e perché non ho scritto una regola nuova

`isOwnMediaUrl` in `src/lib/chat-media.ts` è esattamente la regola che serve, e per la stessa
ragione: https, host ricavato da `PUBLIC_SUPABASE_URL`, percorso `/storage/v1/object/`. Esisteva
per decidere cosa la chat può incorporare; l'ho riusata invece di duplicarla, così l'eccezione
resta dichiarata in un posto solo e non diverge al primo cambiamento. L'host non è scritto a
mano: in self-host è un altro dominio, e un host cablato funzionerebbe solo da noi.

Contati in produzione i 530 valori reali fra `media_url` e `media_urls`: un host solo, prefisso
`/storage/v1/object/public` senza eccezioni. La allowlist non rompe nulla di esistente.

## I redirect: `redirect: 'error'`, non `'manual'`

Le due strade coprono entrambe il difetto. Ho scelto `'error'` perché il nostro storage non
redirige — verificato con una richiesta reale a un oggetto di produzione: `200`, zero hop — e
perché camminare la catena a mano significa riscrivere `fetchFollowingGatedRedirects` per un
caso che non esiste. `'manual'` sarebbe la scelta giusta il giorno in cui lo storage cominciasse
a rispondere `302`: allora la strada è chiamare `safeFetchBytes` di `tool-guard.ts`, che quel
cammino lo fa già e valida ogni salto.

Non ho usato `safeFetchBytes` adesso perché risolve un problema diverso: accetta qualunque host
pubblico, e qui l'insieme consentito è uno solo. Una allowlist di un elemento è più stretta di
qualunque controllo su indirizzi privati, e non si aggira con un nome DNS.

## Lo ZIP dice cosa manca

Il ciclo faceva `continue` in silenzio su ogni fetch andato male, e adesso avrebbe fatto lo
stesso su ogni URL rifiutato: un archivio con dentro meno roba del previsto, senza una parola. Un
`SKIPPED.txt` elenca ogni file lasciato fuori e il motivo, e quando non passa niente l'errore lo
dice invece del generico "No media found". Nessuna stringa nuova da tradurre e nessun tocco ai
due call site Svelte: il testo sta dentro l'archivio, dove lo legge chi lo apre.
