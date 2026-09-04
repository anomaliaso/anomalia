# I modelli media si scelgono da fuori, e la scelta viene validata

Anomalia sta diventando un'interfaccia headless per agenti esterni. Le impostazioni erano
l'ultimo pezzo che imponeva il browser: un cliente che voleva cambiare il modello con cui si
generano le immagini doveva aprire una pagina. Ora può dirlo al proprio agente.

Due tool nuovi, generati dal registry (`get_media_models`, `set_media_model`), su
`GET`/`PUT /api/v1/brands/:slug/settings/models`. `tools/list` passa da **95 a 97**, e il diff è
solo additivo: nessun tool esistente cambia titolo, descrizione o annotazioni.

## Perché una coppia e non solo la scrittura

I modelli disponibili non sono una lista fissa: per **immagini** vengono da
`IMAGE_MODEL_CHOICES` (`src/lib/image-models.ts`), per i **video** da `videoModelsForRole`
(`src/lib/video-models.ts`), e cambiano per mestiere. Aleph riscrive una clip e non ne genera
una; Kling V3 Turbo anima una foto e non parte dal testo. Un tool che accetta una stringa libera
lascia l'agente salvare un modello che quel mestiere non fa, e il guasto si scopre al primo
render fallito — lontano da dove è stato causato.

La lettura serve a **scegliere**: per ogni mestiere torna la scelta corrente e gli id ammessi.
Ma la validazione sta nella **scrittura**, perché è l'unico punto che non si può saltare: un
agente esterno può chiamare `PUT` senza aver letto niente, e in quel caso risponde
`model_not_for_slot` (400) con l'elenco `allowed` di ciò che sarebbe passato. Niente viene
salvato.

`slot` è uno `z.enum` a compile time — i sei mestieri sono una tabella scritta a mano e stabile.
`model` **non** lo è, ed è una scelta: un enum piatto di tutti gli id direbbe all'agente che
`runway/aleph` va bene per `imageModel`, che è falso. L'insieme ammesso dipende dallo slot, e
quella è una cosa che uno schema piatto non sa esprimere. Quindi lo dice la rotta, con la lista.

## Dove è salvata la preferenza (e cosa non ha un posto)

Su `brands.content_prefs`, jsonb, sotto le sei chiavi che `MEDIA_MODEL_SLOTS` già dichiara:
`imageModel`, `imageRefineModel`, `videoModel`, `videoImageModel`, `videoRefineModel`,
`videoMotionModel`. **Nessuna migration**: la colonna c'è dal `0011`, e i sei slot ci scrivono
già dal browser.

Il **motion video programmatico** (Remotion/TSX) è la casistica che Andrea ha nominato e che
**non ha un posto dove salvare una preferenza**: il modello che scrive il TSX viene da
`motionAgentModel()` → `craftAgentModel({ envModel: env.MOTION_VIDEO_MODEL })`, cioè una
variabile d'ambiente di piattaforma o il default del catalogo chat. Non è una preferenza di
brand, e inventarne una colonna sarebbe una decisione di prodotto travestita da endpoint —
soprattutto in un repo dove il deploy non applica le migration. È scritto nella doc e nella
skill, non implementato.

Fuori anche `brands.chat_default_tier`: esiste come colonna e come funzione
(`setChatDefaultTier`), ma **nessuna UI la chiama** oggi, e il catalogo chat è in mezzo allo
smantellamento di `src/lib/server/chat/`. Esporre da qui un campo che nessuno scrive
significherebbe congelare una forma che sta cambiando.

## La regola sta in un posto solo

`updateMediaModel` (l'azione del form) e la rotta `PUT` sono due chiamanti della stessa cosa: un
modello è salvabile solo se sa fare il mestiere in cui viene salvato, e una durata che il nuovo
modello non regge va riportata dentro il suo tetto (30s esistono su Seedance 2.5, non su Grok).
Scritta due volte sarebbe divergente al primo modello nuovo, e la metà non aggiornata salverebbe
preferenze che il renderer scarta.

Estratta in `chooseMediaModel` (`src/lib/server/media-model-prefs.ts`): l'azione del form ora la
chiama invece di ripetere il clamp inline, e il commento stantio che descriveva la versione a uno
slot solo è andato via con lui.

## I due elenchi che non possono divergere

`packages/api-contracts` non può importare `$lib` (`packages/no-app-imports.test.ts` lo
impedisce), quindi i sei nomi vivono anche nel contratto, come `MEDIA_MODEL_SLOT_IDS`. Un
mestiere aggiunto di là e non di qua sarebbe modificabile dal browser e invisibile a
`set_media_model`, in silenzio.

Il guardiano è un test in `src/lib/media-model-slots.test.ts` che confronta i due elenchi. È
stato visto fallire aggiungendo un settimo slot finto al contratto, prima di essere lasciato
verde.

## Cosa è stato visto rosso

- il contratto, prima che il file esistesse;
- `chooseMediaModel`, prima che esistesse;
- la rotta: tolta la validazione e tolto il re-clamp, esattamente due test cadono
  (`model_not_for_slot` e la durata) e dieci restano verdi;
- il guardiano dei due elenchi, con un settimo slot finto;
- **la chiave di sola lettura**: `resolveCaller` blocca ogni non-GET sul metodo, una volta, per
  tutte le rotte. Non c'era un test. Ora c'è, e togliendo quelle quattro righe da `cli-auth.ts`
  diventa rosso.

## Cosa resta fuori, e perché

- **`api-keys`** — un agente che si conia le proprie credenziali è una scala di privilegi: la
  chiave nuova nasce con lo scope che chiede, e uno scope di scrittura ottenuto da una sessione
  di sola lettura annulla il confine che `resolveCaller` difende.
- **`danger`** — cancella il brand e disdice l'abbonamento Stripe. Irreversibile e senza una
  conferma che un agente possa dare al posto di una persona.
- **OAuth dei connettori** (`connected-accounts`, `connectors`, `search-console`, `facebook`,
  `linkedin`) — il consenso a un provider terzo lo dà un umano su una pagina del provider. Un
  tool può al massimo consegnare il link, mai attraversarlo. La disconnessione è l'altra metà
  della stessa cosa e resta con lei.
- **`billing`** — già coperto, e nel modo giusto: `create_checkout_link` e
  `create_billing_portal_link` (PR #223) **mintano una URL e la restituiscono**. L'agente
  consegna la porta; la persona la attraversa su Stripe.
