# Controllo deterministico di un articolo dall'MCP pubblico

Fase 2 del piano agenti esterni. L'MCP pubblico sapeva elencare i sommari degli articoli,
generarli, ottimizzarli, pubblicarli, depubblicarli ed eliminarli. Non sapeva **leggerne uno
intero** né **modificarlo**: ogni strada per cambiare una parola passava da un modello. Un agente
esterno che aveva già scritto la prosa non aveva dove metterla, e un articolo auto-generato non
si correggeva — si rigenerava.

Due endpoint, entrambi deterministici, sullo stesso indirizzo `/web/article`:

- `GET` → l'articolo completo in **qualsiasi** stato (draft, planned, approved, published):
  corpo, SEO, cover, categoria, tag, autore, lingua, schedule, stato, `translation_of`.
- `POST` → scrive titolo, corpo markdown, meta title, meta description, categoria, tag, autore,
  lingua e schedule. Nessuna chiamata a un modello, nessun addebito.

## Cosa è stato composto, non riscritto

`authenticate` / `loadBrandForUser` / `checkApiKeyWriteAccess` (`cli-auth`), `createAdminClient`
(`brand_articles` è SELECT-only sotto RLS, come già fa `POST /web`), `resolveScheduleInput`
(`clock`) e `formatInZone` (`schedule`) per l'orologio del brand, `BLOG_LOCALE_LANGUAGE` +
`isBlogLocale` (`blog-locales`), il registry `BRAND_ENDPOINTS` per il tool MCP e il metodo CLI.
`renderArticleHtml` non è stato toccato: il corpo resta markdown e l'HTML grezzo continua a
essere escapato dal blog pubblico (`blog-site.xss.test.ts`).

## La regola di stato, in un posto solo

`schedule_article` decideva in-line cosa uno stato permette: published rifiutato, planned tiene
il suo slot, tutto il resto va ad approved. Le stesse tre regole servivano all'API, e una regola
scritta due volte diverge al primo cambiamento. Ora stanno in `ARTICLE_EDIT_RULES`
(`src/lib/server/article-editing.ts`): quattro righe, tre colonne, ogni cella o un esito
permesso o il nome del rifiuto. Il tool di chat la legge e tiene le sue frasi. L'estrazione è un
commit separato dal cambiamento di comportamento — l'ordine dei rifiuti, la patch scritta e le
stringhe d'errore sono quelle che restituiva già.

## L'articolo pubblicato

Il piano dice: *"Changes to a published article create a revision; making that revision live is a
separate consequential action"*. Il flusso di revisione non esiste ancora (`brand_article_versions`
oggi è il ledger delle versioni della chat sul blog, non un meccanismo di pubblicazione), quindi
un `POST` su un articolo `published` **rifiuta** con `409 article_published` e indica la strada che
il codice già ha: `unpublish` → modifica → `publish`. È la stessa scelta che `schedule_article`
faceva già. Non si tocca in silenzio quello che è live, e non si è inventato mezzo flusso di
revisione per arrivarci.

## Scartato

- **Una migration.** Nessuna: `brand_articles` non ha CHECK constraint (verificato su
  `pg_constraint`), gli stati scritti sono quelli che il dominio già usa, e i deploy di questo
  repo non applicano migration.
- **`status` come campo scrivibile.** Lo stato è una conseguenza dello schedule, non un input:
  esporlo avrebbe dato un secondo modo — divergente — di pubblicare.
- **`slug`, cover, immagini in-body, video, traduzioni, revisione di un pubblicato.** Fette
  separate con rischi propri.
- **`content_html` nella risposta.** L'agente scrive markdown; l'escaping è già coperto da un test
  suo, non serve rirenderizzare a ogni lettura.
- **Rifattorizzare `update_article` della chat sul modulo nuovo.** Guadagnerebbe il rifiuto sul
  pubblicato, che è un cambiamento di comportamento di una superficie interna: non in questa PR.

## Nota sulla lingua

`language` si scrive con un codice ISO 639-1 e si salva come nome inglese (`it` → `Italian`),
che è la forma che `localeToScope` legge. Per un articolo **originale** il blog ignora comunque
la colonna (il locale di default è il dato, non la stringa); conta per le traduzioni, e proprio
per questo una riga con `translation_of` valorizzato rifiuta il cambio con `translation_locked`:
il locale di una traduzione è la sua identità, e le traduzioni sono fuori da questa fetta.
