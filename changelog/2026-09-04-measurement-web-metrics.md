# Search Console, posizionamenti e backlink diventano tool MCP

Tre letture di misurazione entrano nel registry degli endpoint
(`packages/api-contracts/src/web-metrics.ts`): `get_gsc`, `get_ranks`, `get_backlinks`. Da lì il
tool MCP e il metodo del client CLI nascono da soli, senza una riga di `registerTool` scritta a
mano e senza un tipo ricopiato.

## Perché esiste

Anomalia sta diventando un'interfaccia headless per agenti esterni via MCP. Un agente che non può
leggere i numeri non può decidere niente: `get_seo` e `get_geo` rispondono sull'ultimo audit, ma
la performance di ricerca vera — clic, impression, posizione media, la posizione di una keyword
oggi rispetto a ieri, chi ci linka — stava dietro tre rotte che nessun tool esponeva. Erano
documentate in `docs/api/07` e raggiungibili con `curl`, cioè da un umano, non da un agente.

## Cosa c'era prima

Le rotte esistono da tempo e non cambiano: `GET /gsc`, `GET /ranks`, `GET /backlinks`. Cambia
solo che adesso sono dichiarate, quindi generate.

## Come è costruito

Un file nuovo per famiglia, come `search.ts` in #238: `web-metrics.ts` tiene le tre misure del
web e non si mescola a `reads.ts`, che è pieno di stato del brand.

L'`output` è descritto sul serio, non `z.any()`. Le tre forme sono state lette dalle funzioni che
le producono (`loadGscSummary`, `loadRankBoard`, `loadBacklinkNetworkSummary`) e riconosciute
nelle risposte già documentate in `docs/api/07`. Le due decisioni che non erano ovvie:

- **`partnerName` è opzionale sui piazzamenti.** È un arricchimento best-effort: la query dei nomi
  parte solo se ci sono partner da nominare. Dichiararlo obbligatorio avrebbe reso l'output falso
  su una rete vuota.
- **`connected` di GSC non è deducibile dai numeri.** Zero clic con `connected: false` significa
  "mai collegato", con `connected: true` significa "collegato e a zero". Un agente che non
  distingue i due casi propone la cosa sbagliata, quindi il campo è obbligatorio e c'è un test che
  lo tiene.

## L'equivalenza, provata

`tools/list` catturato attraverso `handleMcpFetch` prima e dopo: **88 → 91**, tre aggiunti, zero
rimossi, zero modificati. Nessun tool esistente cambia nome, titolo, descrizione, insieme delle
proprietà o dei campi obbligatori.

La prova permanente non è quel confronto ma una legge nuova in `cli/mcp/read-tools.test.ts`: per
**ogni** endpoint del registry deve esistere in `tools/list` un tool con lo stesso titolo, la
stessa descrizione, `readOnlyHint` uguale a `method === 'GET'` e `destructiveHint` uguale a
`destructive`. Vale per i 58 di oggi e per quelli che arriveranno. È stata vista fallire
sopprimendo `get_gsc` nel generatore.

## Chiave di sola lettura

Tutte e tre sono `GET`, `destructive: false`, e una API key di sola lettura le raggiunge — non per
gentilezza delle rotte ma per costruzione: `resolveCaller` in `cli-auth.ts` nega la scrittura una
volta sola, e il criterio è il metodo (`request.method !== 'GET'`). Nessuna delle tre chiama
`gateAiAction` o `checkApiKeyWriteAccess`: non spendono crediti.

`POST /backlinks` invece spende crediti (`gateAiAction`) ed è rimasto fuori: qui entrano solo
letture.
