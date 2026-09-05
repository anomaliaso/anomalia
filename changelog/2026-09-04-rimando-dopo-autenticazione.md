# Il rimando al workbench stava sopra l'autenticazione

La #269 ha spostato in cima al layout del brand il rimando verso `/workbench`, per togliere una
corsa con la scrittura del cookie dell'ultimo brand. Troppo in cima: **sopra il controllo di
sessione**.

Conseguenza, presa dalla CI:

```
unauthenticated /app/[brand] redirects to /login
  Expected: 303
  Received: 302
```

Un utente non autenticato che apriva `/app/qualunque` veniva mandato al workbench invece che al
login. Non è una falla — il workbench il controllo lo rifà — ma è il flusso di ingresso rotto, e
`dev` è rimasta rossa finché non lo si è visto.

## Dove sta adesso, e perché lì

Fra il `404` del brand inesistente e la scrittura del cookie. È l'unico punto che soddisfa
entrambe le proprietà:

- **dopo** sessione, accesso e brand: chi non deve entrare riceve la risposta che l'app promette
  ovunque, cioè `303` verso `/login` o `/waitlist`;
- **prima** del `cookies.set`: SvelteKit rifiuta di scrivere un cookie dopo che la risposta è
  stata generata, ed è la ragione per cui la #269 lo aveva alzato.

## Il test che mancava, e perché passava lo stesso

I quattro test esistenti eseguivano il `load` con `locals: {}` — senza Supabase, senza sessione.
Passavano **perché il rimando usciva prima di toccarli**: non provavano l'ordine, provavano solo
la destinazione. Spostare il rimando li ha fatti esplodere, che è il modo in cui si scopre che un
test verde stava sorvegliando meno di quanto sembrasse.

Ora il layout riceve una sessione finta e i test coprono anche il caso senza. Rimettendo il
rimando in cima, `expected 302 to be 303` — lo stesso errore che ha dato la CI, un secondo invece
di dieci minuti.
