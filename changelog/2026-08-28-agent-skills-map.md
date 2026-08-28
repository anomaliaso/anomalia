# Skill per agente, non per tutti

## Perché

Con le skill di scrittura sempre addosso a tutti (entry precedente) il passo
successivo era chiedersi CHI riceve COSA: la task Notion 35 chiedeva se ogni
agente del team ha skill diverse. La risposta era no — lo stesso mazzo per
ogni turno — ma la cucitura esisteva già: `startHarnessTurn` è per-turno e il
chiamante (`live.ts`) conosce `spec.id`.

## Cosa

- `startHarnessTurn` prende `agentId` e il bridge lo passa (`live.ts`).
- `skillsForAgent(agentId)` in `brand-skills.ts` è la mappa: ogni specialista
  e il generalista ricevono le due skill di scrittura; il Motion aggiunge
  `remotion-best-practices` dal repo — l'unico mestiere che scrive sorgente
  Remotion. Agente sconosciuto = le due di scrittura (fallback, non vuoto).
- `HARNESS_SKILLS` resta additivo e globale, com'era.

## Scartato

Una colonna `skills` su `custom_agents`: i custom agent girano sul motore
classico (il drain esclude DM, persona e stanze dal percorso kit), quindi non
consumerebbero skill harness — peso morto. La superficie arriva quando (se)
i custom agent salgono sul kit.

## Da fare quando cresce il mazzo

Nuova skill + riga nella mappa. Il nome vale per entrambe le sorgenti; un
nome che non esiste da nessuna parte cade in silenzio.
