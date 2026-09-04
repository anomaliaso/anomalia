# Il blog si configura da fuori, con le conseguenze di ogni cancellazione scritte

Quinto e ultimo giro sulle impostazioni headless. Quattro tool — `get_blog_settings`,
`set_blog_settings`, `add_blog_term`, `remove_blog_term` — su `/settings/blog` e
`/settings/blog/terms`. `tools/list`: **107 → 111**, additivo, `changed: []`.

Coprono tre pagine di Settings che erano tre form separati: `blog-appearance`, `blog-categories`,
`blog-authors`.

## La cosa che mancava a `update_article`

`update_article` accetta già `category_id`, `author_id` e `tag_ids`, e verifica che appartengano
al brand. Ma **nessun tool poteva crearne uno**: un agente poteva archiviare un articolo sotto una
categoria esistente e non sotto una nuova. `add_blog_term` chiude quel buco, e la lettura porta
gli id che `update_article` vuole.

## Una tabella per tre liste, non tre catene di `if`

Categoria, tag e autore hanno la stessa forma — nome, slug derivato, unico per brand — e
differiscono in due punti: i campi in più che accettano (`description`; `bio` e `role`; niente) e
**cosa lasciano dietro quando si cancellano**.

`BLOG_TERMS` è quella differenza, in un posto solo:

| voce | vincolo | cosa resta |
|---|---|---|
| categoria | `brand_articles.category_id … set null` | gli articoli restano, senza categoria |
| tag | `brand_article_tags.tag_id … cascade` | il tag sparisce da ogni articolo che lo aveva |
| autore | `brand_articles.author_id … set null` | gli articoli restano, senza firma |

Sono tre conseguenze diverse e sono nella descrizione di `remove_blog_term`, che un test tiene
lì: un agente deve poterle riferire *prima* di eseguire. Il conto degli articoli toccati si fa
prima della cancellazione — dopo, la riga che lo permetteva non esiste più — e torna come
`articles_affected`.

## Ridurre o rifiutare: due scelte diverse, e il perché

- **`articles_per_week` viene ridotta** al tetto del piano. È quello che fa già il form del
  browser, e due comportamenti per lo stesso campo sarebbero una divergenza. Ma un agente che non
  rilegge crederebbe di aver salvato il numero chiesto: la risposta riporta `config` e la
  descrizione dice di rileggerlo.
- **una lingua che il blog non serve viene rifiutata** (`unknown_locale`). Scartarla in silenzio
  lascerebbe l'agente convinto di aver acceso una traduzione che non esiste.
- **un campo mandato alla lista sbagliata viene rifiutato** (`field_not_for_term`), non ignorato:
  una `bio` su un tag non è un refuso da assorbire, è una biografia che l'agente crede di aver
  scritto.
- **uno slug già preso è 409**, non un 500 col messaggio Postgres del vincolo unico che il codice
  attuale lascia passare a schermo.

## Una regola per campo, e due chiamanti

`customizationPatchFromFormData` costruiva le tredici regole di `blog_config` inline, per il form.
L'API ha bisogno di una patch **parziale**: reimplementarle sarebbe stato tredici regole in due
copie, e la divergenza non si vede come un errore — si vede come un colore leggermente sbagliato
sul sito pubblico.

Ora c'è `BLOG_CONFIG_FIELDS`, una riga per campo, e `blogConfigPatch(input, plan, current)` che
applica solo i campi presenti. Il form ci passa tutti e tredici (un salvataggio da form è un
rimpiazzo completo, e una casella non spuntata è `false`), i tool solo quelli nominati.

Il vincolo incrociato — le lingue extra non possono contenere quella di default — si applica dopo
il passaggio per campo, su ciò che vale DOPO la patch: senza `current`, cambiare solo `locales`
lascerebbe il blog a tradursi verso se stesso.

Nello stesso file lo slugify era ricopiato **tre volte**, una per azione. Ora è `blogTermSlug`, e
la usano le tre azioni del form più le due rotte.

## Cosa resta fuori, e non è una dimenticanza

L'**icona del blog** e l'**avatar di un autore** si impostano solo caricando un file: passano da
`readUploadImage`, hanno un tetto di 2 MB, finiscono nello Storage. Un campo che li accettasse
come stringa farebbe salvare una URL che nessuno ha verificato. Un test verifica che quei campi
non esistano negli schemi, e la descrizione lo dice invece di lasciarlo scoprire.

## Cosa è stato visto rosso

- il contratto, prima di essere nel registry;
- `blogConfigPatch`: tolti il controllo del colore, quello del font, il tetto della cadenza e il
  vincolo incrociato sulle lingue, cadono 6 test — **fra cui due che esistevano già per il form**,
  che è la prova che le due strade ora condividono davvero la stessa regola;
- le rotte: tolti `no_fields`, il rifiuto della lingua, lo slug vuoto, lo slug già preso, il campo
  fuori lista, il 404 e il conteggio, **cadono 10 test su 19** e 9 restano verdi.
