# La grafica renderizzata da un browser, non da satori

## Il difetto, misurato

Il compositore chiede al modello **«full HTML with `<style>`»** e poi passa quell'HTML a **satori**,
che è un sottoinsieme stretto di flexbox: niente `grid`, niente `clamp()`, niente
`text-wrap: balance`, niente percentuali su `max-width`. Un sorgente che in Chrome sta in piedi lì
trabocca e si sovrappone.

E il gate non poteva vederlo: `inspectGraphicTree` ispeziona l'albero **dichiarato**, e il suo unico
controllo di posizione scatta solo su un blocco `position: absolute` interamente fuori tela. Non
misura larghezze, non conosce estensioni, non vede sovrapposizioni. Così una headline italiana da
46 caratteri è uscita tagliata su due lati, con due blocchi disegnati uno sopra l'altro, come
`success: true`. Due volte di fila — perché il modello riscrive l'HTML a ogni composizione: non è
sfortuna, è una lotteria a ogni chiamata.

**Il percorso a blocchi non ha questo problema.** `renderGraphic` con `graphicTree`, `col()`,
`breathe()` e la riduzione automatica della headline rende lo stesso contenuto perfettamente —
verificato. Ma i tool di chat non lo usano: prendono `composeAndRenderGraphic`, che è HTML libero.

## Perché il motion non si rompe, e la grafica sì

Tre differenze, e il TSX non è quella che conta:

1. **Il renderer è un browser vero.** Remotion gira in Chromium; satori no.
2. **I gate rifiutano davvero.** `motion_edit` salva attraverso gli stessi compile e craft gate, e
   una violazione sul sorgente risultante non salva nulla. Il gate grafico produce avvisi.
3. **L'agente vede i frame.** `motion_stills` allega immagini vere.

## I numeri, perché il primo era fuorviante

Prima misura: **6.6s per uno still**. Con quel numero questa strada si scartava.

È sbagliato: comprendeva il boot di Chromium e il bundle della composizione. Con la composizione
**bundlata una volta** e il serveUrl riusato:

```
bundle 1350ms (una volta)  |  still: 237ms, 221ms, 201ms
```

**~220ms a grafica.** Un carosello da dieci slide è ~2.2s, non un minuto.

## Come è costruito

Una composizione sola, `src/remotion/Graphic.tsx`, che riceve il sorgente come prop e lo **compila
nel browser** con sucrase. Così un render non paga mai un bundle: `renderStill` riusa sempre lo
stesso serveUrl, e il bundle è una `Promise` memorizzata per processo — due render concorrenti al
primo colpo aspettano lo stesso bundle invece di farne due.

L'entry point è dedicato (`graphic-entry.tsx`) e registra **solo** `Graphic`. Non `Root.tsx`, che
monta anche Design e MotionAd e importa `$lib/design/schema`: il bundler di Remotion è webpack con
la sua configurazione e non conosce gli alias di SvelteKit.

Se la compilazione del sorgente fallisce il render **fallisce**, invece di consegnare una tela
bianca: un PNG vuoto che si spaccia per riuscito è peggio di un errore, perché arriva all'utente.

## Spento di default, e il ripiego non è una formalità

`GRAPHIC_RENDERER=chromium` lo accende. Senza, `renderGraphicWithChromium` torna `undefined` e si
scende su satori.

`undefined` e non un'eccezione, di proposito: `@remotion/renderer` si porta un Chromium da **193 MB**,
e finché un deploy non lo dimostra montato e caldo, un percorso che fallisce senza rete di sicurezza
toglierebbe le grafiche invece di migliorarle. Il test che conta è proprio quello: acceso ma rotto,
torna `undefined`.

## Sul server lungo i dubbi del serverless non esistono

Il repo ha già `DEPLOY_TARGET=node` (`svelte.config.js`, `npm run build:node`, `infra/app/Dockerfile`,
`docs/SELF_HOSTING.md`). Lì Chromium si installa una volta nell'immagine, il bundle si fa all'avvio
e i 220ms valgono sempre: niente cold start, niente `includeFiles`, e i 215 MB non contano contro
nessun limite di pacchetto.

Due cose che quel percorso pretende, e nessuna è ovvia:

**L'immagine è Alpine, quindi musl.** Il Chromium che Remotion scarica è compilato per glibc e su
musl NON parte — e il sintomo è un render che fallisce senza mai nominare la libc. Il compositor
nativo un musl ce l'ha (`compositor-linux-x64-musl` fra le optionalDependencies), quindi manca solo
il browser: `apk add chromium` e `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser`. Verificato
costruendo l'immagine: Chromium 152.0.7977.64 su Alpine.

**I font non sono un extra.** Un Alpine nudo non ne ha nessuno: il testo esce a quadratini dentro un
PNG che per il resto sembra riuscito — un difetto che passa ogni controllo automatico e si vede solo
guardando. `font-noto`, `font-noto-emoji`, `ttf-dejavu`.

E il bundle si prepara all'AVVIO, non alla prima grafica: senza, il primo utente dopo ogni deploy
paga 1.35s che nessun altro pagherà.

## Cosa manca prima di accenderlo

**Non l'ho misurato dentro una funzione Vercel.** Servono tre cose che solo un deploy di preview può
dire:

- che `node_modules/.remotion/chrome-headless-shell` finisca **nel bundle della funzione** — se non
  c'è, Remotion lo scarica a ogni cold start: 93 MB, inaccettabile;
- il cold start con ~215 MB in più;
- la memoria che Chromium chiede in quel runtime.

Il binario Linux esiste — `@remotion/renderer` dichiara `compositor-linux-x64-gnu` e `-musl` fra le
`optionalDependencies`, quindi `npm install` in build prende quello giusto da solo. Il limite
pacchetto è 5 GB: 215 MB non è un problema di dimensione, è un problema di montaggio.

## Non fatto qui

I **gate che rifiutano**, che sono la seconda metà del perché il motion regge. Un browser vero
elimina la classe di difetti nata dal renderer sbagliato; non elimina una composizione brutta ma
contenuta. Il gate misurato sui pixel — inchiostro nella zona di bleed su fondo piatto — resta da
scrivere, e ora ha senso scriverlo sul PNG di Chromium invece che su quello di satori.
