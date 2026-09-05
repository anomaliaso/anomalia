# Un render che non atterra dice perché, e nomina il fornitore vero

Dall'MCP contro un server locale è tornato un lavoro video con
`status: "done"` e `media_id: null`, e niente in libreria. Una contraddizione
su cui non c'è niente da fare: la clip è stata prodotta, pagata, e non è
raggiungibile da nessun tool.

La #344 ha chiuso la metà del lettore — `check_media_job` non ripete più la
contraddizione e risponde `not_in_library`. Questa è la metà dello scrittore.

## Cosa non andava

`applyToPost` rispondeva con un booleano, quindi ogni motivo per cui una clip
non atterrava collassava su una stringa che il chiamante aveva già scritto:
`clip stored but the post could not be updated`. Su un render di libreria quella
frase nomina un post che il lavoro non ha mai avuto, e `error` è la colonna che
`check_media_job` mostra verbatim a un agente esterno — che quindi leggeva «il
tuo clip è bloccato su un problema di post» quando la causa vera era un 403 sul
download dell'mp4, un file vuoto, o un insert rifiutato.

Il motivo esisteva già: `saveRenderedVideoToLibrary` torna `{ error }` su ogni
percorso di fallimento, e veniva loggato e buttato via al ritorno.

Il secondo difetto stava a due schermate di distanza, nello stesso file. Il ramo
sull'età scriveva a mano `kie never resolved this task`. Da #336 un `task_id`
può essere marchiato `openrouter:`, e per quelle righe la frase è falsa: manda
chi legge `error` — un agente esterno adesso, un umano che guarda `ai_calls` fra
un mese — a cercare in una dashboard che quel lavoro non l'ha mai visto. Il ramo
`exhausted` subito sopra era già onesto (`gave up after N attempts (…)`), e la
distanza fra i due diceva già qual era quello sbagliato.

## Come è chiuso

`landClip` (era `applyToPost`, e da due commit non applica più a un post) torna
`string | null`: null vuol dire atterrato, una stringa è il motivo, e finisce
sulla riga. Le semantiche di retry non cambiano — un motivo presente rimette la
riga in coda, dove `MAX_ATTEMPTS` la ferma.

Per il fornitore: `videoTaskProvider` in `video.ts` dà un nome al ramo che
`finishVideoRender` prende già, e la coda chiede al suo vicino invece di
imparare il marchio `openrouter:` per conto suo — lo stesso motivo per cui il
trasporto si legge dalla RIGA e mai da `AI_ROUTE_VIDEO` di adesso: una riga in
coda sopravvive al deploy che sposta la variabile.

## I test

L'invariante è scritta come proprietà su tutte le righe che il riconciliatore
chiude, non come percorso felice: nessun render `done` con post nullo esiste
senza una riga `brand_media` che lo reclama per `source_ref` sotto lo stesso
brand — la stessa coppia con cui `listMediaJobs` risolve l'asset. Passa oggi,
e fallisce contro la riga che ha prodotto l'incidente (`if (!row.post_id)
return true;`): è questo che la rende una guardia e non una ripetizione.

I due negativi: il deposito in libreria che fallisce registra il motivo vero e
non un post inesistente; e un lavoro `openrouter:` che scade non nomina kie.
Entrambi visti rossi prima del fix — il secondo contro la stringa fissa.

Il riconciliatore resta l'unico posto che scrive `done` su `video_renders`, e
lo fa solo dopo che `landClip` è tornato null.
