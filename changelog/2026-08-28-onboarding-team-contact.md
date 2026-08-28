# 2026-08-28 — Il team si presenta nell'onboarding

## Perché

La task #38 misura un difetto reale con `npm run eval:ux` (criterio `team-of-agents`, FAIL 1/4):
un brand nuovo riceve un solo contatto — l'Analyst. L'utente deve avvertire di parlare con un
intero team, ma nessun altro agente lo contatta mai: il contatto degli altri dipendeva dal modello
che decidesse di usare `message_agent`/`open_session_with_user`, cioè da una speranza, non da una
garanzia.

## Cosa c'era prima

- `seedOnboardingChat` seminava solo il thread `surface='onboarding'` con l'Analyst.
- Gli altri specialisti aprono il loro thread utente (`surface='team'`, `getOrCreateTeamThread`)
  solo se il modello lo sceglieva a runtime (o al checkout, via `igniteBrandTeam`, senza contatto).
- L'eval:ux giudicava il criterio solo dagli snapshot, senza un fatto del database.

## Decisioni

- **Server-deterministico, non model-driven.** Chiuso il primo turno di setup (`processNextQueuedChatJob`,
  thread `surface='onboarding'`), la coda chiama `igniteOnboardingTeam`: gli specialisti mappati
  sul piano contattano l'utente nei loro thread. L'eval resta la guardia, ma la garanzia è nel codice.
- **Mappatura dichiarata in una tabella** (`ONBOARDING_TEAM_CONTACTS`): go → content+web,
  starter → +ugc, pro → +motion, default content+web. Un piano nuovo è una riga, non un if.
- **La ricetta di `open_session_with_user`, non un messaggio utente fabbricato.** Riga di apertura
  ASSISTANT firmata (`chat_messages.name` = agente, testo statico che dichiara mestiere e prima
  azione) + turno di continuazione accodato con agente forzato e brief server-side. Nel thread di
  squadra l'utente non ha scritto nulla: una riga `user` mai scritta da lui sarebbe un falso nel
  transcript. L'incarico operativo sta nel `brief` (system prompt, mai nel thread).
- **Il turno di continuazione porta SEMPRE un testo solo-per-il-modello** (`user_message` non
  vuoto, mai salvato né mostrato). Scoperto in verifica end-to-end: con `user_message` vuoto il
  job moriva due volte — prima col gate `Missing user_message`, poi (una volta superato il gate)
  col prompt vuoto, perché il provider rifiuta una conversazione che non apre con un turno user e
  `dropLeadingAssistant` mangia l'apertura firmata. La stessa correzione ha risanato
  `open_session_with_user`, che portava lo stesso difetto dalla nascita.
- **Idempotenza sul contatto, non sul thread.** Il thread è get-or-create (indice 0199); il contatto
  salta se esiste un job in volo sul thread o una firma dell'agente (`name`) tra i messaggi. I seed
  statici del diario (`igniteBrandTeam`) non hanno firma e non bloccano il primo contatto vero.
- **Nessun gate nuovo** (scelta presa in design): i turni passano dai tetti di credito esistenti
  nella coda, come il turno di Analyst. Custom agent esclusi: all'onboarding non esistono ancora.
- **Fatti prima dei gusti nell'eval**: `teamContactFacts` conta i thread di squadra con almeno un
  messaggio assistente firmato; `team-of-agents-contact` entra nei flow facts come gate. Baseline
  rossa scritta e osservata prima della fix.

## Scartato

- Room di gruppo nel thread di onboarding (GROUP_CHATS): dietro flag, anima solo su messaggio
  utente, non misurabile per-agente. Restrà per un modello diverso di convivenza.
- Turno dei contatti innescato da Analyst via tool: tornava la dipendenza dal modello che la task
  #38 critica.
- Ritardi artificiali tra i contatti: la coda è già serializzata; lo stagger era effetto cosmetico
  a costo di stato.
