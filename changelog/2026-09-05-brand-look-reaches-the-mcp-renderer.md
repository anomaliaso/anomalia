# Il look del brand arriva al renderer anche da MCP

Guardando l'inventario dei tool, Andrea ha chiesto di `generate_image`: *«come fa
l'ai a mettere le image di reference che vuole? e mettere direttamente le foto dei
prodotti salvati? e le people del brand?»*

La risposta era «non può», in tutti e tre i modi. Ma sotto la domanda c'era un
buco più grosso del parametro mancante.

## Il motore regge sette canali, il percorso MCP ne usava zero

`RenderImageOpts` accetta `referenceImages`, `personImages`, `moodImages`,
`userRefImages`, `logoImage`, `baseImage`, più `visualStyle`, `visualPlaybook` e
`brandLook`. Le superfici dei post li riempiono tutte: `content-preview/creation.ts`,
`articles.ts`, `weekly-planner.ts`, `media-generator/agent.ts`.

`runImageJob` — il motore dietro `generate_image`, `refine_image`,
`generate_carousel` e `generate_media` — passava questo:

```ts
const opts = { model, refineModel, baseImage, aspectRatio };
```

Quattro campi su diciassette. Quindi **anche con lo slug, un'immagine generata da
MCP non aveva l'aspetto del brand**: niente palette, niente font, niente stile
visivo, niente playbook, niente logo. L'unica cosa che il brand contribuiva alla
propria immagine era quale modello la disegnava.

Ed era invisibile: nessun test falliva, perché nessun test guardava la richiesta
costruita. L'immagine tornava, `ok: true`, e il conto era giusto.

## Perché era rimasto indietro

Il montaggio del contesto visivo esisteva in cinque copie, tutte sul percorso dei
post — leggere `brand_kit`, mappare i font, chiamare `brandVisualDirective`,
`extractVisualPlaybook`, `loadBrandLogoImagePart`, `loadBrandMoodImageUrls`. Una
regola scritta in cinque posti diverge al primo posto nuovo, e il percorso MCP è
nato dopo: non ha divergito, si è semplicemente dimenticato di esistere.

Ora sta in `loadBrandVisualContext` (`content-preview/images.ts`), e il percorso
MCP lo legge come gli altri. Le cinque copie esistenti non sono state toccate:
riscriverle nella stessa PR avrebbe mischiato un riordino con un cambio di
comportamento, che è esattamente ciò che rende impossibile dire quale dei due ha
rotto cosa.

## Due strade, e solo una si piega

Andrea ha aggiunto la regola che completa il collegamento: *«anche l'opzione da
parte dell'ai di disattivare o meno l'utilizzo del brand kit nella generazione
delle img, da disattivare automaticamente se l'ai non setta uno slug»*.

- **Senza slug** (il percorso di `feat/brand-free-image`): non c'è un brand,
  quindi non c'è un kit. Non è una scelta, è un fatto — `job.brandId` è `null` e
  non si legge niente.
- **Con slug**: si applica di default, perché chi genera per un brand vuole che
  assomigli al brand. `brand_style: 'ignore'` lo spegne per l'immagine che dal
  brand non deve prendere niente — uno screenshot di UI, un'illustrazione su
  qualcun altro, uno sfondo neutro, dove palette e font sporcano il risultato.

Un **enum, non un booleano** (`AGENTS.md`): `brand_style: 'ignore'` si legge nella
chiamata, `use_brand_kit: false` no.

E il caso incoerente **rifiuta**. `brand_style` senza slug è una chiamata basata
su un fraintendimento: l'agente crede di governare qualcosa che non esiste.
`brand_style_needs_a_brand`, 400, prima di spendere, e il messaggio nomina la
mossa — *pass a slug, or drop brand_style* — non solo l'errore, o il modello
ritenta la stessa cosa.

Accettarlo e ignorarlo sarebbe esattamente come nasce un parametro che sembra
funzionare e non fa niente.

## Una promessa capovolta, in un commit solo

La descrizione che `feat/brand-free-image` spediva diceva testualmente *«nothing
about a brand's look reaches the model»*. Era vera, verificata su quelle righe.
Questa modifica la rende falsa con lo slug, quindi cambia insieme al codice in
quattro posti: il contratto, il mirror della CLI, `references/tools.md`, e
`SKILL.md` — che è la superficie letta **per prima**, e che non dicendo niente di
falso non avrebbe fallito nessun test.

Il test in `brand-free.test.ts` che asseriva la vecchia frase è andato rosso, ed
era il segnale che il giro era completo. Non è stato cancellato: asserisce la
verità nuova, e la sua nota dice perché è cambiato — un test la cui rottura
significa «la funzione è arrivata» è indistinguibile da un test rotto, per chi lo
legge dopo.

## Cosa resta fuori, di proposito

- **`generate_carousel` e `generate_media` non prendono `brand_style`.** Un
  carosello è per definizione una serie del brand, e `generate_media` è la porta
  storica che inoltra alle altre due. Entrambi ricevono il look di default, che è
  ciò che serviva; il campo si aggiunge con una riga se emerge il caso.
- **I riferimenti scelti dall'agente** (`reference_media_ids`) e **prodotti e
  persone citabili per id** sono i punti 2 e 3 del brief, e stanno in un'altra PR.
  Il punto 1 vale da solo: le immagini del brand smettono di essere generiche
  senza che nessuno debba chiedere niente.
- **`generate_video` ha lo stesso buco, e si chiude qui.** `RenderVideoOpts` un
  canale per lo stile visivo ce l'ha sempre avuto, e il percorso dei post lo
  riempie (`create-single/+server.ts` passa `visualStyle: profile.visual_style`).
  `startVideo` no: un clip chiesto da MCP tornava con lo stile di nessuno. Ora
  legge `brand_kit.visual_style` e lo passa — con una copertina il renderer lo
  scarta di proposito, perché il look sta già nei pixel del frame da animare, e
  quel comportamento non è stato toccato.

- **`brand_style` non c'è su `generate_video`, `generate_carousel` e
  `generate_media`, ma la sua assenza è dichiarata.** Un carosello per definizione
  è una serie del brand; `generate_media` è la porta storica; su un clip
  l'interruttore avrebbe un solo ramo dove significa qualcosa. Quello che serviva
  davvero era una frase per ciascuno che dice che l'interruttore lì non c'è —
  senza, un agente lo cerca, e il costo di un'asimmetria è la ricerca, non
  l'asimmetria.
