# La bolla viva è una sola, e non si rimonta più

Il sintomo era vecchio: la pagina chat «ogni tanto si riaggiorna e perde lo stream, riprendendolo
subito dopo», intanto saltando su e giù. Sette PR di durabilità — event log con `seq` monotono,
cursore, lease con fence, parziale al primo render, poll una volta per tick — hanno reso durevoli
i **dati** e non lo hanno tolto. Non lo toglievano perché il difetto non era nei dati.

La bolla viva stava in **due blocchi `{#if}` mutuamente esclusivi**, uno per il run orfano e uno
per lo stream della sessione, ciascuno con il proprio `<ChatLiveStatus>` dentro il proprio
wrapper. Passare dall'uno all'altro non cambia delle prop: smonta un componente e ne monta un
altro. Il salto della pagina era quel rimontaggio.

E il passaggio non è raro, è la norma. `chat-session.ts` dismette di proposito la sessione su
qualunque disconnessione benigna di un turno kit che abbia già ricevuto stream — il commento lo
dichiara — e il poll riaggancia il run entro `LIVE_POLL_MS`. Da quando il Kit serve la chat
utente, quel percorso è quello di tutti i giorni. I turni con `jobId` non ce l'hanno: lì la stessa
disconnessione lascia `loading: true` e basta.

Ora la scelta della sorgente — sessione o run orfano — si fa **in un posto solo**, un `$derived`,
e il componente montato è uno. Il dismiss resta dov'era, il poll riaggancia come prima, ma il DOM
non si ricostruisce.

Scartato: **togliere il `sessions.delete` sui turni kit**. Quel dismiss è deliberato e il commento
racconta cosa succedeva prima: `markSessionError` piegava il parziale in una bolla assistant e il
poll faceva ricrescere lo stesso testo accanto — doppione, con una barra rossa su un turno vivo.
Rimuoverlo riapre quel difetto per chiuderne un altro.

Scartato: **ripetere `showLivePartial ? … : …` su ogni prop**. Sei condizioni identiche in sei
punti sono un registro non scritto: alla prima prop nuova una delle sei si dimentica.
