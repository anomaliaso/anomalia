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
maiuscolo. Ora scrivono `generated_image`.

Il primo tentativo era `uploaded_image`, e sarebbe stata una regressione di conformità: `publish.ts`
ricava `aiGeneratedMedia: !content_type.startsWith('uploaded')`, quindi quel prefisso **decide la
dichiarazione di contenuto AI**. Un asset preso dalla libreria può essere generato o caricato — la
libreria lo sa (`brand_media.source`), quella tabella no — e prima della PR tutte e tre le forme
dichiaravano. `generated_image` tiene esattamente il comportamento precedente: sovra-dichiarare è
il verso prudente, sotto-dichiarare è il rischio, e lo dice il commento accanto a quella riga.
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

**`competitors` ha preso anche il `unique (brand_id, name)` che mancava.** `chat/job-executor.ts`
fa `upsert(..., { onConflict: 'brand_id,name' })`, ma su quella tabella l'unico indice unico era
la primary key: Postgres risponde **42P10** e la chiamata non legge `error`. Il job «ri-cerca i
concorrenti» riportava i concorrenti trovati e scriveva **zero righe**, in silenzio — provato in
locale sulla stessa istruzione. Correggere la forma degli handle non bastava: la scrittura non
atterrava proprio. Zero duplicati su `(brand_id, name)` in produzione, anche ignorando maiuscole e
spazi, quindi il vincolo entra pulito e rende l'upsert esprimibile.

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

## `external` non lo trova nessun grep, e il motivo cambia il metodo

`cross_post` e `founder` erano letterali scritti nel punto dell'insert, quindi una ricerca testuale
li trova. `external` no: al punto dell'insert (`manual-posting.ts:306`) c'è una **variabile**
— `opts.input.source ?? 'manual'` — e il valore nasce in
`POST /api/v1/brands/:slug/posts`, l'endpoint con cui un agente esterno deposita un post già
scritto. Il vincolo senza `external` gli avrebbe dato 23514 su **ogni** chiamata, e in produzione
non si sarebbe visto applicando la migration: `posts.source` ha solo `plan`, `radar` e `manual`,
quindi l'`add constraint` riesce lo stesso. Si sarebbe visto alla prima scrittura.

Quindi la domanda giusta non è «manca un valore?» ma **«su quali colonne vincolate il valore
arriva da un parametro invece che da una costante?»** — e per ognuna si risale ai chiamanti fino
alla costante vera. Rifatto il giro su tutte le colonne della migration, sono uscite altre tre
cose, nessuna delle quali era un valore mancante:

- **`posts.video_resolution` non è un vocabolario, è una forma.** Il valore arriva da
  `KIE_VIDEO_RESOLUTION` e `KIE_VIDEO_UPSCALE_RESOLUTION`, cioè dalla configurazione, e
  `clampVideoResolution` restituisce il default d'ambiente quando l'input non è in elenco. Un
  elenco chiuso si sarebbe rotto al primo cambio di env — la stessa ragione per cui i tetti di
  piano non stanno nel database. Ora è `^[0-9]{3,4}p$`.
- **`brand_news_sources.lang` idem, e per un motivo peggiore.** Il form
  (`settings/radar/+page.server.ts:83`) prende il valore grezzo e lo taglia a cinque caratteri
  senza allowlist: il menu ha dodici voci, l'endpoint accetta qualunque cosa, e un `pt-BR` sarebbe
  arrivato alla colonna. Ora è `^[A-Za-z-]{2,5}$`.
- **`brand_kit.site_type` era un cast, non un controllo.** `(profile.site_type as SiteType)` non
  guarda niente: il modello risponde su uno schema con `enum`, ma resta un modello, e un decimo
  valore avrebbe fatto fallire l'onboarding invece di degradare a `generic`. Ora passa da
  `clampSiteType`, accanto a `sanitizeThemeColor`.

`posts.content_type` invece regge: tutte le vie che ci arrivano da variabile
(`manual-posting`, `scheduler`, `async-jobs`, `createSingleContent`) risolvono dentro i sette.

## Un test che rompe da solo, invece di un caso in più

Un caso in più nell'harness copre un valore in più; non fallisce il giorno in cui il codice ne
impara un settimo. `src/lib/db-vocabularies.test.ts` confronta l'insieme dichiarato nel codice con
quello ammesso dalla migration, per `posts.status`, `posts.content_type`, `posts.source` e
`brand_kit.site_type`, e rompe **in entrambe le direzioni**: valore nuovo nel codice e CHECK
fermo, oppure CHECK allargato e costante rimasta indietro. Visto rosso in tutte e due prima di
essere verde, e con la guardia contro il passaggio a vuoto (una scansione che non trova più niente
fallisce, non passa).

Perché funzioni serviva l'elenco unico che non c'era: `POST_SOURCES` in `contracts/post-tools.ts`,
da cui il CHECK è derivato. E `PostAuthorship` adesso è
`['manual','external'] as const satisfies readonly PostSource[]`: se un giorno esce dall'elenco, lo
dice il compilatore qui invece di Postgres in produzione.

## Il test: guardarlo fallire prima

Un vincolo senza un test che prova a violarlo è una speranza — e la suite qui mocka Supabase, dove
un insert finto accetta qualunque stringa (è la lezione già pagata su `brand_media.source`).
`scripts/constraint-harness.mjs` scrive **davvero**: 68 scritture malformate contro un Postgres vero,
ognuna passa solo se torna lo SQLSTATE atteso (23514, o 23505 per il vincolo unico), tutto dentro una transazione chiusa da un `rollback`.
I casi nuovi usano i valori che i difetti producevano per davvero — `content_type: 'carousel'`,
`theme_color: 'red'`, `handles: {"instagram":"acme"}` — non valori inventati.

Prima della migration: **0/68**. Il database accettava ogni singolo valore rotto. Dopo:
**68/68**. `DATABASE_URL` che non punta a localhost fa uscire lo script con 2 prima di connettersi:
questo harness scrive, e scrive solo in locale.

La correzione dei dati è stata provata a parte, con ogni forma su un brand pulito e un `rollback`
in fondo: `Mariopuggelli1939` e `@ciccio` diventano handle, `no celo` e la stringa vuota vanno a
nullo, `anomalia.so` prende lo schema, `https://ok.com` non si muove, e un Instagram già
dichiarato sopravvive.
