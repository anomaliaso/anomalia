# Sette tool MCP tolti: quattro letture che `query` diceva già, tre di autenticazione

La premessa da cui è partito il lavoro era che `query` fosse stato aggiunto **accanto** alle
letture e che i `get_*` / `list_*` fossero doppioni in attesa di essere ritirati. Aperti tutti i
44 handler GET del registro, non è così: **40 fanno lavoro che `query` non fa in una chiamata.**
Quattro erano davvero un `select`, e sono quelli che se ne vanno.

## Il criterio, e non è il nome

Si toglie quando l'handler è un `select` su una tabella che `query` sa nominare, con filtri e
ordinamenti che i suoi operatori esprimono. Si tiene quando aggrega o unisce tabelle a mano,
chiama un servizio esterno, applica una regola di piano che la riga grezza non porta — oppure
quando la riga grezza è più larga dei tetti di `query`.

L'ultimo caso è quello che decide quasi tutto, ed è anche quello che non si vede leggendo i nomi.
`query` taglia a 20.000 caratteri per risposta e 2.000 per valore singolo, **e il taglio è per
riga intera**: una lettura che "torna la stessa cosa" torna meno righe, non righe più corte.

## La misura, contro il database locale

60 post seminati sullo stack self-hosted con didascalie da 539 caratteri — la lunghezza vera di un
post, non una inventata:

| lettura | righe |
|---|---|
| `list_posts`, le sue 17 colonne, nessun tetto | **50 su 50**, 63.471 caratteri |
| `query` con le stesse 17 colonne | **15 su 50** |
| `query` senza `columns` (`select *`, 54 colonne) | **9 su 50** |

Su `brand_articles` lo stesso confronto dà **payload identico byte per byte, 20 righe su 20** — ma
solo a colonne nominate. Senza, `body_md` entra nella riga e ne sopravvive **una su venti**.

Questo è il pezzo che vale più della rimozione, e per questo non sta solo qui: sta nelle
`MCP_INSTRUCTIONS`, che il client mostra al handshake prima di ogni descrizione, e nella skill.
**Nomina le colonne, o il tetto si mangia la risposta senza dirlo.**

## Cosa se ne va

- `get_appearance` — `select` di sei colonne su `brand_kit`, 736 caratteri misurati, sotto ogni
  tetto. L'unica regola che aggiungeva era scartare il logo `og-image` (quello indovinato dal
  sito), e la riga porta quel `type` da sé. Era anche elencato in `docs/mcp-tools.md` fra i tool
  che "coniano quello che `query` non può" per via di un URL firmato: sbagliato, i logo passano da
  `getPublicUrl` e nella riga sono già pubblici.
- `list_articles` — dieci colonne di metadati, nessun corpo, nessun calcolo.
- `list_ideas` — `select` su `disruptive_ideas` con `status in (new, shortlisted)` per difetto.
- `get_memory` — `select` su `brand_memory` con `layer != session` e `agent is null`.

Le **rotte REST restano tutte e quattro**: le chiama la CLI (`anomalia web`, `anomalia ideas`), e
`resolveArticleId` risolve i prefissi degli id degli articoli passando da `GET /web`, quindi i
prefissi continuano a funzionare anche senza il tool. Qui è stato tolto il tool MCP, non
l'endpoint.

## Le due che sono passate per un pelo

Le dichiaro invece di nasconderle, perché sono perdite piccole ma vere.

**`list_ideas`** — `query` ordina su **una** colonna. Il tool rompeva la parità di punteggio col
più recente; ora le idee con lo stesso `score` tornano nell'ordine che sceglie il planner. Su un
banco dove `score` è spesso `null` questo conta più di quanto sembri. Tolta lo stesso: l'intento
— le idee ancora usabili, le migliori prima — resta esprimibile, e il banco è comunque leggibile
per intero.

**`get_memory`** — due differenze. `query` si ferma a 100 righe dove il tool arrivava a 200: per
un brand con più memoria di così si filtra per `category` invece di alzare il limite. E i suoi due
filtri, che l'handler **imponeva**, ora sono **dichiarati**: chi li omette rivede le note di
sessione e le note di mestiere degli altri agenti. Non è una fuga — la RLS non è cambiata, sono
righe dei brand di chi legge — ma è rumore che prima non arrivava, quindi i filtri sono scritti
per esteso in tre posti: la skill, `references/tools.md` e la descrizione di
`record_memory_used`, che è il tool per cui si legge la memoria.

## Dove è finita la conoscenza che stava nelle descrizioni tolte

Una descrizione che sparisce si porta via le sue regole, e questa è la parte che rompe in
silenzio. Sono state ricollocate accanto al modello che le governa:

- il decadimento della memoria (`una voce che nessuno segnala esce dai prompt`) stava in
  `get_memory` → ora sta in `record_memory_used`, che è il tool che fa la segnalazione;
- «leggi il look prima di scriverlo, o i font escono in Inter» stava in `get_appearance` → ora sta
  in `set_appearance`, insieme alla `query` che lo legge;
- «l'id dell'articolo viene da `list_articles`» stava in `get_article` e `update_article` → ora
  quei due dicono la `query` da cui l'id viene davvero.

## Il test

Guida `tools/list` attraverso il transport vero (`handleMcpFetch` dopo un `initialize`), non i
sorgenti: verifica che i quattro non ci siano più né in `tools/list` né nel registro, che le
letture che `query` taglierebbe ci siano ancora e siano ancora letture, e che le
`MCP_INSTRUCTIONS` nominino i quattro ritirati e la regola sulle colonne. Quest'ultima asserzione è
l'unica difesa contro il difetto vero di una rimozione: il protocollo risponde «tool not found» e
non insegna niente, quindi il posto dove un agente ritrova il nome è la mappa del handshake.

I quattro nomi nelle istruzioni sono una nota di migrazione e invecchiano: si tolgono fra un paio
di release, quando nessun client li chiama più. La regola sulle colonne no, quella resta.

## E i tre dell'autenticazione, che è un'altra storia

`login`, `logout`, `whoami` non erano doppioni di `query`: erano una superficie che il protocollo
copre già. Su HTTP `http-app.ts` serve `/.well-known/oauth-protected-resource` e risponde 401 con
`WWW-Authenticate: Bearer` — il giro che l'host fa da solo.

**`logout` è quello che andava tolto per primo, e non per il conteggio: mentiva.** `clearSession()`
è `unlinkSync(SESSION_FILE)` dentro un `catch {}`, e `SESSION_FILE` è
`~/.config/anomalia/session.json` **sulla macchina che esegue il server**. Da remoto quel file non
è del chiamante: l'unlink fallisce, il catch se lo mangia, e il tool rispondeva comunque
`{ loggedOut: true }`. Un successo falso a ogni chiamata remota è peggio di un tool assente.

`login` su HTTP era già morto — rifiutava con `VERCEL === '1'` o `MCP_REQUIRE_BEARER === '1'`.
`whoami` invece funzionava su entrambi i transport, ed è il meno ovvio dei tre: se ne va perché la
domanda ha già risposta dove serve — su HTTP l'account l'ha scelto l'host, su stdio la sessione è
quella della CLI — e perché la frase che diceva «chiamalo prima di agire» è stata riscritta nello
stesso commit, in tutti i posti che la ripetevano: skill, `references/mcp.md`,
`references/tools.md`, la pagina `/docs/mcp` e le sue quattro lingue.

**Il costo, che sta anche nella PR e non solo qui:** su **stdio** `login` faceva un vero login da
browser. Chi usa l'MCP locale senza aver mai toccato la CLI perde il modo di autenticarsi
dall'interno. Non è grave — MCP stdio e CLI escono dallo stesso pacchetto e condividono lo stesso
`session.json` — ma è un passo in più, e la risposta va detta col comando accanto: **`anomalia
login` da terminale, una volta sola.**

`src/lib/webmcp.ts` spiegava perché il browser non offre quei tre «mentre il server MCP sì». Adesso
non li offre nessuno dei due, e il commento lo dice invece di mentire per omissione.

## Le rotte che restano senza contratto si dichiarano

`registry.test.ts` impone che ogni rotta sotto `[slug]` sia descritta da un contratto **o**
elencata in `REST_ONLY`. Tolti i tool, `/ideas` e `/web` sono cadute nel secondo caso e sono state
aggiunte a mano — che è il punto di quella lista: costringere il diff a rispondere alla domanda
«questa rotta cos'è adesso». Superficie REST voluta, entrambe: le chiamano `anomalia ideas` e
`anomalia web`.

## Numeri

119 tool (111 dal registro, 8 a mano), 42 letture. Contati dal transport, non dai sorgenti: il
documento diceva 127 e nessuno ha mai visto quel numero — il conteggio guardava solo i primi 700
caratteri dopo ogni `tool:` e perdeva sette endpoint interi. Il vero punto di partenza era 126.
