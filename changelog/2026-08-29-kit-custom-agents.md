# Gli agenti custom al Kit

Secondo strappo della strangolazione (ADR-0001): i turni di conversazione di un agente custom
(thread con `custom_agent_id`) girano sul bridge del Kit quando AGENT_KIT=on, con la loro persona.

Prima: il gate del drain escludeva qualunque thread con persona (`!personaId`) e il commento lo
dichiarava voluto — il persona era una meccanica solo classica. Ora un agente custom NON ha un
AgentSpec suo: è lo spec del mestiere del thread (`custom_agents.agent` → `thread.agent`, già
risolto dal selettore dei destinatari) con la persona come OVERLAY sul turno kit,
`RunKitTurnInput.persona = { id, memoryKey, systemBlock }`:

- `systemBlock`: il blocco `customAgentSystemBlock` montato dal formatter condiviso, col locale del
  kit (`bilingualNoticeLocale`), appeso dopo le istruzioni del mestiere — prima del blocco lingua,
  come il classico lo appende dopo il prompt di base.
- `memoryKey`: `custom:<uuid>`, la STESSA grammatica di `memoryAgentKey` del classico — altrimenti
  il mestiere leggerebbe la memoria di un altro.
- `id`: chi possiede la macchina (`ctx.agentId`, come `computerOwner` sul classico). Il file tree
  resta del mestiere (`spec.id`): le istruzioni di mestiere puntano lì (`how/`, `brand/studio.md`).

Modello: il ramo kit passava solo `threadRow.model`; ora porta anche la preferenza permanente
dell'agente (`persona.model`), stessa `turnModelFamily` del classico.

La persona si carica UNA volta prima del gate e serve entrambi i rami (prima era caricata solo dal
classico, a ~170 righe sotto).

Rimane classico: le stanze (≥2 agenti) e i turni SCHEDULATI dell'agente custom
(`params.scheduled`, routine e brief — ticket 3). Il gate è `(scheduled !== true || !personaId)`:
un turno schedulato di uno specialista builtin resta kit, com'era.
