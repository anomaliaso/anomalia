# La grafica si renderizza dove il motion si renderizza già

## Cosa correggo, e perché era sbagliato

Le due PR precedenti mettevano Chromium **dentro il processo dell'app**: `@remotion/bundler` +
`renderStill` in-process, più `apk add chromium` nell'immagine self-host. Funzionava — l'ho
misurato, 220ms a grafica — ma è la strada che Remotion mette **per ultima** nella sua pagina SSR.
La prima è: *«The easiest way, especially for Vercel customers, is to use Vercel Sandbox.»*

E noi ci siamo dentro già. `render-tools.ts` lancia `npx remotion still` nella sandbox per i
fotogrammi del motion, riga 536. La sandbox:

- ha un **nome stabile per brand** (`sandboxName(brandId, agentId)`);
- è **condivisa, con holder e lease** — il commento nel codice lo dice: *«la VM è condivisa e un
  altro holder — un turno che sta ancora lavorando — la sta usando»*;
- **guida già Chromium** (`chromium.launch({ headless: true, args: ['--no-sandbox', …] })`);
- tiene i `node_modules` di Remotion **in cache**: `test -d …/node_modules/remotion` → *«render
  project cached»* → zero installazione.

Una grafica **è un motion video da un fotogramma**. Non serviva nulla di nuovo.

## Cosa sparisce da quello che avevo scritto

| | prima | ora |
|---|---|---|
| `@remotion/bundler`, `@remotion/renderer` | dipendenze dell'app | **rimosse** |
| bundle in-process | 1.35s da scaldare all'avvio | il progetto vive nella VM, già in cache |
| `warmGraphicRenderer()` in `hooks.server.ts` | c'era | **rimosso**: niente da scaldare |
| composizione + entry Remotion nell'app | due file | **rimossi** |
| Chromium nel pacchetto della funzione | il problema da risolvere | non si pone |

Restano gli **11 test** e la struttura del ripiego, che erano la parte giusta.

## Cosa resta di valido dal giro precedente

`infra/app/Dockerfile` con `apk add chromium` e i font. Non è sprecato: il **self-host non ha la
sandbox**, e lì `isSandboxConfigured()` è falso. Chi self-hosta e vuole il browser lo ha in casa; la
variabile `CHROMIUM_EXECUTABLE_PATH` che avevo aggiunto serve ancora a quello.

E i font su Alpine restano la lezione che erano: un Alpine nudo non ne ha nessuno, quindi il testo
esce a quadratini dentro un PNG che per il resto sembra riuscito — un difetto che passa ogni
controllo automatico e si vede solo guardando.

## Le tre uscite, tutte `undefined` e mai un'eccezione

`renderGraphicWithChromium` torna `undefined` — non lancia — quando: il flag è spento, la sandbox
non è configurata su questo deploy, o il render fallisce. Il chiamante ripiega su satori e la
grafica esce comunque.

Non è prudenza generica: un renderer assente che diventasse un'eccezione trasformerebbe un post con
un'immagine mediocre in **un post senza immagine**. Ognuna delle tre uscite ha il suo test.

## Il brand viaggia fino al renderer

`renderGraphicSource` ora accetta `brandId`/`userId` e i due chiamanti li passano. Non è cablaggio:
la sandbox è **per brand** e il tempo macchina si **addebita** (`withSandboxBilling`). Senza il
brand non c'è né la macchina giusta né a chi fatturarla, e infatti senza brand il renderer non parte
— con il suo test.

## Provato davvero, da localhost

```
esito: 83914 bytes in 20768ms   (prima volta)
esito: 83914 bytes in 19072ms   (seconda)
```

Con `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` in `.env` — le stesse credenziali che il
motion usa — `isSandboxConfigured()` è vero anche in locale, e il render gira. Il PNG è corretto:
tre righe di headline contenute, sottotitolo che va a capo da solo, footer in basso — con `grid`,
`clamp()` e `text-wrap: balance`, che satori non regge.

**~20s, non 220ms.** I 220ms erano in-process, senza VM. Qui il tempo è la macchina: apertura del
lease, scrittura del sorgente, `npx remotion still`. Le due misure quasi identiche dicono che non è
il boot a dominare — è il ciclo del comando dentro la sandbox.

Venti secondi vanno bene per una grafica chiesta in chat, e vanno misurati per `produce_week` con i
caroselli: dieci slide sono tre minuti abbondanti. Il flag resta spento anche per quello — prima
serve capire se le slide di un carosello possono condividere un solo `remotion still` invece di
dieci.

## Il flag va passato dall'ambiente

`$env/dynamic/private` sotto vitest non rilegge `.env`: scriverci dentro `GRAPHIC_RENDERER` lascia
il flag spento e il test passa **senza aver renderizzato niente**. Va passato davanti al comando.
È annotato nel test, perché è il modo esatto in cui questa verifica poteva mentire.
