# Una porta sola per correggere quello che hai già fatto

`refine_image` diventa `refine_media` e serve anche i video. Il tipo dell'asset non si dichiara più:
lo decide la riga di libreria che `base_media_id` nomina.

## Cosa c'era prima

Due buchi, e il secondo era invisibile.

Il primo: rifinire esisteva **solo per le immagini**. `refine_image` viveva su
`/media/images/refine` e il nome diceva la verità — una clip già in libreria non si poteva
correggere da nessuna parte dell'API. Chi chiedeva «tieni il movimento ma fallo notturno» otteneva,
nella migliore delle ipotesi, una clip nuova filmata da zero: il difetto del gatto rosso, tornato
dalla porta del video.

Il secondo: **`videoRefineModel` era pinnabile e non faceva niente.** Lo slot esiste in
`set_media_model` da prima di questo percorso, `MEDIA_MODEL_JOBS` lo descrive come *«rewrites a clip
that already exists, keeping its movement»*, il selettore lo offre, `video-models.ts` sa quale
modello lo serve (`runway/aleph`, l'unico) — e nessun tool dell'API lo chiamava. Un brand poteva
sceglierlo e la scelta restava lettera morta. La capacità sotto c'era già: `transformVideo(role:
'refine')`, viva e in produzione, raggiungibile **solo** dal tool di chat `refine_video`.

Come per il gatto rosso: qui non si è costruito un motore, si è smesso di nasconderne uno.

## Il tipo non si chiede: si legge

`refine_media` **non ha un parametro `kind`**, ed è la decisione che regge tutto il resto. Il tipo
di un asset è già scritto in `brand_media.kind`: chiederlo di nuovo a chi chiama vuol dire tenerne
due copie, e le due divergono alla prima chiamata sbagliata — «rifinisci questo video», `kind:
image`, e il motore delle immagini che riceve un mp4. Un test lo tiene fermo: un `kind` nel corpo è
`invalid_input`, non un'indicazione da credere.

Il dispatch è **una tabella, non una catena di `if`**:

```
REFINERS = { image: refineLibraryImage, video: refineLibraryVideo }
```

Il tipo successivo è una riga qui, accanto alle altre, e nessun ramo sparso altrove deve saperlo.

Le **grafiche non sono una riga**, e non è una dimenticanza: in `brand_media` un logo o
un'illustrazione **è** un'immagine — `kind` vale `image`, ed è `media_kind` del catalogo a
distinguerle — quindi le rifinisce il motore delle immagini senza che nulla debba saperlo. Il
motion graphic programmatico (Remotion, `motion_write`) non è un render generativo: non ha un
modello da chiamare e non passa di qui.

## Quello che è stato scartato

**`motion_control` dentro `refine_media`.** `videoMotionModel` è l'altro slot pinnabile che nessun
tool dell'API chiama, e la tentazione di prendere anche quello era forte. Non ci è entrato:
prendere il movimento da un video guida e applicarlo a un soggetto in una still **non è
«correggere questo asset»**. Vuole un secondo ingresso, ha un'altra intenzione, e infilarcelo
renderebbe ambigua proprio la descrizione che deve rendere impossibile confondere «parti da questo»
con «fanne uno nuovo». Resta scoperto, ed è annotato in `docs/mcp-tools.md`.

**Cancellare `generate_image`, `generate_video`, `generate_carousel`.** La richiesta era metterli
sotto `generate_media`. Misurati uno per uno, `generate_media` **non ne copre per intero nemmeno
uno**: non ha `base_media_id`, non ha `duration`, non ha `brief` né i `continuity_tokens`, non
lavora senza brand e non sa spegnere il look del brand. Ed è la porta **più vecchia** delle due —
`96dc587e` alle 17:04, i tool espliciti un'ora dopo — con il suo stesso contratto che dice di
preferire quelli. La tabella completa sta in `docs/mcp-tools.md`.

## Il soffitto, dichiarato

`transformVideo` è sincrono e il suo poll arriva a 600s; la funzione muore a 300. Senza un tetto
proprio il client non riceve un errore, riceve una connessione che cade. Qui il poll si ferma a
280s, quindi la risposta esiste e dice `render_failed`.

**Non è risolto, è dichiarato**: una clip più lenta di così resta pagata e non consegnata. La strada
per toglierlo è la coda `video_renders`, che `generate_video` usa già — si sottomette, si torna con
un `job_id`, e il reconciler del cron deposita. Non è stata presa qui perché
`submitVideoRender` parla l'API a job e Aleph vive su un endpoint suo, in camelCase: adattare la
coda è un lavoro a sé, e mescolarlo a questo avrebbe reso illeggibili entrambi.

## Senza modello si rifiuta

Un brand che non ha mai scelto un modello di refine video riceve `no_refine_model` (400), non una
clip nuova. È la stessa regola dell'immagine sorgente che non esiste: **ricadere sulla generazione
è il difetto travestito da rimedio**, perché chi chiama paga un render credendo di aver corretto il
suo. Il test lo tiene fermo controllando che `transformVideo` non sia partito affatto — se parte,
qualcosa è stato fatturato.

## Le superfici allineate

Togliere un tool rompe chi lo aveva cablato, e il posto dove un agente scopre il sostituto è la
prosa che legge, non un changelog. Quindi: le descrizioni dei tool rimasti che nominavano
`refine_image` (`generate_image`, `generate_carousel`, `regenerate_post_media`, `generate_media`),
`SKILL.md`, `references/tools.md` e i loro mirror nel plugin, `docs/mcp-tools.md`.

`findability.test.ts` è ciò che lo tiene onesto: la riga «make this photo red» ora punta a
`refine_media`, e ce n'è una nuova — «change this video I already made» — che pretende le parole
`change`, `video`, `library` **sia** nella descrizione **sia** nella skill. Nessun comando della CLI
chiamava questi tool, quindi lì non c'era niente da sistemare.

## Come si è verificato che i test misurino qualcosa

I cinque test del video passavano al primo colpo, che è il sintomo di un test che non prova nulla.
Sostituita la riga `video` della tabella con il refiner delle immagini: quattro su cinque sono
diventati rossi, e il quinto — `kind_not_refinable` — non dipende da quella riga. Ripristinata, di
nuovo verdi.
