# Il server MCP remoto si ridispiega di nuovo

`mcp.anomalia.so` serviva la build del 12 agosto. Non era una regressione recente:
il progetto Vercel `anomalia-cli` non completava un deploy da allora, e ogni build
di produzione moriva sempre sulla stessa riga.

```
Error: The pattern "api/mcp.js" defined in `functions`
doesn't match any Serverless Functions inside the `api` directory.
```

Tre affermazioni nel repo non potevano essere vere insieme: `cli/mcp/package.json`
diceva che gli handler erano prebundlati sotto `api/`, `cli/.gitignore` li teneva
fuori da git per sempre, e sotto `cli/mcp/` non c'era nessuno script che li
generasse. Il generatore stava in `cli/scripts/build-vercel.mjs`, un livello sopra
la Root Directory del progetto (`cli/mcp`): irraggiungibile da lì, quindi mai
eseguito.

## Il fatto che decide la forma della soluzione

Vercel valida i pattern di `functions` **prima** di installare e prima di eseguire
il build command. Verificato con `vercel build` in locale sulla stessa versione
della CLI che gira in cloud (59.11.7): con `installCommand` e `buildCommand`
impostati, l'errore usciva comunque e `node_modules` non veniva nemmeno creata.

Quindi niente di generato a build time può soddisfare `functions`. I file nominati
lì devono stare in git.

## Cosa è stato provato e scartato

**Lasciare che `@vercel/node` compili direttamente le entry TypeScript** — cioè
`api/mcp.ts` che importa `../vercel-handler.ts`, buttando via del tutto il
prebundle esbuild. Il build passa, le tre funzioni vengono prodotte, e a runtime
la funzione è morta:

```
ERR_MODULE_NOT_FOUND: .../api/mcp.func/cli/mcp/vercel-handler.ts
```

`@vercel/node` traspila l'entry ma lascia intatto lo specifier `.ts`, che Node non
risolve. È esattamente il motivo per cui il prebundle esisteva. Farlo funzionare
vorrebbe dire riscrivere ogni import di `cli/mcp/` e `cli/lib/` da `.ts` a `.js`,
rompendo Bun ovunque.

**Committare `_bundle.js`** — 3,8 MB rigenerati a ogni cambio di dipendenza, dentro
git. Funziona e non lo vogliamo.

## Come è fatto adesso

I due wrapper sotto `cli/mcp/api/` sono **sorgente**, non artefatti: tre righe
ciascuno, stabili, committate. Sono ciò che Vercel vede quando valida `functions`.
Solo `_bundle.js` resta generato, e lo genera il `buildCommand` in `vercel.json`,
che è anche l'unico posto dove il deploy è descritto:

```
"buildCommand": "npm install --prefix .. && node ../scripts/build-vercel.mjs"
```

L'install sta lì dentro perché `installCommand` in `vercel.json` viene ignorato —
provato con la marker string, non stampa mai. Le dipendenze restano dichiarate in
un posto solo, `cli/package.json`.

`build-vercel.mjs` scende da 110 righe a 25: non scrive più i wrapper (ora sono
sorgente), non copia più `health.js` in `cli/api/` "se mai la Root Directory
diventasse `.`", non spazza più file stale che non produce più nessuno.

`cli/mcp/entries/` era già morto — nessuno lo importava — ed era la terza
dichiarazione in concorrenza di cosa sia l'entry point. Rimosso.

`outputDirectory: "public"` con dentro un `robots.txt`: serve perché con un
`buildCommand` Vercel pretende una directory statica non vuota, e come effetto
smette di pubblicare il sorgente. Prima `mcp.anomalia.so/vercel-handler.ts`
rispondeva 200, file di test inclusi.

## Il guardiano

`cli/mcp/vercel-config.test.ts` fallisce se un pattern di `functions` nomina un
file che git non traccia. È il difetto esatto, ed è l'unica cosa che lo avrebbe
preso: il codice era corretto, il deploy no.

## Cosa cambia lato remoto

La superficie remota prende sei mesi di modifiche in un colpo solo: da 63 tool
(agosto, incluso `chat` che non esiste più) a 125. Arrivano `query`,
`generate_image`, `refine_image`, `generate_video`, `create_post`, `list_media`,
`diagnose_brand` e il resto. Chi puntava a `mcp.anomalia.so` e vedeva tool vecchi
vedrà quelli di oggi al primo deploy.
