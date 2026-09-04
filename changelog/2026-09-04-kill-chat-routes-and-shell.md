# Via le rotte della chat e il guscio che la montava

Terzo passo, e il primo che si vede. Spariscono le rotte della chat
(`/app/[brand]/chat/**`, 7.586 righe), la pagina delle impostazioni chat,
`/api/v1/chat/feedback`, il comando `anomalia ai` e il tool MCP `chat`.

## La home del brand

`/app/[brand]` **non aveva contenuto proprio**: il suo corpo era il `ChatColumn`
montato dal layout, e il commento in `+page.svelte` lo diceva in una riga —
«Overview content is the ChatColumn composer mounted by the brand layout». Tolta
la chat sarebbe rimasta bianca.

Ora è un redirect a `/app/[brand]/workbench`, che esiste già e regge da solo:
`loadHomeOverview` non tocca né la chat né il suo store. Due righe, e si torna
indietro con un revert se la scelta non piace.

Ne guadagna anche il primo pixel: quelle ~30 query di `loadHomeOverview`
partivano solo aprendo il workbench, e questo non cambia — cambia che il
workbench è dove si atterra.

## Il guscio, che era più intrecciato di quanto sembri

Le rotte non erano foglie: mezzo prodotto ci navigava dentro.

- **`+layout.svelte`** (1.033 → 763) montava `ChatColumn` come home, decideva il
  titolo del topbar dall'agente del thread, teneva il pallino dei non letti e
  passava il thread al canale Realtime.
- **`DashboardSidebar`** (1.598 → 1.013) aveva la lista dei thread con rinomina,
  cancellazione, non letti, menu portalato su `<body>` e ricerca. Via anche il
  prop `teamFirst`, che serviva solo a decidere se i thread stessero sopra o
  sotto gli Spazi.
- **`CommandPalette`** (902 → 711) cercava agenti, thread e messaggi: tre dei sei
  gruppi erano chat. Restano pagine, impostazioni e azioni.
- **`PageTopBar`** aveva il bottone "Parla con \<agente\>", che portava al thread.
- **`HomeWorkbench`** (1.992 → 1.759) aveva tre CTA verso il composer e il banner
  di onboarding.
- **`AgentEmptyOffer`** era interamente "vai a parlare col tuo agente": eliminato,
  e con lui le tre righe che lo montavano in competitors, keywords e leads.

## L'onboarding non atterra più in chat

`setupChatTarget` creava il thread di setup e ci mandava l'utente. Ora i quattro
punti di atterraggio vanno sulla shell del brand, che redirige al workbench —
lo stesso ripiego che la funzione aveva già in caso di seed fallito.

Attenzione ai due punti dove le variabili non erano `brand`: uno usa `bySite`
(recupero di un tentativo precedente) e uno una `slug` locale.

## Il metodo: cercare gli orfani prima, non dopo

Per ogni cosa cancellata, `git grep` di quello che esporta. Ha già evitato tre
danni:

- **`agent-owners.ts` resta**: `TeamRoster` usa `TEAM_SPECIALIST_IDS` e
  `JOB_OWNERS`, `AgentComputerPanel` usa `JOB_HOME`/`AGENT_HOME`. Via solo
  `jobThreadHref`, `owningJobForPath` e `SEGMENT_OWNER`, che non li usava più
  nessuno.
- **`.ov-ai` in HomeWorkbench resta**: sembrava la classe dei due bottoni "chiedi
  all'AI", la usa anche il pager della coda di revisione.
- **`chat-agent-panel-pref.ts` se ne va**: il suo unico consumatore era la pagina
  del thread. Verificato, non assunto.

## I test che leggono i sorgenti per path

Sono la trappola di questo lavoro, ed è già costata una CI rossa nella PR delle
chat per-post: `git grep` di un simbolo non trova `'src/routes/app/[brand]/chat/
+server.ts'` dentro una lista.

- Cancellati con ciò che testavano: `kit-parity.test.ts` (leggeva la pagina del
  thread e `kit-run.ts`), `chat-agent-panel-pref.test.ts`.
- Sfoltiti perché coprono anche codice VIVO: `token-budget` e
  `ask-user-blocking` (restano due motori su quattro), `room-beat` (via il blocco
  del turno interattivo), `chat-dm` e `chat-expression` (restano `ChatColumn` e
  `ChatLiveStatus`), `topbar-cta` (le asserzioni su `TopbarCta` e `PageTopBar`
  valgono ancora, quelle sulla pagina no).
- `shortcuts`: `n` (nuova chat) e `/` (fuoco sul prompt) non esistono più. Il
  test della guardia della palette resta, con `?` al posto di `n`: la regressione
  che documenta — un tasto singolo che agisce dietro l'overlay — è ancora
  possibile.

## Cosa NON è stato toccato

`src/lib/server/chat/` e i componenti `Chat*` restano: li importano ancora i
generatori e venti file non-chat sotto `src/lib/server`. Scendono nei passi
successivi, dopo aver estratto i simboli condivisi.

`HomeChatMockup.svelte` e `/tools/agent-team` restano: sono marketing, autonomi,
e la scelta è di Andrea.

## Tabelle non toccate

`chat_threads`, `chat_messages` e le altre restano. Nessuna migration.
