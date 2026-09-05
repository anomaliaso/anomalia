# Il piano di aggregazione delle scritture è ritirato, e `ads_action` smette di accettare qualunque stringa

`docs/mcp-tools.md` proponeva di collassare 15 tool CRUD in 6 `*_action` e 10 impostazioni in 2-3.
Aperti i 72 handler di scrittura, **nessuna famiglia supera la prova**. Il piano non è rimandato:
è ritirato, con il perché scritto accanto, perché chi lo rilegge fra sei mesi deve trovarci la
contraddizione risolta e non rimossa.

## Il documento si contraddiceva

In «La regola che dice cosa NON raggruppare» enuncia il costo — *«un agente che cerca "aggiungi un
concorrente" trova `add_competitor` all'istante; con `competitor_action(op: 'add')` deve leggere
l'enum»* — e tre righe dopo propone di pagarlo: *«le sei famiglie CRUD diventano `*_action`»*.
È probabilmente la ragione per cui il piano è stato scritto e mai eseguito. La regola resta, la
proposta che la violava se ne va.

## I due argomenti, e il primo è di natura diversa dal secondo

**`destructiveHint` è per tool, non per valore di enum.** In `cli/mcp/tools/brand-content.ts`
l'annotazione è `destructiveHint: endpoint.destructive`, e il protocollo non offre modo di dire
«distruttivo solo quando `action = delete`». Un `*_action` che mette un verbo che distrugge accanto
a otto che non distruggono si marca distruttivo **per intero**: è `ads_action` oggi, dove un client
che avvisa sui tool distruttivi avvisa anche su `sync` e `propose`. Da lì si impara a cliccare via
l'avviso, ed è come si perde un presidio senza che nessuno lo cancelli.

Questo argomento non si discute: viene dal protocollo e dal nostro codice, e vale per ogni
`*_action` proposto, indipendentemente da come è scritta una descrizione.

**Il secondo è quello già misurato su `generate_media`**: un modello sceglie dal nome e legge
l'enum solo dopo aver aperto il tool, cioè dopo aver già deciso. Un `action` non guida la scelta,
la mette davanti a una scelta già fatta. Dove i fratelli condividono già il prefisso (`set_*`),
collassare non toglie un enum: toglie i nomi, che sono l'unica cosa che oggi funziona.

## Cosa è stato fatto al posto del collasso

**`ads_action`** aveva `action: z.string().min(1)` mentre lo `switch` della rotta accetta dieci
verbi e risponde `unknown_action` a tutto il resto. Una stringa libera davanti a un elenco chiuso
fa scoprire l'elenco sbagliando, e uno dei dieci cancella una campagna vera. Ora è un `enum`. La
descrizione ne elencava **nove** e ometteva `approve` — che è quello che lancia, cioè quello che
spende i soldi del brand — pur citandolo di sfuggita in fondo: ora li nomina tutti e dieci e dice
quale spende. Non è stato né collassato né spezzato: spezzarlo è un cambiamento rotto, e non è oggi.

**`set_appearance` non aveva un campo colore e nemmeno un rimando.** Chi cerca «cambia i colori del
brand» apre il tool che si chiama «appearance» e non trova niente: la palette è `set_colors`. Il
rimando è nella descrizione, e un test verifica che ci sia **e** che il campo colore continui a non
esistere lì — perché il giorno in cui qualcuno lo aggiunge, il rimando diventa una bugia.

**`edit_post` ha due parole per «quando»**: prende `slot` (il giorno di calendario) e non
`scheduled_for` (l'istante in cui il post esce), che si cambia solo con `reschedule_post`. Senza il
rimando un agente sposta il giorno credendo di aver spostato l'ora, e nessuno se ne accorge finché
il post non esce all'ora sbagliata. Stessa forma del difetto del refine che rigenerava da zero: la
capacità c'è, il nome non porta lì.

## Quello che NON è stato fatto, e perché

**`credits_exhausted` non è stato aggiunto a `ads_action`.** L'istruzione era di aggiungerlo visto
che `propose` chiama un modello, ma la rotta `/ads` **non ha nessun gate sui crediti** — niente
`gateAiAction`, nessun 402 possibile. Dichiarare un fallimento che l'endpoint non può emettere
sarebbe un contratto che mente, cioè la stessa classe di difetto di `logout`. Il difetto vero è
un altro — `propose` spende soldi di modello senza gate — ed è un cambiamento di comportamento che
tocca la fatturazione, non una correzione di contratto.

## La misura che deciderebbe, e perché oggi vale zero

I tre `*_action` esistenti sono l'esperimento naturale. Ma `ai_calls` registra la chiamata al
modello, non il tool MCP che l'ha originata, e le sue label sono condivise fra superfici. `mcp_logs`
ha la colonna giusta, `tool_name`, scritta da `cli/mcp/observability.ts` — e **nessun chiamante la
valorizza**: in tutto `cli/mcp/` non c'è un punto che passi `toolName`, quindi è sempre `null`.

Quindi il prerequisito è una riga, e la query che risponderebbe alla domanda sta nel documento
insieme a cosa distinguerebbe un successo da un fallimento. Scritta e non lanciata: sotto qualche
centinaio di chiamate per tool il confronto non dice niente, e va aspettato invece che forzato.

## Difetti trovati e non toccati

Rientrano nelle sei domande dell'analisi completa dei tool, che sta facendo qualcun altro:

- `/ads` non gatea i crediti benché `propose` chiami un modello — «dichiara il costo».
- `ads_action` legge `body.budgetAmount` e `body.goal` nella rotta, ma il contratto `.strict()`
  non li dichiara: attraverso il tool tipizzato un `approve` con budget **non è esprimibile** —
  «lo schema guida».
