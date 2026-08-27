# `@anomalia/agent-kit`

The contract layer of the agent runtime: **types, interfaces, a registry, and in-memory
emulators**. It has zero imports — not "few", zero. Everything else in `packages/` depends on it;
it depends on nothing.

Position in the graph: **kit** → contracts → core → adapters / client.

## What's in it

| Export | What |
|---|---|
| `@anomalia/agent-kit` | everything below, re-exported (`types` + `interfaces` + `registry`) |
| `…/types` | `AdapterContext`, `ToolSpec`, `ToolCall`, `ToolResult`, `RunEvent`, `RunStopReason`, `RunRequest`, `ModelRef`, `SandboxRef`, `MemoryEntry`, … |
| `…/interfaces` | `AgentRuntime`, `ModelAdapter`, `SandboxProvider`, `CheckpointStore`, `MemoryStore`, `BrandFs`, `ToolPlugin` |
| `…/registry` | `Registry<T>` — a typed map per adapter family |
| `…/testkit` | in-memory fakes: `fakeContext`, `createMemoryBrandFs`, `createMemorySandbox`, `createMemoryStore`, `fakePlugin` |

## Example

An unregistered adapter is a startup error that names the available keys, not an `undefined`
three call frames later:

```ts
import { Registry } from '@anomalia/agent-kit';
import type { ModelAdapter } from '@anomalia/agent-kit';

const models = new Registry<ModelAdapter>('model');
models.register('kie', kieAdapter);
models.resolve('deepseek'); // Error: model: 'deepseek' non registrato — disponibili: kie
```

The testkit is what lets the agent suite run with no network, no database and no VM:

```ts
import { createMemoryBrandFs, fakeContext } from '@anomalia/agent-kit/testkit';

const fs = createMemoryBrandFs({ 'brand/studio.md': '# voice\nplain, short' });
await fs.read('brand/studio.md', fakeContext());
```

## What it does NOT do

- No implementations. `AgentRuntime` is declared here and implemented in `agent-adapters`.
- No zod, no validation — the domain schemas live in `@anomalia/agent-contracts`.
- No `$lib/*` or `$env/*`. No package here may import them (`packages/no-app-imports.test.ts`).
- Only interfaces we implement today. Voice, notifications and connector auth are deliberately
  absent: an interface with no implementation is weight, not architecture.
