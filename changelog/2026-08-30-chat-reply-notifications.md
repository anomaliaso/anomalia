# Avvisi per le risposte nelle altre chat

Prima una risposta dell'agente aggiornava solo la chat aperta e il pallino della
sidebar. Se l'utente lavorava in un'altra pagina, non aveva un modo immediato
per sapere quale conversazione era cambiata.

Ora il guscio dell'app ascolta lo stesso evento reale che salva la risposta,
ignora i messaggi dell'utente e la chat attiva, mostra una notifica per ogni
thread non letto e la rimuove quando il thread viene aperto. Il conteggio resta
quello persistito dal server, quindi refresh e riconnessione riallineano lo
stato invece di inventare dati nel browser.

La notifica è un unico avviso per thread, in alto a destra su desktop e a tutta
larghezza in alto su mobile. Il clic apre il thread corretto e registra la
lettura sul server.

Sullo stack self-hosted il canale Realtime non consegnava nulla: `kong.yml`
puntava al vecchio hostname del tenant Supabase (`realtime-dev.supabase-realtime`,
mai esistito su questo compose, i container sono `anomalia-*`), e la migration
`0137` che apre `realtime.messages` in RLS è un `do $$ if to_regclass(...) is not
null then ... end if$$`: su un DB dove Realtime non ha ancora creato il proprio
schema, il blocco non fa nulla ma la migration viene comunque segnata applicata
— le policy non nascono mai più, in silenzio. Corretto instradando Kong al
container reale (con l'header `Host: realtime-dev` che il tenant si aspetta) e
sostituendo il guard silenzioso con `0226_realtime_brand_channel_policies.sql`
(niente `if`, fallisce se `realtime.messages` non c'è) più un hook
(`realtime-policies.sh`, servizio compose `realtime-policies`) che la riapplica
dopo l'healthcheck di Realtime; `db-migrate.mjs` riconosce quel fallimento
specifico e la lascia `deferred` invece di bloccare le migration successive.
