# Che cosa è un valore valido, adesso lo dice il database

L'audit della RLS aveva già dato il verdetto buono: 544 combinazioni su 548, un utente non tocca i
dati di un altro cliente. La domanda che restava aperta è un'altra — dentro il **proprio** brand,
che cosa può scrivere? Fino a qui: qualunque cosa. Le regole su cosa è un valore valido stavano nei
tool, e i tool non sono il database.

Il conto misurato in produzione:

| tabella | colonne | NOT NULL | CHECK |
|---|---|---|---|
| `brand_kit` | 21 | 3 | **0** |
| `products` | 11 | 6 | **0** |
| `brand_articles` | 24 | 10 | **0** |
| `content_plans` | 10 | 4 | **0** |
| `posts` | 50 | 8 | **0** |

`brand_kit` è l'identità visiva del brand — 21 colonne, tre obbligatorie, zero vincoli. E la teoria
è già diventata pratica: in `brand_colors` c'è un colore che è
`#00502DKEY_PAD_OR_HEX_MATCH_1_#00502D`, un segnaposto di regex sfuggito da uno scraper e finito
nel database come se fosse un colore. In `brand_kit.images` c'è un path relativo dove tutti gli
altri 586 sono URL assoluti. In `brand_news_sources` c'è un subreddit che si chiama
`transgenderUK/`, con la barra, e il radar non lo troverà mai.

## Il metodo: contare prima, vincolare dopo

`alter table … add constraint … check (…)` fallisce se **una sola** riga esistente lo viola, e qui
ci sono mesi di dati veri. Quindi ogni vincolo è stato interrogato in produzione in sola lettura e
contato prima di essere scritto. Nella migration ci sono solo i 42 che hanno **zero** violazioni;
quelli con violazioni non ci sono, e sotto c'è perché.

Nessuna tabella supera le 1.800 righe: `add constraint` blocca per millisecondi, `not valid` +
`validate constraint` sarebbe cerimonia senza guadagno.

## Quello che non è entrato, e non per dimenticanza

**`products.kind` — 247 righe fuori vocabolario.** Il vocabolario è `product | service | project |
feature`; in produzione ci sono anche `18k gold`, `18k gold / 9K GOLD`, `9kt gold`, `14k gold`.
Tutte e 247 sono di un brand solo, `pragat-jewels`, e la causa è una riga sola ripetuta in tre
posti: `kind: p.productType ?? 'product'`, dove `productType` è il `product_type` di Shopify —
testo libero del merchant. Non basta correggere le righe: finché l'import scrive lì, il vincolo
farebbe fallire ogni sincronizzazione del catalogo.

**`posts.content_type` — zero righe da correggere, ma tre percorsi da sistemare.** `SHAPES` in
`post-from-asset.ts` scrive `image` e `carousel`, che non sono content type ma **format** — la
description del tool stesso lo dice a lettere («NOT carousel/reel/story»). E `upload-media`
scrive `uploaded_video`, che è legittimo e semplicemente manca da `POST_CONTENT_TYPES`. Il vincolo
diventa sicuro quando quei tre valori sono a posto, non prima.

**`brand_kit.theme_color` — zero violazioni, ma per fortuna.** `extractThemeColor` copia il
contenuto del `<meta name="theme-color">` del sito senza validarlo. Oggi i 13 valori sono tutti
`#RRGGBB`; un sito che scrive `red` — che è HTML valido — farebbe fallire l'onboarding. Prima si
sanifica all'ingresso, poi si vincola.

**`brand_kit.site_type` (3 righe), `brand_kit.source_url` (9 righe).** Il primo ha `media`,
`mobile_app`, `service` fuori dai 6 archetipi. Il secondo ha cinque stringhe vuote e tre cose che
non sono URL: `no celo`, `Mariopuggelli1939`, `biohappy` — utenti che hanno scritto un handle
Instagram dove si chiedeva un sito. Sono pochi e sono dati di clienti veri: si decide, non si
decide per loro.

**`competitors.handles`.** Non è un problema di dati ma di forma: tre writer ci mettono un array
di `{platform, username}`, `chat/job-executor.ts` ci mette un oggetto `{platform: username}`.
Prima si sceglie una forma nel codice, poi la si vincola.

## Due cose che di proposito restano nel codice

**I tetti di piano non sono un CHECK.** Quante fonti radar consente un piano cambia quando cambia
il listino, e un vincolo da migrare a ogni cambio di prezzo è un impedimento, non una protezione.

**Nemmeno l'elenco delle lingue.** `brand_news_sources.lang` è vincolato nella *forma* — due
lettere minuscole, oppure `auto` — non nell'elenco delle 12 voci del menu. La prova che è la scelta
giusta è già nei dati: c'è una riga con `tr`, che nel menu non c'è. La forma regge, l'elenco
avrebbe fatto fallire la migration.

Stesso ragionamento per `posts.platform`, `posts.platforms` e `posts.format`: i percorsi
planner/onboarding ci scrivono l'output del modello senza normalizzarlo, e un CHECK lì fermerebbe
l'autopilot di notte. `format` prende solo un tetto di lunghezza.

## Il test: guardarlo fallire prima

Un vincolo senza un test che prova a violarlo è una speranza — e la suite qui mocka Supabase, dove
un insert finto accetta qualunque stringa (è la lezione già pagata su `brand_media.source`).
`scripts/constraint-harness.mjs` scrive **davvero**: 61 insert malformati contro un Postgres vero,
ognuno passa solo se torna il 23514 atteso, tutto dentro una transazione chiusa da un `rollback`.

Prima della migration: **0/61**. Il database accettava ogni singolo valore rotto. Dopo:
**61/61**. `DATABASE_URL` che non punta a localhost fa uscire lo script con 2 prima di connettersi:
questo harness scrive, e scrive solo in locale.
