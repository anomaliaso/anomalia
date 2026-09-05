# Dodici export morti dentro sei file vivi

Il secondo setaccio dopo i file interi (`2026-09-04-codice-morto-secondo-setaccio.md`). Qui i
file **restano**: se ne vanno dodici funzioni che nessuno chiama, più la variante `neutral` di
`TopbarCta` — **180 righe su sei file**.

## Il criterio, e perché è stretto

Lo scanner degli export trova 1.078 simboli non referenziati in `src/`, ma la maggior parte è
rumore: 659 sono tipi, e fra i 417 valori la maggior parte è usata **dentro** il proprio file —
lì l'unica cosa morta è la parola `export`, non il codice.

Quello che vale la cancellazione è l'intersezione: **valore, mai usato nemmeno nel proprio file,
e fuori da ogni perimetro attivo**. Sono 78. Di questi:

- quelli nelle librerie del patrimonio (`wall.ts`, `wall-media.ts`, `wall-digest.ts`,
  `design-judge.ts`, `preset-render.ts`, `playbooks.ts`) restano — `2026-09-04-librerie-fuori-dal-sito.md`;
- quelli nei `chat-*.ts` e in `stores/chat-session.ts` restano — quei file alimentano il media
  generator e il motion video, e il perimetro chat è di un altro agente;
- `web-push-client.ts` resta, perché è l'unico chiamante di `/api/push/subscribe`: toglierlo
  spegne le notifiche push in silenzio, e quella è una decisione di prodotto;
- `SETTINGS_ADS_SECTIONS` resta — perimetro impostazioni, di un altro agente.

Restano dodici, e ognuna ha **esattamente un'occorrenza in tutto il repository**: la propria
definizione.

## Cosa se n'è andato

**`shell-prefs.ts`** — `readChatPanePx`, `writeChatPanePx`, `readWorkbenchCollapsed`,
`writeWorkbenchCollapsed`, `readChatCollapsed`, `writeChatCollapsed`. Erano le preferenze dello
split chat/workbench, e lo split non c'è più. Con loro se ne vanno le tre chiavi che leggevano
(`chatPanePx`, `workbenchCollapsed`, `chatCollapsed`): `SHELL_PREF_KEYS` non lo itera nessuno,
quindi una chiave senza lettori è una stringa e basta. `CHAT_W_DEFAULT` e `CHAT_W_MIN` uscivano
solo via `SHELL_LAYOUT.CHAT_W_*`, che nessuno accede: l'unico consumatore,
`app/[brand]/+layout.svelte`, legge i tre `SIDEBAR_W_*`.

**`tool-guard.ts`** — `runUrlTool` («Every free tool follows this shape») e `traceRedirects`
(«Used by the redirect-checker tool»): i tool gratuiti sono stati ritirati in `25faba40`. Il
resto del file è vivissimo — `guardTool` ha sette rotte che lo chiamano, `safeFetchBytes` e
`safeFetchUrl` altre otto.

**`blog-site.ts`** — `listTags` e `listAuthors`. Le pagine del blog per tag e per autore usano
`listArticlesByTag` e `listArticlesByAuthor`, che risolvono tag e autore da sole; l'elenco
completo non lo chiedeva nessuno.

**`agent-avatars.ts`** — `chatFaceForPhase`, la faccia dell'agente per fase del turno.
`LOADING_FACE_CYCLE` e il resto del modulo restano: li usa `AgentAvatar`.

**`agent-icons.ts`** — `normalizeAgentIdForBrand`. `normalizeAgentId`, quello vero, resta.

**`TopbarCta.svelte`** — la variante `neutral`: il membro dell'unione, il `class:neutral` e
cinque blocchi CSS (`.neutral`, `:hover`, `:active`, `:focus-visible`, ` .topbar-cta-spin`).
Nessun chiamante passa `variant="neutral"` — `primary` e `ghost` sono le due che si usano. Era
già segnalata dal primo giro.

## La trappola evitata

Togliere `runUrlTool` e `traceRedirects` lascia `guardTool` con **una sola occorrenza dentro
`tool-guard.ts`**: la sua definizione. Contato dentro il file soltanto, sembrerebbe morto anche
lui. Non lo è — i chiamanti stanno in sette `+server.ts` sotto `api/tools/` e in
`start/preview/`. È la ragione per cui il conteggio si fa **su tutto il repository**, mai sul
file che si sta modificando.

## Verifica

- I 75 test che leggono un sorgente per percorso: **939 test verdi**. Nessuno di questi simboli
  compariva in una lista di stringhe.
- I test dei moduli toccati (`agent-icons`, `agent-owners`, `avatar-morph`, `start/preview`,
  `tool-guard`): **51 verdi**.
- `npm run check`: **345 errori e 201 warning prima e dopo**, insiemi identici. Zero errori nuovi.
