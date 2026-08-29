# Grok Imagine 480p è il motore video di default, Seedance 2.5 diventa opt-in

## Perché esiste

Seedance 2.5 veniva imposto come modello di default su tre percorsi — UGC Creator, UGC ad
(`ugcAd:true`) e lo steering dei prompt degli agenti — nonostante il routing del renderer
(`model-routing.ts`) puntasse già su Grok Imagine. Risultato: ogni clip partiva dal modello più
costoso al secondo anche quando il brand non l'aveva chiesto. L'utente ha chiesto di invertire la
regola: Grok Imagine (480p, già la risoluzione di default per il fatturato al secondo) diventa il
default per video e UGC, Seedance 2.5 si sceglie.

## Cosa c'era prima

Quattro siti forzavano `SEEDANCE_25_MODEL`:

- `video.ts` — `prepareVideoRender` sostituiva il modello con 2.5 quando `ugc && ugcAd`;
- `create-content-tools.ts` e `post-editor-tools.ts` — stesso forzante nel tool `create_post` /
  `make_video`, con il parametro `model` ignorato quando `ugc_ad:true`;
- `media-generator/agent.ts` — `lockedModel = isAd ? SEEDANCE_25_MODEL : ...`;
- `ugc-batch.ts` — fallback del batch UGC su 2.5, e forzante a 2.5 anche per un semplice first
  frame (che Grok accetta come `image_urls`).

Più i testi dei tool e dei system prompt che spingevano l'agente verso Seedance ("NEVER claim
Seedance is unavailable", `VIDEO ENGINE NOTE` costruito attorno a 2.5).

## La decisione

- **Il flag `ugcAd` non sceglie più il modello, sceglie solo il copione**: la durata 22s resta
  raggiungibile SOLO su Seedance 2.5 perché `ugcDurationCap` (già esistente e testato) dà il tetto
  22s solo a 2.5 e 15s a tutti gli altri — Grok incluso. Le regole di durata erano già
  model-aware; il forzante del modello era il pezzo incoerente, ed è stato tolto, non riscritto.
- **Il batch UGC cade su `GROK_IMAGINE_VIDEO_MODEL`** e la forzante a Seedance si restringe a ciò
  che Grok davvero non sa fare: remake da video di riferimento e reference audio. Il first frame
  (un'immagine) resta compatibile con Grok.
- **La UI (UGC Creator) di default seleziona Grok esplicitamente**, così il pannello riferimenti
  Seedance (frame/video/audio) si mostra solo quando il modello scelto li supporta. Caricare un
  video di riferimento continua a ribaltare su Seedance (`modelSupportsReferenceVideo`).
- **Costante nuova `GROK_IMAGINE_VIDEO_MODEL`** in `video-models.ts`: l'id del default non si
  ripete come letterale in prompt e componenti.
- Prompt e descrizioni dei tool dicono ora: default Grok Imagine 480p ≤15s; Seedance 2.5 su
  richiesta esplicita, oltre i 15s o con video/audio di riferimento. "NEVER claim Seedance is
  unavailable" resta: il selettore c'è ancora.

Scartato: mantenere 22s sugli ad anche su Grok (impossibile, tetto del modello a 15s) e un helper
centralizzato per la scelta del modello (ogni call site ha una catena di fallback diversa — tool
AI, Settings, default di routing — un'unica funzione la falserebbe).

## Cosa guarda il test guardiano

`video.test.ts` aggiunge `ugcDurationCap`: il flag ad non sblocca 22s senza Seedance 2.5, e su
Grok/null il tetto resta quello organico. La suite intera (5900) passa; i payload Grok di
`buildJobInput` erano già coperti.
