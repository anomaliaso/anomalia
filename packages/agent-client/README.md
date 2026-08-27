# `@anomalia/agent-client`

The browser half: **an HTTP transport and a Svelte 5 store** for the agent lab chat. It is the
only package meant to run in a browser bundle.

Position in the graph: kit → contracts → **client** (it never touches core or adapters).
Depends on `@anomalia/agent-{kit,contracts}` — type-only from the kit, and `honestNotice` from
contracts, which has no runtime imports precisely so this bundle stays small.

## What's in it

| Export | What |
|---|---|
| `…/service` | `createAgentService({ baseUrl, fetchFn? })` → `sendTurn(args, onEvent?)` / `abort()` against the `agent-lab/turn` endpoint; `TurnPayload`, `EventItem`, `ChatMessage` |
| `…/store.svelte` | `createChatStore(service, locale)` → `ChatStore` — `messages`, `status`, `pendingQuestion`, `lastRun`, `error` as runes, plus `send`, `answer`, `reset`, `abort` |

## Example

```ts
import { createAgentService } from '@anomalia/agent-client/service';
import { createChatStore } from '@anomalia/agent-client/store.svelte';

const store = createChatStore(createAgentService({ baseUrl: '/app/acme/agent-lab' }), 'en');
await store.send('content', 'plan next week');
if (store.status === 'waiting_input') await store.answer('yes, Tuesday');
store.status;          // 'idle' | 'running' | 'waiting_input' | 'error'
store.pendingQuestion;  // set when the run is parked in waiting_input
```

## What it does NOT do

- The store never fetches: it only talks to `AgentService`. It does not know the URL, the verb, or
  the response shape beyond `TurnPayload`.
- The service knows no framework: no Svelte import, no runes. The store uses it; it doesn't know.
- Neither of them decides what the user reads. The reply arrives already resolved by the server
  (`agent-core/turn`); when it is `null`, the store shows `honestNotice` — a factual line, never a
  summary invented on the client.
- No streaming yet. `/turn` answers with the whole turn at the end, so `onEvent` is replayed from
  the final payload. When the endpoint moves to SSE, `sendTurn` changes inside and its signature
  does not.
