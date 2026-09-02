# Il modello che disegna, scelto dal brand

Il modello video il brand lo sceglieva da mesi (Settings → Video, `content_prefs.videoModel`);
quello delle immagini no: era deciso dentro `buildImageRequest`, con una regola ragionevole
(riferimenti da riprodurre ⇒ Lite, altrimenti `IMAGE_MODEL_NO_REF || BLOG_IMAGE_MODEL`) che
nessuno poteva scavalcare senza un deploy.

Ora c'è `content_prefs.imageModel`, la riga accanto a quella del video, e la regola di prima resta
il default: **vuoto significa "decidi tu"**, non "Lite". Un brand che non tocca nulla renderizza
esattamente come ieri.

## Il catalogo è una tabella, perché su kie ogni modello è un dialetto

Sei modelli, tre famiglie nuove oltre ai Nano Banana, e **nessuno di loro chiama le cose allo
stesso modo** sullo stesso `POST /jobs/createTask`:

| modello | riferimenti | rapporto | dimensione | id separati t2i/i2i |
|---|---|---|---|---|
| nano-banana-pro / -2 | `image_input` (8) | `aspect_ratio` | `resolution` | no |
| nano-banana-2-lite | `image_urls` (10) | `aspect_ratio` | — | no |
| seedream/5-pro | `image_urls` (10) | `aspect_ratio` | `quality` basic/high | **sì** |
| gpt-image-2 | `input_urls` (16) | `aspect_ratio` | `resolution` | **sì** |
| qwen3/pro | `image_urls` (3) | **`image_size`** | `resolution` | **sì** |

Le differenze stanno tutte in `$lib/image-models.ts`, una riga per modello, e `buildKieImageInput`
compone il payload da lì invece che da una catena di `if`. Una famiglia nuova è una riga.

## Le due cose che i documenti non dicono e la misura sì

**GPT Image 2 rifiuta 4:5 a 2K.** `createTask` risponde `500 "aspect_ratio is not within the range
of allowed options"`; lo stesso 4:5 a 1K passa, e 9:16 a 2K passa. In produzione
`KIE_IMAGE_RESOLUTION=2K`, quindi senza la riga `ratios1KOnly` **ogni post Instagram** su quel
modello sarebbe fallito. Il formato è una decisione di prodotto e la risoluzione una manopola:
si abbassa la manopola, l'inquadratura resta.

**4:5 non esiste affatto su Seedream né su Qwen.** Ripiegare sul default `1:1` avrebbe cambiato in
silenzio l'inquadratura di ogni post verticale del brand, quindi `kieAspectRatio` sceglie il
rapporto servito più vicino in proporzione — 4:5 → 3:4, mai un quadrato.

Verificati vivi su kie, non dedotti dal listino: t2i e i2i di tutte e tre le famiglie accettati e
renderizzati (seedream 14 crediti, qwen3 12, gpt-image-2 6 a 1K e 10 a 2K, nano-banana-pro 18).

## Dove la preferenza entra, e dove no

Nei tre `renderOpts` di `creation.ts`, nel render del media generator e — il buco trovato
rileggendo, non scrivendo — dentro `renderPreviewImages`, che è **la produzione della settimana**:
sette chiamanti, nessuno passava un modello. Si legge lì una volta sola, come in
`generateStandaloneImage`, invece che in sette punti da ricordare.

La copertina UGC **non** la segue: quel modello è scelto per essere scadente e costare metà, ed è
una decisione estetica. E un `imageModel` esplicito (l'anteprima ospite) vince sempre sulla
preferenza del brand.

## Il ripiego su Google, che senza guardia era un 400

`route('image')` ripiega su Google quando la chiave kie manca. `seedream/5-pro-…` su Google non è
un modello: sarebbe stato un 400 su ogni immagine, proprio nel momento in cui kie non risponde.
`googleImageModel()` riporta al modello di casa e lo dice; solo i Nano Banana hanno un id Gemini
vero, ed è per questo che lo spec ha il campo `google` con `null` dentro per tutti gli altri.

**Scartato:** un endpoint nuovo e un picker duplicato nel `+` della chat. La voce è un `<a>` alla
pagina di Settings, come Connettori: una sola fonte della verità.

**Rimasto aperto.** `IMAGE_CREDITS` in `content-cost.ts` è la mediana misurata sul default: un
brand che pinna Pro (18 crediti) o Seedream (14) costa più di quanto il planner crede. E non c'è
gate di piano sulla scelta: se il modello deve diventare un upsell, è una decisione a parte.
