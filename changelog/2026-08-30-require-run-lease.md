# Il recinto del lease smette di essere facoltativo

La 0229 aveva dato un default a `p_owner`/`p_fence` di `agent_kit_close_run` per una ragione sola,
e temporanea: i deploy di questo repo non applicano le migration, quindi fra l'applicazione della
0229 e il rilascio del codice che passa il lease c'era una finestra in cui la produzione chiamava
ancora la firma a cinque argomenti. Senza default, in quella finestra ogni chiusura di turno
sarebbe fallita — cioè il momento esatto in cui la risposta viene salvata.

Quella finestra è chiusa: il deployment di produzione è `READY` e il codice che passa proprietario
e fence gira. Da qui una chiamata senza lease è un **errore**, non una chiusura senza recinto.

## L'ordine dei parametri, che non è un dettaglio

In PostgreSQL i parametri con default devono stare in fondo, quindi `p_owner`/`p_fence` passano
davanti a `p_reason`/`p_question`/`p_message`. Non tocca nessuno: supabase-js manda un oggetto e la
chiamata è per nome. Ma la firma vecchia **va eliminata nella stessa migration** — due overload che
accettano gli stessi nomi rendono ogni chiamata ambigua (`function is not unique`) e romperebbero
tutte le chiusure. È la stessa trappola della 0229, presa dal verso opposto.

## Verificata dal vivo, in due metà

Applicata alla produzione con **zero run in esecuzione** — l'unico aperto era un `waiting_input`
senza proprietario, che non è a rischio perché `claimRun` gliene assegna uno quando riprende.

- una chiusura **col** lease risolve;
- una chiusura **senza** lease non esiste più: `undefined_function`.

Una stretta che non si prova in entrambi i sensi non è una stretta: è una speranza.
