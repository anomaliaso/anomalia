# Il consenso di una persona reale vale anche fuori dal browser

La migration `0187` ha reso il consenso all'immagine un atto registrato — con timestamp e
provenienza — e il gate a valle (`resolvePeopleVisualRefsDetailed`) si fida di `people.consent`
per decidere se un volto può arrivare a un generatore. Il percorso browser lo rispettava:
`addPersonReal` rifiuta 400 senza la spunta e poi timbra `consent_at` e
`consent_source: 'owner_attested'`.

`POST /api/v1/brands/:slug/studio/people` — la porta di CLI e MCP — scriveva invece
`consent: true` incondizionatamente, senza timestamp e senza provenienza. Una persona reale creata
da lì passava il gate senza che nessuno avesse attestato niente: non un difetto estetico, un buco
di compliance, e per giunta invisibile in audit, perché la riga era indistinguibile da una
attestata davvero. Lo stesso file scriveva un `consent: true` per le persone AI senza
`consent_source: 'ai_generated'`, che il browser scrive.

## La decisione sta in un posto solo

Browser e API decidevano la stessa cosa in due punti, ed è per questo che uno dei due è rimasto
indietro senza che nessuno se ne accorgesse. La decisione ora vive in
`src/lib/server/people-consent.ts`: una funzione pura, due input (il tipo di persona,
l'attestazione), che restituisce le colonne da scrivere oppure `null` — e `null` significa
"rifiuta". Entrambi i chiamanti la usano; il messaggio d'errore è la stessa costante.

Quel file non dipende da nulla, quindi il test della regola non ha bisogno di un database, di un
client finto o di una route: `people-consent.test.ts` la esercita direttamente, e
`server.consent.test.ts` prova che l'endpoint la applica davvero — rifiuto senza attestazione,
nessun insert, e `consent_at` timbrato quando c'è.

## Scartate

- **Duplicare il controllo nell'endpoint.** Era il diff più corto, ed è esattamente la mossa che
  ha prodotto il buco: due copie della stessa regola divergono al primo cambiamento.
- **Accettare `consent: 'on'` o qualsiasi valore truthy**, per somigliare al form. Un `1` o una
  stringa non vuota che valgono per un'attestazione legale è il tipo di indulgenza che poi si
  legge in un audit: passa solo `true` booleano.
- **Un constraint sul database** (`kind='real' → consent_source not null`). Le righe
  `legacy_assumed` e `import_unattested` esistono per scelta di `0187` e lo violerebbero al primo
  deploy; e qui le migration non girano col deploy, quindi il vincolo sarebbe arrivato prima del
  codice che lo rispetta.
- **Un flag `--consent` che rifiuta lato CLI.** Il flag c'è, ma non ripete il controllo: chi
  rifiuta è il server, ed è l'unico posto dove la regola può stare per tutti i client.

## Superficie

`consent` è ora un campo del body dell'endpoint (obbligatorio per `kind: 'real'`), documentato in
`docs/api/04-studio.md` e `cli/docs/api.md`. La CLI espone `--consent` su `people add` e
`studio people-add`; lo strumento MCP `add_person` chiede un booleano che solo l'utente può
dichiarare, con la stessa formula già usata da `update_person` nella chat.
