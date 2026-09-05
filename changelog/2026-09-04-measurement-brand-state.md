# La diagnosi del brand e gli obiettivi diventano tool MCP

Due letture entrano nel registry (`packages/api-contracts/src/brand-state.ts`): `diagnose_brand`
e `get_goals`. Chiudono il giro cominciato con #263 (web/SEO) e proseguito con #265 (mercato): le
otto letture di misurazione scoperte dal censimento sono ora tutte dichiarate, e
`BRAND_ENDPOINTS` passa da 55 a 63.

## Perché esiste

`diagnose_brand` è la domanda che un agente esterno si pone per prima quando non succede niente:
non «cosa è andato storto» ma «quale cancello non passo». La rotta esiste da tempo e nessun tool
la esponeva, quindi l'unico modo di leggerla era `curl` — cioè un umano.

`get_goals` è l'altra metà: la modalità obiettivo lascia uno stato (che la chat mostra) e una
storia (che nessuno leggeva). Il riepilogo è il punto — quanti obiettivi si chiudono al primo
colpo, quante riprese automatiche costano, per quale ragione le catene si fermano — perché è da
lì che si capisce se il tetto dei giri è generoso, stretto, o non lo tocca mai nessuno.

## Le due cose che non erano ovvie

**`notCovered` è obbligatorio nell'output, non decorativo.** La diagnosi copre tre cicli su nove.
Un agente che legge `loops: []` senza sapere cosa è escluso conclude che il prodotto sta girando.
C'è un test che rifiuta l'output senza `notCovered`, ed è l'unico modo per impedire che il campo
venga tolto come ridondante.

**Il parametro si chiama `thread`, non `threadId`.** `callEndpoint` passa le chiavi dell'input
come query params tali e quali, e la rotta legge `url.searchParams.get('thread')`. Un contratto
con `threadId` avrebbe generato un tool che accetta il campo, lo manda, e viene ignorato in
silenzio: il filtro non filtra e l'agente non se ne accorge. Un test lo tiene fermo.

## L'equivalenza, provata

`tools/list` catturato attraverso `handleMcpFetch` prima e dopo il rebase su `dev`: **93 → 95**,
due aggiunti, zero rimossi, zero modificati. La base sale a 93 perché nel frattempo sono entrati
#263 (web/SEO) e #265 (mercato); scende di uno rispetto alla somma perché lo smantellamento della
chat ha tolto il tool `chat`.

## Il rischio dichiarato

`/goals` legge da `src/lib/server/chat/goal-log.ts`, e la chat è in smantellamento in parallelo.
Se la modalità obiettivo viene rimossa, questo endpoint va rimosso con lei: il contratto non è un
motivo per tenerla in vita. Al momento della scrittura la rotta, il modulo e le tabelle
(`chat_goals`, `chat_goal_events`) sono tutti presenti su `dev`.

## Chiave di sola lettura

Entrambe `GET`, `destructive: false`, nessuna chiama `gateAiAction`. La chiave di sola lettura le
raggiunge per costruzione: `resolveCaller` nega la scrittura una volta sola, sul metodo.
