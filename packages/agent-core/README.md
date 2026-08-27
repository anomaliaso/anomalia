# `@anomalia/agent-core`

The engine: **one turn from start to finish (or to waiting), one place that executes tools, and
the persisted run state**. No provider, no sandbox vendor, no product logic — only kit interfaces
and a Supabase client passed in as a parameter.

Position in the graph: kit → contracts → **core** → adapters / client.
Depends on `@anomalia/agent-{kit,contracts}`, `@anomalia/agent-adapters` (only
`graphical-bootstrap`, for the `observe`/`act` tools) and `@supabase/supabase-js` (types + calls,
never a client it creates itself).

## What's in it

| Export | What |
|---|---|
| `…/turn` | `runTurn(db, runtime, applyTool, input, onEvent?)` — creates the run, builds the prompt, drives the runtime, decides what "finished" means, returns `TurnOutcome` |
| `…/executor` | `createApplyTool(deps)` — the single function that executes a tool call; `buildSystemPrompt` |
| `…/run-store` | `agent_kit_runs` row lifecycle: `createRun`, `transition`, `askUser`, `resume`, `renewLease`, `claimStale`, `finish` |
| `…/computer` | the brand VM lifecycle: `ensureComputer`, `touchComputer`, `sleepIdleComputers`, `sandboxIdleMs` |
| `…/memory-context` | `loadMemoryContext` — newest first, inside `MAX_AGENT_MEMORY_BYTES` (32 KB) |
| `…/tools/builtin` | `BUILTIN_TOOLS` — the declarative catalogue the model sees, plus `TERMINAL_TOOL_NAMES`. Delegation is NOT here: it lives per-surface (`chat/subagents.ts`) so the model never sees a tool nobody executes |

## Example

The executor takes kit interfaces, never concrete implementations — which is why a test can wire
it entirely out of the testkit:

```ts
import { createApplyTool } from '@anomalia/agent-core/executor';
import { createMemoryBrandFs, createMemorySandbox, createMemoryStore, fakeContext } from '@anomalia/agent-kit/testkit';

const applyTool = createApplyTool({
  brandFs: createMemoryBrandFs({ 'brand/studio.md': '# voice' }),
  sandbox: createMemorySandbox(),
  sandboxRef: null,
  memory: createMemoryStore(),
  plugins: []
});

await applyTool({ name: 'read', args: { path: 'brand/studio.md' } }, fakeContext());
```

A turn has three endings, and `ask_user` is not one of the terminal ones:

```ts
const outcome = await runTurn(db, runtime, applyTool, input);
outcome.reason;  // 'reply' | 'waiting_input' | 'completed' | 'step_limit' | 'token_budget' | 'deadline' | 'aborted'
outcome.reply;   // the message for the user, already resolved (explicit reply > turn text > null)
```

`waiting_input` leaves the run **alive** in the database: the resume starts from there, not from a
cold context.

## What it does NOT do

- It does not stream to the user. `runTurn` reports; the surface above it consumes `onEvent`.
- It does not execute `reply`, `ask_user` or `plan` — speaking, waiting and showing a plan are the
  orchestrator's effects, not the executor's.
- It does not create a Supabase client, read env, or know which model provider answered.
- It does not invent a message. A silent turn gets `honestNotice` (in `agent-contracts`), never a
  generated summary.
