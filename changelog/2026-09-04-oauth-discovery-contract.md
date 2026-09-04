# La discovery OAuth è un contratto fra due documenti, e ora c'è un test che lo cammina

Un client MCP che si collega a `https://mcp.anomalia.so/mcp` non legge un documento: ne legge
due, e il secondo lo trova solo grazie a una stringa presa dal primo.

1. `GET https://mcp.anomalia.so/.well-known/oauth-protected-resource` (RFC 9728) →
   `authorization_servers: [<identificatore>]`.
2. All'identificatore il client attacca `/.well-known/oauth-authorization-server` e lo scarica
   (RFC 8414 §3.1).
3. Se quell'URL non risponde 200 — un 308 basta — un client che non segue i redirect in
   discovery si ferma qui. Smithery riporta
   `{"code":"oauth/auth_server_discovery_http_error","status":308}`.
4. Se risponde, RFC 8414 §3.3 pretende che `issuer` sia **identico byte per byte**
   all'identificatore del passo 1. Diverso → metadata rifiutati.

In produzione oggi il passo 1 dà `https://anomalia.so`, il passo 3 dà 308 e il passo 4 dà
`https://www.anomalia.so`. Rotto ai passi 3 e 4 insieme.

## Perché è sopravvissuto

Perché ogni URL, provato a mano, risponde 200. `https://mcp.anomalia.so/.well-known/...` → 200.
`https://www.anomalia.so/.well-known/oauth-authorization-server` → 200 con un `issuer` coerente
con l'host che l'ha servito. Anche `https://anomalia.so/.well-known/...` "funziona" in un
browser e in un `curl -L`: segue il redirect e mostra JSON valido. Il difetto non sta in nessun
documento, sta **nella relazione fra i due** — ed è visibile solo eseguendo l'algoritmo del
client per intero, incluso il passo che nessun handler può vedere: il 308 apex → www è un
redirect di *dominio* Vercel, applicato prima del routing del deployment, quindi nessun
`vercel.json` può escluderne `/.well-known/*` e nessun test che chiami solo gli handler lo
incontra.

Ed è anche il motivo per cui una asserzione stringa-uguale-stringa non bastava: ce n'erano già
due, una per lato (`cli/lib/config.test.ts`, `src/lib/server/app-url.test.ts`), verdi entrambe.
Nessuna delle due sa cosa afferma l'altra.

## Dove si produce l'identificatore

- `cli/mcp/http-router.ts` (rewrite `/.well-known/oauth-protected-resource` → `/api/oauth-protected-resource`,
  è la via di Vercel) e `cli/mcp/http-app.ts` (la via di Bun locale): entrambi chiamano
  `authServerUrl()`.
- `cli/lib/config.ts` — `authServerUrl()`: `PUBLIC_APP_URL` se è locale, altrimenti
  `PRODUCTION_URL` = `https://www.anomalia.so`.
- `src/lib/server/oauth.ts` — `issuerFor()` e `endpointsFor()`, entrambi `appOrigin(url)`.
- `src/lib/server/app-url.ts` — `appOrigin()`: origin della richiesta per localhost e per le
  preview `*.vercel.app`, origin della richiesta anche quando l'host registrabile combacia con
  `PUBLIC_APP_URL` (apex e www sono lo stesso host registrabile), altrimenti `PUBLIC_APP_URL`.
- `src/routes/.well-known/oauth-authorization-server/+server.ts` — il documento RFC 8414.

Su questo repo i due lati **combaciano già**: `authServerUrl()` dà www, e l'app servita su www
dà `issuer: https://www.anomalia.so`. Il test lo dimostra verde.

## Cosa è rotto allora

Il dominio `mcp.anomalia.so` non è servito da questo repo. Il progetto Vercel `anomalia-cli`
(`prj_oUOLCxXPSMiEggnTB2QqL0AcuFDd`) è agganciato al repo pre-monorepo
`andreabuttarelli/anomalia-cli`, la cui `authServerUrl()` ritorna tuttora `'https://anomalia.so'`
con un commento che documenta la decisione **opposta** ("deliberately the apex"), e la cui
ultima deploy di produzione è del 2026-08-12 — sedici giorni prima che CLI e MCP entrassero nel
monorepo. Il codice corretto esiste da prima dell'import e non è mai stato deployato lì.

La riparazione è ripuntare quel progetto su `anomaliaso/anomalia` con Root Directory `cli/mcp`
(dove vivono già `vercel.json` e `scripts/build-vercel.mjs`) e rideployare: un'azione sulla
dashboard, non una riga di codice. Finché non accade, la produzione continua a servire il
comportamento vecchio.

## Perché www e non "fai servire i metadata anche all'apex"

Valutata e scartata. Far rispondere `https://anomalia.so/.well-known/oauth-authorization-server`
sistemerebbe il passo 3 per i client che non seguono i redirect, ma quel 308 è un redirect di
dominio configurato sul progetto Vercel: si toglie solo togliendo il redirect apex → www e
riportandolo dentro l'app, cioè rifacendo la canonicalizzazione di tutto il sito per un
documento di discovery. www invece è già l'unico host che risponde 200: costa zero e chiude sia
il passo 3 sia il passo 4. Un solo identificatore, da entrambe le parti.

## Il test

`src/lib/server/oauth-discovery.test.ts` cammina l'algoritmo: prende l'identificatore da
`authServerUrl()`, applica il redirect di dominio (dichiarato come dato: apex → www, verificato
con `curl`), costruisce il documento RFC 8414 chiamando il `GET` della route, e pretende che
l'identificatore sia servito da sé stesso e che `issuer` ed endpoint stiano su quello stesso
origin. Gira con `PUBLIC_APP_URL` sia apex sia www, così l'accoppiata non dipende da come è
configurato l'ambiente.

L'anello che manca — che il documento RFC 9728 contenga davvero quel valore — è chiuso dal lato
CLI, dove i due handler che lo costruiscono girano davvero: `cli/mcp/http-app.test.ts` pretende
`authorization_servers` uguale a `[authServerUrl()]` sia da `handleMcpFetch` (Bun locale) sia da
`routeMcpHttp` (la via di Vercel). Prima asseriva solo che l'array non fosse vuoto.

Il test dell'app importa `cli/lib/config.ts` e non gli handler: quel file non ha import, mentre
`cli/mcp/*` usa specificatori con estensione `.ts` (obbligatori per Bun) che sotto il `tsconfig`
dell'app diventano 32 errori TS5097. Un test che aggiunge 32 errori al type-check non si merge.

Contro il codice che è in produzione oggi (apex) fallisce 5 test su 7 con
`expected 'https://www.anomalia.so' to be 'https://anomalia.so'`. Contro questo repo passa.
Coperti anche il dev locale (l'intera camminata resta sul dev server) e la preview
(`*.vercel.app` emette il proprio origin, mai quello di produzione).

Con il test dentro, i due commenti a blocco che spiegavano il vincolo — sopra `authServerUrl()`
e sopra `issuerFor()` — sono stati rimossi: dicevano la stessa cosa in due punti, citavano
`021-app` (un repo che non esiste più) e nessuno dei due poteva fallire quando la coppia si
fosse sfilata.

Nello stesso giro, le due asserzioni RFC 8414 di `oauth.test.ts` hanno smesso di leggere
`PUBLIC_APP_URL` dall'ambiente: passano per `appOrigin()`, quindi con il dev server di un altro
worktree esportato in `PUBLIC_APP_URL` fallivano
(`expected 'http://localhost:5223' to be 'https://www.anomalia.so'`) su codice che nessuno aveva
toccato. Ora l'env pubblico è fissato nel file, come già fanno `app-url.test.ts` e
`team-ignition.test.ts`.

## Changelog pubblico: assente di proposito

Questa PR non cambia niente che un cliente possa vedere. Il fix visibile — la discovery che si
completa da un client browser-based — arriva quando `mcp.anomalia.so` viene rideployato dal
repo giusto, e la riga pubblica va scritta in quel momento, non ora.
