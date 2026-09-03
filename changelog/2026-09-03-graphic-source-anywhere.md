# Il codice di una grafica si apre anche quando la grafica non è di un post

Ieri una grafica standalone è diventata possibile. Nasceva con il suo sorgente HTML/TSX e la sua
cronologia di versioni — e nessuno sapeva aprirlo: `grep_source`, `read_source`, `replace_source` e
`write_source` conoscevano solo `{ kind: 'post' }`.

Si poteva rifare a parole con `design_graphic`, e non correggere di una parola. **Una feature a
metà**, spedita come se fosse intera.

## Cosa c'era e cosa mancava

Il magazzino non era il problema: `graphic_designs` indirizza `{ kind, id }` — post o asset di
libreria — dal primo giorno. Mancavano due cose sopra di lui:

- **il bersaglio**, che negli strumenti del sorgente era `EditorTarget`, cioè un post e basta.
  Adesso è `GraphicEditTarget`, o post o asset; `loadWorkingGraphicSource` e la scrittura
  scelgono la destinazione da lì;
- **il resolver della chat**, che rifiutava senza `post_id`. Adesso accetta anche `media_id` e,
  se non ne arriva nessuno dei due, lo dice invece di indovinare.

`applyStandaloneGraphicSource` è il gemello di `applyPostGraphicSource`: renderizza il sorgente,
salva l'immagine sull'asset e versiona. Sta accanto a lui apposta — sono le due destinazioni
possibili di un render, e tenerle lontane è ciò che fa dimenticare un pezzo all'una o all'altra.

Corretta anche una risposta rotta: `grep_source` restituiva `post_id: undefined` su un asset. Ora
il risultato nomina il bersaglio vero.

## Cosa NON è stato verificato, e va detto

Nel browser l'agente ha **risposto giusto senza usare questi strumenti**: prima con `query`, poi —
richiesto esplicitamente — con `bash` e `grep` dentro la sandbox. Ha letto il sorgente e riportato
riga e colore corretti, ma per un'altra strada. Il percorso nuovo end-to-end non l'ho quindi visto
girare in chat, e non lo dichiaro verificato.

Quello che è verificato: le funzioni sul bersaglio asset (ricerca, lettura, la guardia «leggi prima
di scrivere», la scrittura che finisce sull'asset e non su un post), e la tool chiamata **come la
chiama il modello** — schema, risoluzione del bersaglio, esecuzione. Più una guardia sul cablaggio
del resolver, perché il difetto stava lì e non nelle funzioni.

L'upload in Storage resta rotto in locale (`extended attributes disabled`, v.
[`LESSONS.md`](../LESSONS.md)), quindi un `replace_source` completo su questa macchina non arriva
in fondo comunque.
