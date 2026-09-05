# I lavori ricorrenti si accendono da fuori, e accendere dice che costa

Terzo giro sulle impostazioni headless. `get_automations` e `set_automation`, su
`GET`/`PUT /api/v1/brands/:slug/settings/automations`. `tools/list`: **97 → 99**, additivo,
`changed: []` sul confronto oggetto per oggetto.

## Perché nove lavori e non l'interruttore dell'autopilot

La pagina `settings/autopilot` sembra un booleano. Non lo è: chiama
`setJobEnabled(admin, { jobKey: 'autopilot' })`, e `autopilot` è **una riga di `ROSTER_JOBS`, che
ne ha nove**. Esiste già `brandRoster()` che per ciascuno restituisce `enabled`, `cadence`,
`state`, `reason`, `lastRunAt`, `servedAt`, `behind`, e la pagina `/agents` li accende tutti.

Esporne uno solo quando la funzione condivisa ne accetta nove sarebbe una scelta arbitraria che
qualcuno avrebbe dovuto disfare. Nessun codice nuovo per gli altri otto: sono la stessa chiamata.

## La parte che decide la forma del tool: accendere impegna denaro

Questi lavori girano **da soli** e chiamano modelli AI a ogni giro. Un agente esterno che ne
accende uno non cambia una preferenza — impegna crediti del cliente, ripetutamente, senza che
nessuno lo riguardi. È meno visibile di un pagamento proprio perché non c'è nessuna schermata a
fare da testimone.

Il precedente è di oggi: il cron delle routine dei custom agents faceva 288 esecuzioni AI al
giorno ed è stato spento perché qualcuno è andato a contarle. Un tool che accende senza dire il
costo prepara quella situazione, con la differenza che l'avremmo costruita noi.

Quindi:

- la `description` di `set_automation` dichiara che accendere è una decisione di spesa, che il
  lavoro girerà da solo alla sua cadenza, e che **spegnere non spende niente**. Tre test tengono
  lì quelle frasi: se sparisce la frase, sparisce l'avvertimento;
- la risposta di chi accende porta `spends_on_every_run` e `cadence`, così ciò che è stato
  impegnato resta scritto nel turno, non solo nella descrizione letta prima;
- `enabled` non ha default: accendere e spegnere sono due gesti espliciti.

**`openWorld` non è impostato, e non è una svista.** In questo registry `openWorld` vuol dire
"esce su internet" (`diagnose_radar`, `research_competitors`, `sync_history`). `set_automation`
cambia una riga nel nostro database: usare quel flag per dire "costa" sarebbe un'annotazione che
mente su cosa il tool fa — lo stesso errore dell'enum piatto sui modelli. Il registry non sa
esprimere "impegna spesa futura"; lo dicono la descrizione e la risposta.

## Il costo per lavoro: non esiste, e il tool lo dice invece di tacere

Sono andato a vedere se `ai_calls` permettesse una somma per lavoro. **No**, e per quattro ragioni
indipendenti:

1. `ai_calls` non ha nessuna colonna che nomini il loop. `context` è testo libero per call site
   (`'design/compose'`, `'produce-agent'`, `'tool=…'`), mai una chiave del roster.
2. Le `label` sono **condivise fra lavori**: `director` / `directorRewrite` stanno sia in
   `autopilot` sia in `radar_recap`; `createSingleContent` sta sia in `autopilot` sia nella
   creazione manuale dal browser. Un `CASE WHEN label IN (…)` attribuirebbe male.
3. `strategy_review` non è isolabile affatto: gira come un turno di chat nel thread dell'agente
   proprietario, indistinguibile da un turno digitato da una persona.
4. `loop_ticks` — l'unica tabella che nomina il loop — non ha né costo né chiave di join verso
   `ai_calls`. E gli aggregati PostgREST sono disattivati su questo progetto (`0158_provider_spend`
   esiste proprio per questo), quindi anche volendo servirebbe una funzione SQL nuova.

Al posto di un numero inventato, il tool porta `runs_30d`: **quante volte il lavoro ha davvero
girato**. I giri `skipped` non contano — un gate li ha fermati prima di spendere, e contarli
direbbe "questo ti costa" di qualcosa che non è costato; i `failed` contano, perché possono aver
già speso prima di fallire. Con `cadence`, è quello che serve per descrivere l'impegno.

E la `description` della lettura **dice** che il costo per lavoro non è attribuibile, invece di
lasciare che l'assenza sembri una dimenticanza. Un test lo tiene fermo, e verifica anche che
nell'output non compaia un campo `spend_usd`.

Per avere davvero il costo servirebbe una colonna `loop` su `ai_calls` scritta da ogni call site
dentro ogni tick: una migration più un'instrumentazione diffusa. È una decisione, non un dettaglio
di questo endpoint, e in questo repo le migration non le applica il deploy.

## Una fonte sola per il testo dei lavori

`ROSTER_JOB_BLURBS` era privato e lo leggeva solo `rosterForPrompt`. Ora c'è `jobBlurb(key)`
esportata, con dentro il ripiego sul nome, e la usano sia il prompt sia il tool: un lavoro nuovo
entra in tutti e due senza che nessuno se ne ricordi. Il contratto **non** ricopia i testi — solo
le nove chiavi, che un test confronta con `ROSTER_JOBS`.

## Cosa è stato visto rosso

- il contratto, prima di essere nel registry;
- il guardiano delle nove chiavi, con un `made_up_job` aggiunto al contratto;
- `jobRunCounts`: tolti il filtro sugli esiti e quello sulla finestra, cadono i due test che li
  pretendono;
- la rotta: tolti il conteggio, il gate del piano, `spends_on_every_run` e la gestione del
  fallimento dell'interruttore, **cadono 5 test su 12** e 7 restano verdi.
