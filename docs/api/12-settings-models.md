# API — 12 · Impostazioni: modelli media

Due endpoint sotto `/api/v1/brands/:slug/settings/models`, che sono i tool MCP
`get_media_models` e `set_media_model`. Servono la stessa cosa che Settings → Images & video
mostra nel browser: **quale modello disegna e quale gira**, per questo brand.

Errori comuni di auth: vedi [01-overview](01-overview.md).

## I sei mestieri

Non sono gradini della stessa scala. Un modello che anima una foto può non avere alcun ingresso
video, e allora `videoRefineModel` per lui non è "peggio" — non esiste. Ogni mestiere offre
soltanto i modelli che quel mestiere lo fanno davvero.

| slot | mestiere |
|---|---|
| `imageModel` | disegna l'immagine di un post da un prompt |
| `imageRefineModel` | ridisegna un'immagine che esiste già, tenendo ciò che mostra |
| `videoModel` | gira una clip dalle sole parole, senza fotogramma di partenza |
| `videoImageModel` | anima una immagine che esiste già (di solito la cover renderizzata) |
| `videoRefineModel` | riscrive una clip che esiste già, tenendone il movimento |
| `videoMotionModel` | prende il movimento da un video guida e lo applica a un soggetto in una immagine |

La tabella che li governa è `src/lib/media-model-slots.ts`; i cataloghi per mestiere vengono da
`src/lib/image-models.ts` e `src/lib/video-models.ts`. La preferenza è salvata sul brand, in
`brands.content_prefs`, sotto la chiave omonima allo slot — non esiste una colonna dedicata e
questa PR non ne ha creata una.

Il **motion video scritto in codice** (Remotion/TSX) non è qui: è un programma renderizzato in
una VM, non un modello generativo, e non ha oggi nessuna preferenza per brand.

## `GET /api/v1/brands/:slug/settings/models`

Sola lettura: nessun modello chiamato, nessun credito.

**Response** `200`:

```json
{
  "brand": "demo",
  "slots": [
    {
      "slot": "imageModel",
      "job": "Draws a post image from a prompt.",
      "model": "gpt-image-2",
      "choices": [
        { "id": "nano-banana-2-lite", "label": "Nano Banana 2 Lite" },
        { "id": "gpt-image-2", "label": "GPT Image 2" }
      ]
    }
  ]
}
```

`model: null` vuol dire che il brand non ha scelto: renderizza il default di piattaforma. Un id
salvato che quel mestiere **non fa più** (il catalogo è cambiato) torna anch'esso `null`: il
renderer lo scarta già, e mostrarlo qui farebbe credere che sia in vigore.

## `PUT /api/v1/brands/:slug/settings/models`

**Body**:

```json
{ "slot": "videoRefineModel", "model": "runway/aleph" }
```

`slot` è uno dei sei; `model` è obbligatorio e può essere `null` per togliere la scelta e tornare
al default di piattaforma. Nessun modello chiamato, nessun credito: vale dal render successivo.

**Response** `200`: `{ "ok": true, "slot": "videoRefineModel", "model": "runway/aleph" }`

**Errori**

| status | error | quando |
|---|---|---|
| `400` | `invalid_input` | `slot` non è uno dei sei, o il body non è quello dichiarato |
| `400` | `model_not_for_slot` | il modello esiste ma non sa fare quel mestiere — il body porta `allowed` con gli id che sarebbero stati accettati |
| `403` | `API key is read-only` | chiave senza scope `write` (imposto in `resolveCaller`, non per rotta) |
| `500` | `update_failed` | la scrittura su `brands` è fallita |

La validazione sta nella **scrittura**, non nella lettura: un agente esterno può chiamare `PUT`
direttamente senza aver letto niente, e una preferenza salvata con un modello che quel mestiere
non fa sarebbe un guasto scoperto al primo render fallito, lontano da dove è stato causato.

## Cambiare il modello video ritocca la durata

Il tetto di durata è una capacità del modello: 30s esistono su Seedance 2.5, non su Grok. Se il
brand aveva salvato una durata che il nuovo `videoModel` non regge, la scrittura la riporta
dentro il tetto — altrimenti resterebbe una scelta che nessun render riesce più a onorare, e
Settings mostrerebbe un valore insalvabile. La regola vive in `chooseMediaModel`
(`src/lib/server/media-model-prefs.ts`), che è lo stesso codice che usa il form del browser.
