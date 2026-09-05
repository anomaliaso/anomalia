# Un piano e una settimana scritti fuori, salvati come i nostri

Fase 2 del piano agenti esterni. `propose_plan` e `plan_week` sanno solo **generare**: chiedono il
piano al nostro modello e lo fatturano. Un agente esterno che il piano l'ha già scritto — con
l'account modello del suo utente — non aveva dove metterlo. Stessa lacuna sui seed della settimana.

Ora ci sono due scritture deterministiche accanto a quelle gestite, non al loro posto:

- `POST /editorial-plan/save` (`save_plan`) — il piano supplito diventa la **proposta pendente**;
- `POST /weekly-plan/seeds` (`save_week_seeds`) — le righe supplite diventano la **bozza** della
  settimana.

Nessuna chiamata al modello, nessun credito: i test lo verificano spiando `structured`,
`gateAiAction` e `gateCredits` e pretendendo che nessuno sia chiamato.

## Perché sono indistinguibili da quelli generati

Il requisito era «managed and external-authoring paths produce the same domain states», e una
promessa del genere si mantiene solo condividendo il codice, non copiandolo.

- **Il piano.** Il writer che `proposeFirstPlan` aveva inline è uscito in `saveProposedPlan`
  (`editorial-plan.ts`, accanto al modello che governa la tabella), in un commit che non cambia
  comportamento. Ora entrambe le strade passano da lì: stessa riga, stesso `status: 'proposed'`,
  stesso `source: 'manual'`. Il body supplito passa da `normalizePlan`, la stessa funzione che
  normalizza l'output del modello — quindi anche il padding a 4 settimane, le piattaforme in
  minuscolo e il `clampCadence` sono gli stessi.
- **I seed.** Passano da `normalizeWeeklyStrategy`, che il repo dichiara «single rehydration
  point»: id di riga assegnato, formati legacy mappati sull'enum, capacità media clampate. La
  bozza scritta è una riga `content_plans` identica a quella di `plan`.

## Cosa è stato deciso, e cosa scartato

**Il piano salvato non si attiva da solo.** Finisce `proposed`; `approve_plan` resta il passo che
attiva. Un `activate: true` sarebbe stato comodo e avrebbe tolto la revisione umana da una scrittura
che nessun operatore ha visto: scartato. Il piano **attivo** non viene mai toccato — solo una
proposta pendente precedente passa a `rejected`, esattamente come fa `propose`.

**`source` resta `'manual'`, non `'external'`.** `editorial_plans.source` ha un CHECK
(`onboarding | revision | rollover | manual | analytics_review | autopilot`) e questo repo **non
esegue le migrazioni al deploy**: un valore nuovo passerebbe in locale e romperebbe in produzione
con un 23514. `posts.source` non ha vincolo, ed è per questo che `create_post` poteva scrivere
`'external'`; qui no. Un test blocca i valori scritti contro gli array reali del CHECK. La
provenienza «agente esterno» distinta dalla web resta un follow-up che richiede una migrazione
applicata a mano.

**Una bozza sola.** La pagina piano legge la bozza `draft` più recente: una seconda riga
nasconderebbe la prima. Quindi `save_week_seeds` sostituisce quella in revisione (come fa l'azione
web), invece di inserirne un'altra come fa la rotta CLI `plan`. La risposta dice `replaced`.

**Attaccati al piano attivo se c'è, altrimenti in piedi da soli** (`editorial_plan_id: null`) —
lo stesso fallback della rotta gestita.

**Rifiuta invece di scartare.** `normalizeWeeklyStrategy` butta silenziosamente un seed senza
piattaforma. Lo schema del contratto lo rifiuta prima, nominando la riga (`seeds.0.platform`):
un'agente che riceve `ok: true` per tre seed e ne trova due salvati non ha modo di accorgersene.

## Cosa NON c'è

- **Nessun controllo `media_id` sui seed.** `PostSeed` porta `media_id`/`media_mode`, ma
  accettarli richiederebbe la verifica di proprietà del brand che fa `create_post`
  (`media_not_found`). Non l'ho aggiunta, quindi i due campi non sono nel contratto.
- **Nessun `beats`.** La storia per slide di un carosello è una struttura annidata con un
  contratto suo; fuori da questa PR.
- **Nessuna guardia «settimana già prodotta».** L'azione web rifiuta di ripianificare una
  settimana che ha già post (`week_has_posts`, la trappola del 3+3); vive inline nella page
  server e non è estratta. La rotta CLI `plan` ha lo stesso buco: salvare seed su una settimana
  già prodotta e poi chiamare `produce` duplica i post. Parità con l'esistente, non un
  peggioramento — ma è un buco.
