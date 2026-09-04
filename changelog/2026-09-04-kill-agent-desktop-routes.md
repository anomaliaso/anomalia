# Via le rotte del controllo remoto del desktop agentico

Anomalia diventa un'interfaccia quasi headless per agenti esterni via MCP: il desktop
grafico pilotato dall'agente — schermo, tastiera, appunti, la finestra VNC — non è più
una funzione del prodotto. Questa PR toglie il primo strato, quello delle rotte.

Spariscono le sei rotte sotto `src/routes/app/[brand]/agents/computer/` e i loro due
test (797 righe in tutto):

- `screen/+server.ts` — lo screenshot della macchina, servito ogni 2.5s al pannello
- `input/+server.ts` — click e tasti spediti dentro la VM
- `clipboard/+server.ts` — lettura e scrittura degli appunti remoti
- `desktop/+server.ts` — l'accensione di XFCE/VNC/noVNC e l'URL con la password
- `status/+server.ts` — lo stato della computer per la card del pannello
- `+page@.svelte` — la pagina a schermo intero dove si prendeva il controllo

## Come ho provato che nessuno le raggiunge

`git grep 'agents/computer/'` su `src`, `cli`, `scripts`, `packages` non trova un solo
import: sono rotte SvelteKit, foglie per costruzione. L'unico chiamante vivo è
`AgentComputerPanel.svelte`, che le chiama per URL con `fetch` — e il pannello è già
spento in produzione: `agentDesktopEnabled()` vuole `AGENT_DESKTOP_ENABLED=1`, che non
è impostata. Il desktop era quindi già fuori dal prodotto per gli utenti; questa PR
toglie il codice, non una funzione che qualcuno stava usando.

Il pannello, `agent-desktop.ts` e gli agganci dentro `sandbox.ts` restano per la PR
successiva: qui si tolgono solo foglie, così un problema si legge subito.

## Il confine fra il desktop pilotato e la sandbox che renderizza

In questo repo «sandbox» sono due cose, e solo una se ne va.

**Va via** il desktop controllato dall'agente: `sandbox-desktop/` (XFCE e xfwm), le
rotte qui sopra, `agent-desktop.ts`, `graphical-bootstrap.ts` con `DISPLAY`,
`X_SOCKET` e `DESKTOP_PORT`.

**Resta** la sandbox per brand dentro cui gira Chromium per renderizzare, che è il
fossato del prodotto. La catena è:

```
design-render.ts
  └─ design-render-chromium.ts        renderGraphicWithChromium()
       └─ motion-video/render-tools.ts  renderGraphicStill()
            ├─ server/sandbox.ts        openBrandSandbox(), isSandboxConfigured()
            └─ server/sandbox-credits.ts withSandboxBilling()
```

`src/lib/server/sandbox.ts` **non si tocca**: chiama `@vercel/sandbox` (il pacchetto
npm) direttamente, e non importa niente da `packages/agent-adapters`. Il solo
riferimento a `adapters/vercel-sandbox.ts` che ci si trova dentro è un commento. Le due
metà sono quindi già separate all'origine: togliere il desktop non passa mai per il
codice che rende le grafiche e i video.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
