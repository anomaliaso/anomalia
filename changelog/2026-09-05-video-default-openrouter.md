# I video vanno su OpenRouter, e kie resta la riserva

La strada l'ha costruita la PR dello slot video; questa ci manda il traffico. Una riga:
`SLOT_DEFAULT.video` da `grok-imagine@kie` a `grok-imagine@openrouter`.

## Il prezzo qui va nel verso opposto agli altri slot, e va detto

Sul testo lo spostamento era **a costo neutro**, sulle immagini **+17%** comprato in latenza. Sul
video si paga **il 500% in più**: $0,80 contro $0,132 per una clip da 10s a 480p su Grok Imagine,
misurato da entrambe le parti — kie dai render veri in produzione, OpenRouter da un addebito reale.

La ragione non è il prezzo. È che su kie il video **non arriva**:

| kie, `video.render`, 30 giorni | chiamate | falliti | medio | p95 |
|---|---|---|---|---|
| `bytedance/seedance-2-5` | 72 | **12,5%** | 248s | **382s** |
| `grok-imagine-video-1-5-preview` | 41 | **26,8%** | 49s | 91s |

Un video su quattro su Grok non arriva affatto, e su Seedance il p95 supera i **sei minuti**. È lo
stesso criterio con cui si sono spostate le immagini — lì il p95 di kie era 142,9s — solo che qui la
disponibilità si paga invece di essere gratis.

## ⚠️ La bolletta è ignota, e non è un modo di dire

Il +500% è misurato su **Grok Imagine**. Su **Seedance no** — e Seedance è **$114,11 dei $118 di
spesa video degli ultimi 30 giorni, il 97%**.

OpenRouter prezza Seedance **a token video** (`video_tokens: 0.0000107`), non al secondo, e la
tokenizzazione non è pubblicata. Le due formule plausibili danno **$0,82** o **$3,29** per 8
secondi: **a cavallo dei $1,81 che paghiamo oggi a kie**.

Quindi dopo questo cambio la spesa video può **dimezzarsi o raddoppiare**, e non lo sappiamo.
Andrea ha deciso col numero di Grok davanti e ha detto che il costo non è il criterio — ma «non è il
criterio» non vuol dire «è +500%»: la dimensione è ignota e si scoprirà dalla prima fattura.
**Un render misurato la chiude**, uno-tre dollari.

## Le due tabelle non devono coincidere

`SLOT_DEFAULT` dice dove va il traffico **quando funziona**; `HOME` dove va **quando OpenRouter non
è utilizzabile**. `HOME` per le tre famiglie video resta `kie`, che è il ruolo esplicito che Andrea
gli assegna: *«kie solo di riserva»*. Farle coincidere manderebbe il ripiego su OpenRouter — cioè da
nessuna parte — proprio quando OpenRouter è la cosa che non va.

### Un buco nella rete, trovato provandola

Il test che teneva fermo il vecchio default è stato **ribaltato, non cancellato**: adesso tiene
fermo il nuovo. Provandolo è venuto fuori che non sorveglia quello che sembrerebbe:

cambiando `HOME['grok-imagine']` in `openrouter` — cioè introducendo esattamente il difetto qui
sopra — **passano tutti e 32 i test**, perché l'ultima spiaggia di `route()` è `'kie'` scritta a mano
e recupera comunque. `HOME` giusto qui è quindi **ridondante e non sorvegliato**: chi lo cambia non
trova rete.

Non l'ho corretto — togliere l'ultima spiaggia o renderla derivata è un cambiamento al registro che
vale per tutti gli slot, non per il video. Sta scritto nel test, così la prossima persona lo trova
invece di riscoprirlo.

## Cosa NON cambia

- **La voce** resta su kie: OpenRouter non fa sintesi vocale, e sta in `MISSING`.
- **`refine` e `motion`** restano su kie senza consultare `AI_ROUTE_VIDEO`: partono da un video che
  esiste già, e `/videos` esprime `frame_images`, non un video in ingresso.
- **I render con `reference_*`** ripiegano su kie rumorosamente, perché OpenRouter non ha quei campi
  e girerebbero senza i riferimenti.
- **L'interruttore.** `AI_ROUTE_VIDEO=grok-imagine@kie` riporta tutto su kie senza deploy.
