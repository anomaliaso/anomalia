# Via il desktop agentico: pannello, chiave VNC, immagine e agganci in sandbox.ts

Secondo pezzo dopo le rotte. Qui sparisce tutto il resto del desktop pilotato
dall'agente, e `sandbox.ts` torna a essere soltanto l'infrastruttura che apre una
macchina — che è quello che serve al rendering.

## Cosa sparisce

| File | Righe | Cos'era |
| --- | --- | --- |
| `sandbox-desktop/` (Dockerfile, `anomalia-desktop`, `build.mjs`, 3 xfconf) | ~490 | l'immagine XFCE + VNC + noVNC, `SANDBOX_DESKTOP_IMAGE` |
| `src/lib/components/AgentComputerPanel.svelte` | 894 | il pannello con lo screenshot e «prendi il controllo» |
| `src/routes/app/[brand]/chat/components/AgentComputerDock.svelte` | 45 | la colonna/Sheet che lo conteneva |
| `src/lib/server/agent-desktop.ts` (+ test) | 86 + 118 | la password VNC derivata per brand e `publishComputerRunning` |
| `src/lib/chat-agent-panel-pref.ts` (+ test) | 34 + 70 | la preferenza aperto/chiuso del pannello |

E gli agganci dentro `sandbox.ts`: `DESKTOP_DOMAINS` (i mirror apt da cui si
installava Xvfb), `publishComputerState()`, `DESKTOP_PORT` fra le porte di creazione,
e il ramo «a vista» di `BROWSE_SCRIPT` — che apriva Chromium con `headless: false` su
`DISPLAY=:1` quando trovava il socket X. Senza desktop quel socket non esiste mai: il
ramo era un tentativo che falliva e ripiegava, quindi ora si lancia headless e basta.

## Come ho provato che nessuno li raggiunge

`git grep` su ogni simbolo esportato (`agentDesktopEnabled`, `publishComputerRunning`,
`desktopPassword`, `desktopUrl`, `VNC_PASSWORD_LEN`, `DESKTOP_DOMAINS`,
`readAgentPanelPref`, `writeAgentPanelPref`) su `src`, `packages`, `cli`, `scripts`,
`tests`, `.github`, `vercel.json`. I chiamanti vivi erano sei, tutti sistemati qui:

- `chat/[thread]/+page.server.ts` — passava `agentDesktopEnabled()` alla pagina
- `chat/[thread]/+page.svelte` — montava pannello e dock
- `agent/bridge/live.ts` — filtrava `observe`/`act` dietro il flag; ora li filtra sempre
- `sandbox.ts` — l'import pigro di `publishComputerRunning`
- `sandbox-config.test.ts` — mockava `agent-desktop`; il test ora pinna il *nome* della
  VM per agente, che è la proprietà vera che restava sotto
- `agent-owners.test.ts` — leggeva il sorgente del pannello da disco

Quello che resta a nominare il desktop sono commenti in file di altri
(`ChatLiveStatus.svelte`, `PageTopBar.svelte`, `chat-session.ts`,
`graphical-bootstrap.ts`): prosa stantia, non codice, e non è roba mia da toccare.

## Il confine fra (A) e (B), e la trappola che ho evitato

`docker/sandbox/Dockerfile` e `scripts/build-sandbox-image.sh` **restano**, ed erano
sulla lista delle cose da togliere. Misurare prima di cancellare li ha salvati: quella
non è l'immagine del desktop, è l'immagine **con Chromium e Playwright dentro**, quella
che `SANDBOX_IMAGE` punta e che serve a renderizzare. Sono due Dockerfile diversi:

- `sandbox-desktop/Dockerfile` → XFCE, xfwm, x11vnc, novnc, xdotool → **(A)**, via
- `docker/sandbox/Dockerfile` → `playwright install chromium` e una prova di lancio
  dentro il build → **(B)**, resta

`SANDBOX_DESKTOP_IMAGE` **resta letta** in `sandbox.ts`, di proposito. Il commento
diceva che quell'immagine serviva a tutti — «chi rende un video e chi guarda il desktop
stanno sullo stesso disco» — quindi un progetto che oggi ha solo quella variabile
impostata renderizza da lì. Toglierla dal codice farebbe scivolare quel progetto sul
percorso che installa Playwright a runtime: una regressione di rendering decisa da un
cleanup. È un intervento sulla configurazione di produzione, non su questo file, e va
fatto spostando l'operatore su `SANDBOX_IMAGE`.

Il resto di `sandbox.ts` non si tocca: `openBrandSandbox`, `buildNetworkPolicy`, gli
holder, gli snapshot. È la catena che regge le grafiche e i video —
`design-render.ts` → `design-render-chromium.ts` → `motion-video/render-tools.ts` →
`openBrandSandbox` — e i 222 test di `design-render*` e `motion-video/` passano.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
