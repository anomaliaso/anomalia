# Le private al Kit

Primo strappo della strangolazione verso il motore unico (ADR-0001): i DM fra agenti
(`room_agents.dm`, `chat-dm.ts`) girano i loro turni di risposta sul bridge del Kit invece che sul
runner classico della coda.

Prima: il gate del drain escludeva `isDm` a mano (`!isDm`) e il commento lo dichiarava voluto —
il mittente, la firma e il tetto di step erano meccaniche solo classiche. Ora il gate esclude solo
persona e stanze (ticket 2 e 4), e il contesto DM entra nel turno kit come `RunKitTurnInput.dm`:
blocco `dmBrief` in testa al system prompt, tag del mittente dentro il contenuto (sostituzione
dell'ultima riga user, non duplicazione — già fatto dal ramo kit per i documenti), firma della
risposta (`chat_messages.name`) applicata dopo la chiusura della RPC `agent_kit_close_run`, tetto
`DM_REPLY_STEP_CAP` al posto dei 75 step, esclusioni del turno non presidiato sul catalogo kit
(nuovo `UNATTENDED_KIT_TOOL_EXCLUSIONS`: l'`ask_user` del kit è l'`ask_user_questions` del classico),
nessuna ripresa automatica né per deadline né per obiettivo.

Il push «reply is ready» era classic-only e l'ultimo ramo kit che chiudeva un job restava muto:
estratto in `notifyReplyReady` e chiamato da entrambi i rami.

Rimane classico: chi parla è `anomalia` (nessun AgentSpec → `shouldUseKit` null) o `custom:*`
(persona, ticket 2). Il ramo classico del DM resta intero per rollback fino al ticket finale.

## Scarti

- Firmare dentro la RPC (campo `name` in `agent_kit_close_run`): richiede migration e tocca il
  pacchetto core per una colonna; l'update post-chiusura con l'admin client basta.
- Riprendere i rilanci del giudice di chiusura e dell'anti-ripetizione per i DM: sono guardie di
  qualità del motore kit, non continuazioni della catena; restano attivi anche sui DM.
- Toccare `chat/+server.ts` per il percorso interattivo: i DM sono in sola lettura per le persone
  (403 `dm_view_only` prima di qualunque selezione del motore) e l'unico scrittore di turni DM è
  `message_agent`, che accoda. La pagina chat non seleziona mai il motore per un DM.
