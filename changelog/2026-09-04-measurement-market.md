# Campo, radar e banco idee diventano tool MCP

Tre letture entrano nel registry (`packages/api-contracts/src/market.ts`): `get_market_field`,
`diagnose_radar`, `list_ideas`. Il tool MCP e il metodo del client CLI nascono dalla dichiarazione,
non da un `registerTool` scritto a mano.

## Perché esiste

Un agente esterno che non vede il campo lavora al buio: propone senza sapere cosa gira, e quando
il Radar non trova niente non ha modo di scoprire perché. Le tre rotte esistono da tempo — due
non erano nemmeno documentate in `docs/api/`, quindi erano raggiungibili solo da chi aveva letto
il codice.

## Cosa c'era prima

`GET /market/field`, `GET /radar/diagnose`, `GET /ideas`: invariate. Cambia solo che adesso sono
dichiarate.

## Le due cose che non erano ovvie

**`diagnose_radar` esce di casa, e lo dice.** È una lettura — niente AI, niente crediti, niente
scritture — ma fa una richiesta di rete per fonte configurata, e per questo la rotta ha
`maxDuration: 300`. Nel contratto è `openWorld: true`, che il generatore emette come
`openWorldHint: true`: un client che vede solo `readOnlyHint` la tratterebbe come una lettura
locale e istantanea, e non lo è. La descrizione lo ripete a parole, perché l'annotazione la legge
il client e la descrizione la legge il modello.

**I post del campo hanno campi opzionali, e non è pigrizia.** La rotta fa
`{ ...(postById.get(id) ?? {}), query, relevance, discoveredAt, teardown }`: se la riga di
`market_posts` non c'è più, l'oggetto esce con i soli quattro campi che il mapper scrive sempre.
Dichiarare `platform` obbligatorio avrebbe reso il contratto falso proprio nel caso in cui serve
capire cosa è successo.

`list_ideas` senza `status` non restituisce tutto: restituisce solo `new` + `shortlisted`
(`unusedOnly`). È scritto nella descrizione del tool, perché un agente che chiede "le idee" e ne
riceve un sottoinsieme senza saperlo conclude che il banco è vuoto.

## L'equivalenza, provata

`tools/list` catturato attraverso `handleMcpFetch` prima e dopo: **90 → 93**, tre aggiunti, zero
rimossi, zero modificati. La base è 90 e non 91 (#263 aveva lasciato 91) perché nel frattempo lo
smantellamento della chat ha tolto il tool `chat` da `dev`.

## Chiave di sola lettura

Tutte e tre `GET`, `destructive: false`. La chiave di sola lettura le raggiunge per costruzione:
`resolveCaller` nega la scrittura una volta sola e il criterio è il metodo. Nessuna delle tre
chiama `gateAiAction`.

**`POST /market/field` è rimasto fuori**: quella sì spende crediti (ricerche su più piattaforme e
un teardown per ogni post nuovo). Qui entrano solo letture.
