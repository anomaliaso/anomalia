# `@anomalia/agent-contracts`

The domain: **what an agent is, what a run is, and who the five specialists are** — as zod
schemas and data, not as branches of code.

Position in the graph: kit → **contracts** → core → adapters / client.
Depends on `@anomalia/agent-kit` (types only) and `zod`.

## What's in it

| Export | What |
|---|---|
| `…/contracts` | `AgentSpec` (id, name, title, `instructions` ≤ `INSTRUCTIONS_MAX` = 20 000 chars, color, model policy), the run state machine (`RUN_STATES`, `assertTransition`, `isResumable`, `isTerminal`), `SYSTEM_PROMPT_MAX_CHARS`, `DEFAULT_AGENT_MODEL` |
| `…/specs` | `SPECIALISTS` — the five agents (`content`, `ugc`, `motion`, `web`, `analyst`) as validated rows — plus `specById` and `modelPolicyForAgent` |
| `…/notice` | `honestNotice(reason, locale)` — the factual one-liner shown when a turn ends without a message |

## Example

The state machine refuses illegal moves at the call site, so a bad transition explodes with both
states named instead of leaving a ghost row in the database:

```ts
import { assertTransition, isResumable } from '@anomalia/agent-contracts/contracts';

assertTransition('running', 'waiting_input'); // ok
isResumable('waiting_input');                 // true — the run is alive, the human is not back yet
assertTransition('done', 'running');          // Error: run: transizione illecita done → running
```

The specialists are rows, validated at import time:

```ts
import { SPECIALISTS, specById } from '@anomalia/agent-contracts/specs';

SPECIALISTS.map((s) => s.id);   // ['content', 'ugc', 'motion', 'web', 'analyst']
specById('motion')?.model;      // { family: 'grok', thinking: 'high' }
```

## What it does NOT do

- No tool lists per agent. Which tools an agent gets is decided when plugins are mounted
  (`agent-core`), not by a field here.
- No prompt assembly. `instructions` is short on purpose; the craft lives in the `how/` files the
  agent reads with its own eyes. `buildSystemPrompt` is in `agent-core`.
- No persistence. `assertTransition` validates; `agent-core/run-store` is what writes the row.
- No runtime imports in `notice.ts` — the browser bundle imports it without pulling in the
  executor.
