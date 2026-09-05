# Il default di un'immagine senza riferimenti passa a Nano Banana 2 Lite

Andrea ha chiesto **una** immagine dall'agente esterno. In `ai_calls` ne sono comparse **due**, a
46 secondi l'una dall'altra, `nano-banana-2` su kie, **$0,06 ciascuna**.

Il modello è il primo dei due difetti, ed è una riga. In `buildImageRequest`:

```ts
(needsFidelity ? NANO_BANANA_2_LITE : env.IMAGE_MODEL_NO_REF || BLOG_IMAGE_MODEL)
```

Il ramo **con** riferimenti era già passato a Lite nel 2026-08 — «Lite al posto di Pro su OGNI
superficie» — ma quello **senza** era rimasto su `BLOG_IMAGE_MODEL`, cioè il modello pieno. Ed è
il ramo dove cade la maggioranza delle immagini: un prompt e basta, nessuna foto da riprodurre.

La convinzione sbagliata era scritta in un test: si chiamava *«drops to the half-price tier with
no reproduction refs»* e asseriva `BLOG_IMAGE_MODEL`, che è il modello **più caro**, non il più
economico. Il nome diceva il contrario di quello che il codice faceva, e nessuno lo ha riletto —
la ragione per cui questo cambio arriva da una fattura invece che da una revisione.

## Cosa NON è cambiato

- **Il blog.** `blog-month.ts` e `content-preview/articles.ts` passano `model: BLOG_IMAGE_MODEL`
  esplicito, perché la batch API vuole quel modello e lì lo sconto del 50% della batch vale più
  della differenza di listino. Il default non li tocca, e un test lo tiene fermo.
- **Il modello di refine.** Modificare un'immagine è un mestiere diverso dal disegnarne una, e la
  scelta del brand su `imageRefineModel` resta sua.
- **Il ramo con riferimenti**, che era già Lite.

## Una cosa da sapere prima di fidarsi

`env.IMAGE_MODEL_NO_REF` **vince ancora** su questo default: è l'unico ramo che lo consulta, ed è
la via per riportare un ambiente sul modello pieno senza deploy. In `.env.example` è commentata,
quindi in teoria non è impostata da nessuna parte — ma se qualcuno l'ha messa nell'ambiente di
produzione, questo cambio non si vede. **Va verificato lì, non qui.**

Nessuna scrittura sui brand: tutti e 15 gli attivi hanno `content_prefs->>'imageModel'` nullo e
cadono su questo default, quindi la costante è l'unico posto da toccare.
