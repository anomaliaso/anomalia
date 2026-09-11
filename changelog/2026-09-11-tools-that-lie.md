# Un successo si costruisce dopo aver saputo com'è andata

`render_post` e `approve_plan` rispondevano `ok: true` senza aver mai guardato l'esito della
scrittura. È la classe di difetto che è già costata la rimozione di `logout` — quello che
restituiva `{loggedOut: true}` dopo un `unlinkSync` fallito e ingoiato da un `catch {}`. Un errore
che si vede costa un giro; un successo falso costa tutto il lavoro che l'agente costruisce sopra,
e si manifesta più in là, dove nessuno lo collega alla causa.

## `render_post`: pagato, fallito, dichiarato riuscito

La rotta è dietro `gateAiAction`, quindi quando si arriva in fondo i crediti sono già usciti. Se il
renderer non produceva l'immagine, `renderError` veniva valorizzato, `url` restava `null` — e la
risposta era `{ ok: true, url: null, error: '...' }`, HTTP 200. Il livello MCP avvolge quella
risposta con `ok()`, che **non** marca `isError`: un modello che guarda `ok` leggeva un successo,
aveva pagato, e non aveva l'immagine.

Ora un render senza immagine è un `502` che nomina il motivo. E porta `credits_spent: true`, perché
il chiamante ha una decisione da prendere che dipende da quel fatto: **riprovare costa una seconda
volta**. La descrizione del tool lo dice per esteso, così il modello lo sa prima di chiamare e non
solo dopo aver fallito.

Stessa cosa per la scrittura di `media_url`: il suo `error` non era letto, quindi un render
riuscito e non salvato era indistinguibile da uno riuscito e salvato.

## `approve_plan`: tre scritture, nessuna guardata

`activatePlan` faceva due `update` e costruiva la risposta dall'oggetto che aveva già in memoria
invece che da ciò che era stato scritto. La rotta scartava perfino quel valore di ritorno,
aggiungeva una terza scrittura non controllata, e rispondeva `ok: true`.

Il fallimento non è teorico: l'indice unico parziale `editorial_plans_active_uniq` (0034) ammette
**una sola** riga `active` per brand. Se il primo `update` non manda in `superseded` il piano
attivo, il secondo viola l'indice e fallisce. Nessuno leggeva quell'errore: il tool rispondeva
`ok: true`, il brand continuava a seguire il piano vecchio, e l'agente riferiva alla persona che il
nuovo era attivo.

Adesso `activatePlan` alza su entrambe le scritture, e su quella di `syncPrefsFromPlan`. Alzare
invece di tornare un risultato è la strada più corta per **tutti e sette** i chiamanti, non solo
per questa rotta: i tre che ignoravano il valore di ritorno (lo scheduler, l'onboarding, il job di
chat) smettono di dichiarare attivato un piano che non lo è, senza toccarli. Nello scheduler il
`throw` è già contenuto dai suoi `try/catch` per brand, che è dove un fallimento di un brand deve
fermarsi.

**Due scritture della rotta sono sparite invece di essere corrette**, perché erano duplicati:

- la supersessione esplicita di `oldActive` — `activatePlan` già supera ogni riga `active` del
  brand tranne quella che sta attivando;
- `syncPrefsFromPlan(proposed)` — `activatePlan` già sincronizza, e lo fa con il piano
  **normalizzato** (`normWeek` + `stampWeekStarts`); la rotta passava la riga **grezza**, quindi
  la seconda chiamata riscriveva le preferenze da un oggetto diverso da quello attivato.

Con loro se ne va `loadActivePlan`, che serviva solo a una delle due.

## `update_voice`: l'effetto c'è, ed è già dichiarato — ma non in tutte e due le descrizioni

`/voice/update` mette `voiceMode = 'manual'` a ogni chiamata, e non è un dettaglio interno: la
pipeline legge `voiceFramework` **solo** quando il modo è manuale, quindi da quel momento nessuno
riscrive più la voce del brand da solo.

Dopo #393 il tool MCP `update_voice` non esiste più — è dentro `update_brand_identity`, la cui
descrizione l'effetto lo dichiara: *«Sending any voice field switches the brand OFF automatic
voice»*. Restava però la descrizione del membro, che diceva solo *«Only the fields you send
change»*. Non raggiunge `tools/list`, ma è il contratto della rotta e lo leggono la CLI e chiunque
apra `packages/api-contracts`. Ora dicono la stessa cosa.

## `reschedule_post`: trovato, verificato, **non** corretto

La sua descrizione dice *«It does not publish and does not approve — it only changes when»*.
L'handler scrive `status: 'approved'`, azzera `external_post_id` e `published_url`, e chiama
`publishApprovedPost`. Rischedulare un post in `pending_user` lo approva e lo manda al publisher.

Non è un difetto della stessa classe degli altri — quella rotta il suo `updateError` lo legge, e un
publish fallito è un `500` onesto. È una contraddizione fra descrizione e comportamento, e
risolverla è una **decisione di pubblicazione**: allineare la descrizione al comportamento tiene in
piedi chi oggi usa `reschedule_post` per approvare e mandare in onda; allineare il comportamento
alla descrizione smette di pubblicare post che oggi escono. Le due strade cambiano cosa va in onda,
quindi la scelta non è di chi corregge il codice. Resta scritta qui perché il prossimo che apre la
famiglia la trovi già trovata.

## Il test è quello che simula il fallimento

Un test del solo percorso felice non può accorgersi di questa classe — è esattamente il motivo per
cui il difetto è arrivato fin qui con la suite verde. Quelli aggiunti usano `failNext` del testkit
per far fallire **la scrittura**, e misurano una cosa sola: che la risposta NON dica `ok: true`.
Visti fallire prima della correzione, tutti e cinque.

E poiché la suite mocka Supabase — dove un insert finto accetta qualunque cosa — il vincolo vero
è provato dove si scrive davvero: `scripts/constraint-harness.mjs` ha adesso il caso «due piani
attivi per lo stesso brand», che deve tornare `23505`. È la prova che il fallimento di
`approve_plan` era raggiungibile, non ipotetico.

## Altri diciannove con la stessa forma, fuori da questa PR

La stessa ricerca su tutte le rotte `api/v1` ne ha trovati altri diciannove: `sync_products` che
cancella il catalogo e poi risponde `synced: 47` senza aver letto l'insert, `publish_post` che
scarta interamente il `PublishResult` mentre il suo gemello `approvePost` in `cli-queries.ts` si
ramifica esattamente sui due casi che questa rotta ignora, `optimize_article` che risponde `ok`
identico sia che abbia riscritto l'articolo sia che il modello abbia fallito, `weekly-plan/render`
che costruisce `ok: true` dal risultato in memoria e non dalla scrittura. Stanno in una PR loro:
sono altre decisioni, alcune su soldi e una su un consenso (le immagini di una persona reale che
restano nel bucket dopo un `ok: true`).
