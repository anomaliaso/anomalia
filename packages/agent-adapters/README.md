# `@anomalia/agent-adapters`

The implementations: **every kit interface, wired to something real — and every one of them
paired with an in-memory emulator** so the test suite never opens a socket.

Position in the graph: kit → contracts → core → **adapters**.
Depends on `@anomalia/agent-kit`, `ai` (SDK v6), `@ai-sdk/openai`, `@supabase/supabase-js`.

Nothing here imports `$lib/*` or `$env/*` — the real functions of this repo arrive as constructor
deps, injected in one place only (`src/lib/agent/bridge/adapters.ts`).

## What's in it

| Interface | Real | Emulator |
|---|---|---|
| `AgentRuntime` | `runtime/ai-runtime` (`AiRuntime`, over `streamText`) | — (tests script the model) |
| `ModelAdapter` | `runtime/models` (`createModelAdapters`, `createModelResolver`) — kie / deepseek / gemini / xiaomi behind one registry | — |
| `SandboxProvider` | `vercel-sandbox` (`VercelSandboxProvider`) | `sandbox-emulator` |
| `BrandFs` | `brand-fs` (`ServerBrandFs`, the brand tree projected out of the database) | `brand-fs-emulator` |
| `MemoryStore` | `memory-postgres` (`PostgresMemoryStore`, markdown ≤ 32 KB over `brand_memory`) | `memory-emulator` |
| `CheckpointStore` | `checkpoint-storage` (the `agent-homes` bucket) | `checkpoint-emulator` |
| — | `graphical-bootstrap` — Xvfb + openbox + Chromium inside the sandbox, plus `captureScreenshot` / `runActions` for `observe` / `act` | (driven through the sandbox emulator) |

## Example

Dependency injection is the whole design; the adapter declares what it needs, the app hands it
over:

```ts
// src/lib/agent/bridge/adapters.ts — the only file that imports a package and $lib/server together
import { PostgresMemoryStore } from '@anomalia/agent-adapters/memory-postgres';
import { loadMemoryEntries, writeMemory } from '$lib/server/brand-memory';

new PostgresMemoryStore(supabase, { loadMemoryEntries, writeMemory });
```

And in a test, the same interface with no database at all:

```ts
import { MemoryEmulator } from '@anomalia/agent-adapters/memory-emulator';

const memory = new MemoryEmulator();
await memory.commit('brand-test', 'content', { path: 'voice/tone', content: 'short, plain' }, ctx);
// path is `category/key` — voice, constraint, fact, preference, insight, skill; anything
// else throws with the accepted list named.
```

## What it does NOT do

- It does not reimplement what `src/lib/server/*` already does. `ServerBrandFs` wraps
  `createFileTools`, `VercelSandboxProvider` wraps `openBrandSandbox`, `runtime/models` wraps
  `resolveChatModel` — the translation is to the kit's shape, and that is all.
- It does not choose the model tier or set the token budget: those arrive as deps
  (`chatTokenBudget`, `chatTurnDeadline`, `resolveModel`).
- It does not read env. `VERCEL_OIDC_TOKEN` and friends are passed in.
- `BrandFs.write` is optional and the emulators say so through `describe().capabilities` — a
  missing capability is declared, never silently a no-op.
