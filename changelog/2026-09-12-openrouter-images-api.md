# I GPT Image 2.5 nel catalogo, e come default

## La porta che non avevamo guardato

Per due volte `openai/gpt-image-2.5-*` è sembrato inesistente. Non lo era: le prove erano fatte
nel posto sbagliato. `GET /api/v1/models` elenca i modelli di CHAT (445, nessun gpt-image), e
`POST /chat/completions` risponde 404 — ma il 404 lo dice per esteso, e solo se non si manda
`modalities`, altrimenti il messaggio parla di modalità e non di endpoint:

    openai/gpt-image-2.5-sunburst is an image generation model and cannot be used with the
    chat/completions endpoint. Use the /api/v1/images endpoint instead.

Il loro catalogo è `GET /api/v1/images/models`: 52 voci, ognuna con i parametri che accetta.

## Cosa è stato misurato, il 2026-09-12, contro l'endpoint vero

|                        | tempo   | costo     |
|------------------------|---------|-----------|
| sunburst, da zero      | 15,0s   | $0,0053   |
| flare, da zero         | 10,5s   | $0,0053   |
| sunburst, con riferimento | 15,6s | $0,0171   |
| gemini-3.1-flash-image @openrouter (oggi in produzione) | 13,3s | $0,0748 |

Quattordici volte meno per un'immagine disegnata da zero, quattro per una modificata, a parità di
tempo. Il render di verifica nell'app: **$0,00635 contro $0,0337** dello stesso prompt sullo stesso
brand cinque minuti prima.

## Le tre trappole dell'endpoint

1. **`input_references` ha una forma sola**: `[{type:'image_url', image_url:{url}}]`. Le altre
   quattro provate tornano 400 — tranne `image:`, il nome che verrebbe da OpenAI, che torna **200 e
   ignora l'immagine**. Chiesto «rendi verde questo limone», è arrivata una limonata inventata da
   zero. Il costo lo conferma: $0,0060 quando il riferimento cade, $0,017-0,025 quando viene letto.
   Un successo che ignora metà della richiesta è il guasto peggiore di tutti.
2. **`aspect_ratio` è un elenco chiuso e 4:5 non c'è.** È il formato di un post Instagram. Si chiede
   in pixel con `size`, che l'endpoint onora esattamente (1024x1280 chiesto, 1024x1280 tornato, sei
   volte su sei e anche insieme ai riferimenti) pur non essendo fra i parametri dichiarati. Il nome
   quando c'è, i pixel quando no: due strade e nessuna terza.
3. **La risposta è `data[0].b64_json` + `media_type`**, non `choices[].message.images`.

## Cosa è cambiato nel registro

`gpt-image` è la prima famiglia con UN endpoint solo, e il ripiego non poteva più essere per
endpoint: `HOME` poi kie avrebbe prodotto `gpt-image@kie`, una rotta che nessuno serve e che si
legge come rispettata mentre atterra altrove. Ora, quando la famiglia scelta non è servibile da
nessuna parte, si cambia FAMIGLIA: `SLOT_RESERVE` dice quale, per slot, invece di dedurlo.

E il default del modello non è più una costante: `defaultImageModel()` LEGGE la rotta. Erano due
decisioni separate — la famiglia su cui instradare e l'id da mettere nella richiesta — e il
trasporto si sceglie sull'id: una rotta `gpt-image@openrouter` con dentro un id Gemini sarebbe
finita sul trasporto di Gemini. È successo davvero, durante lo sviluppo, e l'ha fatto vedere solo
`ai_calls`.

Sunburst e non Flare come default: stesso prezzo, 15,0s contro 10,5s, ma è il taglio di precisione
— e qui dentro le immagini portano testo, che sbagliato si rifà.
