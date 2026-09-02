# Il modello che disegna, scelto dal brand

Il modello video il brand lo sceglieva da mesi (Settings → Video, `content_prefs.videoModel`);
quello delle immagini no: era deciso dentro `buildImageRequest`, con una regola ragionevole
(riferimenti da riprodurre ⇒ Lite, altrimenti `IMAGE_MODEL_NO_REF || BLOG_IMAGE_MODEL`) che
nessuno poteva scavalcare senza un deploy. Chi voleva Nano Banana Pro su tutto il brand non aveva
un posto dove dirlo.

Ora c'è `content_prefs.imageModel`, la riga accanto a quella del video, e la regola di prima resta
il default: **vuoto significa "decidi tu"**, non "Lite". Un brand che non tocca nulla renderizza
esattamente come ieri.

**Gli id sono quelli di Gemini, non quelli di kie**, ed è voluto: sono ciò che
`RenderImageOpts.model` già parla, `kieImageModel()` li traduce per kie (`nano-banana-pro`,
`nano-banana-2`, `nano-banana-2-lite`, verificati vivi su `POST /jobs/createTask` — pro accettato,
18 crediti) e senza chiave kie la stessa stringa è ancora un modello valido su Google. Un id kie
salvato sul brand sarebbe diventato un 400 il giorno del ripiego.

I tre id vivevano in tre file (`gemini.ts`, `content-preview/images.ts`) e ora vengono da
`$lib/image-models.ts`, client-safe come `video-models.ts`: il picker e il renderer non possono
più divergere.

**Dove la preferenza entra.** Nei tre `renderOpts` di `creation.ts` (post singolo, carosello,
immagine standalone) e nel render del media generator. La copertina UGC **non** la segue: quel
modello è scelto per essere scadente e costare metà, ed è una decisione estetica, non un default
da sovrascrivere.

`generateStandaloneImage` legge le prefs da sé — una `select` in più nel `Promise.all` che già
carica il brand kit — invece di farsi passare il modello dai cinque chiamanti: cinque posti da
ricordare sono cinque posti da dimenticare.

**Scartato:** un endpoint nuovo e un picker duplicato dentro il `+` della chat. La voce nel menu è
un `<a>` alla pagina di Settings, come Connettori: la PageModal la apre in overlay su desktop, e
la preferenza resta scritta in un posto solo.

**Non fatto, e perché.** Le altre famiglie che kie serve (Seedream 5, GPT Image 2, Qwen3, Flux-2,
Z-Image, Grok Imagine Image 2) non sono nell'elenco: ognuna è un dialetto diverso su
`/jobs/createTask` — Seedream vuole `image_urls` + `quality`, noi mandiamo `image_input` +
`resolution` — e nessuna esiste su Google, quindi il ripiego senza chiave kie non c'è. Aggiungerne
una è una riga in una tabella di dialetti che oggi non esiste, più una resa vera per misurarla.

`IMAGE_CREDITS` in `content-cost.ts` resta la mediana misurata sul default: un brand che pinna Pro
costa di più di quanto il planner crede. Va rimisurato quando qualcuno lo userà davvero.
