# Il turno riscritto non sparisce più dal thread

`thread_events` è il log da cui la UI proietta la chat, e si riempiva da un solo trigger:
`chat_messages_capture_event`, `after insert`. Il checkpoint del battito (`bridge/live.ts:663`)
però inserisce la riga dell'assistente VUOTA e poi la aggiorna a ogni battito — quindi nel log
restava la fotografia del primo istante, per sempre.

Misurato sul thread `cc6854d2` in produzione, messaggio `cce28fda`:

| | riga `chat_messages` | evento letto dalla UI |
|---|---|---|
| content | 531 | 0 |
| tool_calls | 10.236 | 0 |
| reasoning | 60.700 | 0 |

`loadThreadUiHistory` preferisce sempre la proiezione degli eventi e ricade su `chat_messages`
solo quando di eventi non ce n'è NESSUNO: con 230 eventi nel thread non ci ricadeva mai. Il turno
risultava scomparso a chi guardava, mentre nel database non mancava una virgola.

Non bastava un trigger in più sull'UPDATE: `append_thread_event` solleva
`thread event source key conflict` se il payload cambia sotto la stessa `source_key`, e
l'eccezione avrebbe fatto abortire anche la scrittura del contenuto. E `reduceThreadEvents` faceva
`messages.push()`, quindi un secondo evento sullo stesso messaggio avrebbe prodotto una bolla
doppia invece di un aggiornamento.

Quindi due pezzi, uno per lato:

- **L'evento resta immutabile.** La revisione è un evento NUOVO, `message:<id>:r<seq>`, scritto da
  `append_thread_message_revision` sotto lo stesso lock di thread che alloca il seq — così la
  chiave è unica per costruzione. Se ne tiene UNA: il payload è la riga intera, e un turno lungo
  produce decine di checkpoint. Una riscrittura identica non costa niente (il confronto
  `is not distinct from` sta nel trigger, perché `update of` scatta anche a valore uguale).
- **Il reducer sostituisce al suo posto** il messaggio con lo stesso id, invece di accodarlo: la
  bolla resta dov'era nel thread e porta il contenuto ultimo. Un messaggio già superato non torna
  in vita per via di una revisione tardiva.

Lo scenario di durabilità `il-turno-riscritto-non-sparisce` è il guardiano: inserisce vuoto,
riscrive due volte, e pretende una bolla sola col testo finale e una sola revisione in log.

I thread già colpiti NON si riparano da soli: l'evento vecchio resta quello che è. Il riallineamento
dei payload esistenti è un intervento a parte.
