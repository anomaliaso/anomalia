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

## Le cinque decisioni, e cosa è successo a ognuna

Cinque colonne avevano violazioni o un percorso di codice che il vincolo avrebbe rotto. Quattro
sono entrate dopo aver corretto la causa; una resta libera per scelta.

**`products.kind` resta senza vocabolario.** Le 247 righe fuori dai quattro valori attesi
(`18k gold`, `9kt gold`, …) sono tutte di `pragat-jewels` e non sono dati rotti: sono i nomi di
categoria di un gioielliere, che l'import Shopify copia dal `product_type` del merchant. Un CHECK
lì avrebbe fatto fallire ogni sincronizzazione di catalogo per proteggere niente. Resta il tetto
di lunghezza.

**`posts.content_type` è entrato, dopo tre correzioni.** `SHAPES` in `post-from-asset.ts`
scriveva `image` e `carousel`: sono FORMATI, non tipi, e la description del tool lo dice in
maiuscolo. Ora scrivono `uploaded_image`, che è quello che sono — asset caricati dall'utente.
`uploaded_video`, che `upload-media` scrive da sempre, era invece legittimo e semplicemente
mancava da `POST_CONTENT_TYPES`: aggiunto. E `PostAssetShape.contentType` non è più `string` ma
`PostContentType`, così il compilatore tiene il vocabolario da solo.

**`brand_kit.theme_color` è entrato, dopo la sanificazione in ingresso.** `extractThemeColor`
copia il `<meta name="theme-color">` verbatim, e quel meta ammette qualunque colore CSS: `red` è
HTML valido. I 13 valori in produzione erano tutti `#RRGGBB` per fortuna, non per costruzione.
Ora passano da `sanitizeThemeColor`, accanto a `sanitizeBrandColors` e con la stessa regex.

**`brand_kit.site_type` è entrato allargato.** `media`, `mobile_app` e `service` non erano dati
rotti: erano valori legittimi che mancavano dall'elenco. Il tipo sale da 6 a 9, e con lui l'enum
dello schema JSON che il modello riceve — perché è da lì che arrivano.

**`competitors.handles` è entrato come array, e non era una preferenza.** Tre scrittori ci
mettevano un array di `{platform, username}`, `chat/job-executor.ts` un oggetto
`{platform: username}`. La cosa che decide non è il conteggio: **entrambi** i lettori
(`pickHandles`, `normalizeHandles`) tornano vuoto su qualunque cosa non sia un array. L'oggetto
era invisibile a tutto il prodotto — il job "ri-cerca i concorrenti" scriveva handle che nessuna
schermata poteva mostrare. Corretto lo scrittore, vincolata la forma. È anche la forma di
`brand_social_handles`, e un oggetto non reggerebbe due account sulla stessa piattaforma.

## `Mariopuggelli1939` non era spazzatura: era nel campo sbagliato

Delle nove righe di `brand_kit.source_url` che non erano URL, due erano handle veri —
`biohappy` e `Mariopuggelli1939` — scritti da qualcuno nel campo dove si chiedeva un sito. Le
stesse nove stanno anche in `brands.website`, perché è la stessa cosa copiata due volte.
Annullarle sarebbe stato buttare un dato giusto perché stava nel posto sbagliato.

Quindi la regola è **in ingresso**, in `splitWebsiteOrHandle` accanto alle altre regole dei campi
del Brand Studio: la chiocciola davanti, oppure una parola senza punti e senza schema, non può
essere un dominio ed è un handle; va fra gli handle del brand. Uno spazio dentro (`no celo`) non
è né l'uno né l'altro e si butta, invece di inventarci un profilo. Un dominio nudo prende lo
schema, non il cestino.

Nell'onboarding il punto è uno solo — `scrapeTargetsFrom(data)` — e legge entrambi i campi, così
nessuna delle quattro chiamate può dimenticarsene.

**Due trappole trovate provando, non leggendo.** `brand_social_handles` è unica su
`(brand_id, platform)`, non sullo username: la guardia che avevo scritto controllava la colonna
sbagliata, e su un brand con un Instagram già dichiarato la insert avrebbe alzato un 23505
facendo **abortire l'intera migration**. Ora è `on conflict (brand_id, platform) do nothing`, e
l'handle dichiarato vince su quello dedotto — stessa regola nel codice, dove il campo apposito
batte il campo sito. La seconda: annullare tutto ciò che non è `^https?://` avrebbe buttato un
dominio nudo. Oggi nessuna delle nove ha quella forma, ma la migration si applica dopo, e nel
frattempo una riga nuova arriva.

I 21 `brands.website` che sono domini nudi (`anomalia.so`) NON si toccano qui: sono dati buoni e
vogliono una decisione loro.

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
`scripts/constraint-harness.mjs` scrive **davvero**: 67 insert malformati contro un Postgres vero,
ognuno passa solo se torna il 23514 atteso, tutto dentro una transazione chiusa da un `rollback`.
I casi nuovi usano i valori che i difetti producevano per davvero — `content_type: 'carousel'`,
`theme_color: 'red'`, `handles: {"instagram":"acme"}` — non valori inventati.

Prima della migration: **0/67**. Il database accettava ogni singolo valore rotto. Dopo:
**67/67**. `DATABASE_URL` che non punta a localhost fa uscire lo script con 2 prima di connettersi:
questo harness scrive, e scrive solo in locale.

La correzione dei dati è stata provata a parte, con ogni forma su un brand pulito e un `rollback`
in fondo: `Mariopuggelli1939` e `@ciccio` diventano handle, `no celo` e la stringa vuota vanno a
nullo, `anomalia.so` prende lo schema, `https://ok.com` non si muove, e un Instagram già
dichiarato sopravvive.
