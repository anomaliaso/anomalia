# Rifinire un asset della libreria, invece di ridisegnarlo da zero

Andrea aveva un'immagine già generata. Ha chiesto: *«me lo fai rosso»*. L'agente esterno ha
risposto che Anomalia non sa modificare un asset in libreria, e ha chiamato `generate_media` con
un prompt nuovo — **un gatto rosso disegnato da zero**, non l'immagine di prima resa rossa.

**L'agente non ha sbagliato.** Ha letto `tools/list` e ha usato l'unica cosa che c'era.

## Perché non c'era

Nel registro ogni azione di rifinitura era ancorata a un post — `regenerate_post_media`,
`regenerate_slide`, `make_video`, tutte `resource: 'post'` — e `GENERATE_MEDIA` aveva un input
`.strict()` senza alcun riferimento a un'immagine di partenza. Un asset in libreria non era un
soggetto su cui si agisce: o lo attaccavi a un post, o l'unica strada era ridisegnarlo.

## Quello che c'era già

La capacità sotto **esiste da sempre**. In `content-preview/images.ts`:

> `baseImage` è l'unico segnale che distingue una MODIFICA da un disegno nuovo, e passa tutto di qui

E `refineModel` vale solo quando c'è `baseImage`. Il ramo di rifinitura è vivo e in produzione: ci
arrivava soltanto chi passava da un post. Qui non si è costruita una funzione nuova — si è smesso
di nasconderla.

## Due tool, un motore

`generate_image` e `refine_image` sono due voci distinte in `tools/list`, e devono restarlo: un
parametro opzionale dentro `generate_media` non basta, ed è **dimostrato** — l'agente ha guardato
la lista, non ha visto rifinitura, e ha ridisegnato. Se il tool non si chiama come la cosa che fa,
non viene trovato.

Sotto però sono una funzione sola, `runImageJob`, perché il motore è lo stesso e due copie
divergerebbero. La differenza sta negli argomenti, che è esattamente dove la vede chi chiama:
generare vuole un prompt, rifinire vuole una sorgente e un'istruzione.

Il test che conta riproduce la sessione di Andrea: `opts.baseImage` valorizzato con l'originale e
il modello di **refine** scelto al posto di quello di generazione. Verificato che sappia fallire —
facendo ricadere il ramo sulla generazione, diventa rosso.

## Le regole che questo percorso stabilisce

- **L'originale non si tocca.** Rifinire deposita un asset NUOVO. Chi sbaglia il rosso riparte
  dall'immagine giusta invece di averla persa.
- **Una sorgente che non esiste FERMA la richiesta.** Ricadere sulla generazione sarebbe il difetto
  travestito da rimedio: l'agente pagherebbe un disegno nuovo credendo di aver modificato il suo.
  Vale anche per l'asset di un altro brand, che `resolveBrandImageIds` non risolve perché filtra
  per `brand_id` nella query.
- **`base_media_id` accetta un prefisso corto**, come gli id dei post. Risolto lato server e non nel
  livello MCP: lì varrebbe solo per chi passa da MCP, e la CLI resterebbe senza. Un prefisso che
  combacia con due asset non ne sceglie uno a caso.
- **Il post resta una strada, non l'unica.** `regenerate_post_media` e compagni non sono toccati.

## Il modello, per una chiamata sola

Ogni generatore accetta `model` opzionale. Assente → la scelta del brand. Presente → vale **solo
per quella chiamata** e non scrive niente in `content_prefs`. La distinzione con `set_media_model`
è la sola cosa che conta ed è scritta nelle descrizioni: quello è «d'ora in poi», questo è «per
questa volta». Senza, l'unica strada per provare un modello diverso era riscrivere il default del
brand in modo permanente per fare una singola immagine.

La validazione passa da `slotAccepts` / `slotChoices`, **lo stesso catalogo di `set_media_model`**:
un secondo elenco divergerebbe al primo modello aggiunto, e la metà rimasta indietro rifiuterebbe
in silenzio un modello valido. Un modello sbagliato torna `model_not_for_slot` **con l'elenco di
quelli ammessi** — senza, il rifiuto è un vicolo cieco. Un test tiene fermo che qui non compaiano
id di modelli scritti a mano.

E la risposta dice **quale modello ha disegnato**, letto dalla stessa `buildImageRequest` che
costruisce la richiesta e non da una copia della sua tabella. Un agente che non ha scelto sa cosa
ha ottenuto, e può decidere se riprovare diversamente.

## `generate_media` resta

Non cancellato: inoltra a `generate_image` e `generate_video`. Qualcuno lo sta già usando, e
togliere una capacità mentre le stiamo moltiplicando sarebbe il modo peggiore di aggiungerne. La
sua descrizione ora dice di preferire i due tool espliciti.

## La skill lo dice

`SKILL.md` portava un agente a concludere che l'editing non esiste — è successo davvero. Ora la
riga c'è, e nomina l'errore: usare `generate_image` per modificare qualcosa paga un render nuovo e
restituisce un soggetto diverso.
