# Via agent-lab, gli shim morti e l'endpoint chat senza chiamanti

Secondo passo dello smantellamento delle chat. Qui non c'è niente che un
utente usi: sparisce un prototipo dev-only, nove shim di re-export che non
importa più nessuno, un componente orfano e un endpoint documentato come
senza chiamanti.

## Perché questo e non il resto

Il piano prevedeva di togliere in questo passo tutto `/api/v1/chat/**`, il
tool MCP `chat` e i due cron. **Verificando uno per uno, tre di quei cinque
endpoint hanno chiamanti vivi**, e toglierli adesso romperebbe roba che
resta in piedi fino alle PR successive:

- `chat/feedback` — lo chiamano `ChatColumn.svelte:1302` e
  `chat/[thread]/lifecycle.svelte.ts:171`, cioè la chat che è ancora lì.
- `chat/queue/work` — lo chiama `kickChatQueueWork` in `server/chat/queue.ts`,
  e da lì **`video-render-queue.ts`**: quando un render finisce, rientra in
  conversazione e dà la sveglia alla coda. È un generatore che passa da un
  endpoint chiamato "chat".
- `chat/models/sync` — scrive `chat_model_catalog`, che leggono
  `server/llm.ts`, `server/chat/model.ts` (uno dei sette moduli condivisi che
  restano) e `bridge/adapters.ts`. Il listino modelli **non è della chat**:
  serve anche a media generator e motion video. Il nome inganna.

Il tool MCP `chat` non chiama `/api/v1/chat` ma `/app/{slug}/chat`
(`cli/lib/api.ts:501`), quindi va tolto insieme alle rotte dell'app, non qui.

Quindi questi quattro scendono con le PR che tolgono la chat che li usa —
dalla foglia alla radice, che è l'ordine che evita di rompere `dev` in mezzo.

## Cosa se ne va

**`agent-lab`** (4 file) — prototipo `!dev → 404` del sistema di agenti che
stiamo togliendo. Con lui `client/service.ts` e `client/store.svelte.ts`, che
non aveva nessun altro.

**Verificato uno per uno, non assunto.** `run-store.ts` **resta**: lo usa
`scripts/eval/durability.ts`, l'unico eval vivo del repo. `specs.ts` **resta**:
lo legge `server/chat/agents.registry.test.ts`. E soprattutto `executor.ts` e
`turn.ts` **restano**, contro il censimento iniziale che li dava come
esclusivi di agent-lab: li importa anche `bridge/live.ts` (righe 52 e 54),
cioè la chat. Scendono con lei.

**Nove shim di re-export** senza un solo importatore: sette in `adapters/`
(`brand-fs`, `brand-fs-emulator`, `checkpoint-emulator`, `memory-emulator`,
`memory-postgres`, `sandbox-emulator`, `vercel-sandbox`), più
`runtime/ai-runtime.ts` e `notice.ts`. Residui dello split in pacchetti: il
codice vero importa `@anomalia/agent-adapters/...` direttamente da un pezzo.
Attenzione a non confonderli — `adapters/graphical-bootstrap.ts` e
`adapters/checkpoint-storage.ts` **hanno** importatori (le rotte
`agents/computer/*` e `api/v1/agents/computers/sweep`) e restano.

**`ChatSessionMemory.svelte`** — 233 righe, zero importatori già da prima.
L'unico riferimento erano sei righe di allowlist in `ui-tokens.test.ts`.

**`/api/v1/chat/run`** — il commento in `queue.ts:1537` lo diceva già: «has no
caller anywhere in the repo». Nessun cron lo chiama. Tolti anche i due
commenti che lo davano come via di ripresa ancora attiva: un commento scaduto
fa più danno di nessun commento.

## Tabelle non toccate

Nessuna migration.
