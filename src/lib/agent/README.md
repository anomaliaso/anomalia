# `src/lib/agent/` — gli agenti, ricostruiti

La forma: **tutto ciò che deve essere sostituibile è un'interfaccia; ogni implementazione porta il suo
emulatore; il catalogo dei tool è dichiarativo e l'esecuzione sta in un posto solo.**

## Dove vive il codice oggi: npm workspaces (`packages/*`)

Il modulo è diviso in pacchetti (`packages/*`, npm workspaces — niente pnpm, niente build step:
gli `exports` dei `package.json` puntano diretto ai `.ts` sorgente). Ogni vecchio percorso sotto
`src/lib/agent/` resta com'era: è uno SHIM di una riga (`export * from '@anomalia/...'`) — niente
import esistente si è rotto, `$lib/agent/executor` funziona esattamente come prima.

| pacchetto | cosa | dipende da |
|---|---|---|
| `@anomalia/agent-kit` | `kit/{types,interfaces,registry}.ts` + `testkit.ts` — tipi puri + interfacce + registro + emulatori di test. **Zero import.** | — |
| `@anomalia/agent-contracts` | `contracts.ts` (agente = riga, `instructions` ≤ 20k; macchina a stati del run con `waiting_input` persistito), `specs.ts` (i cinque specialisti), `notice.ts` (il ripiego onesto) | agent-kit (type-only), zod |
| `@anomalia/agent-core` | `executor.ts` (`applyTool`, UN punto di esecuzione), `turn.ts`, `run-store.ts`, `computer.ts`, `memory-context.ts`, `tools/builtin.ts` (catalogo dichiarativo, ≤ 14 tool, niente handler) | agent-kit, agent-contracts, agent-adapters (solo `graphical-bootstrap` per `observe`/`act`) |
| `@anomalia/agent-adapters` | sandbox (`vercel-sandbox.ts` + `sandbox-emulator.ts` — i test girano sull'emulatore, mai sulla rete), modo grafico (`graphical-bootstrap.ts`, Xvfb+Chromium), memoria markdown ≤ 32 KB sopra `brand_memory` (`memory-postgres.ts`), home filesystem del bot sopra il database (`brand-fs.ts`), checkpoint (`checkpoint-storage.ts`), il ciclo sopra `ai` v6 (`runtime/ai-runtime.ts`, swappabile: è un `AgentRuntime`), provider modelli kie/deepseek/gemini/xiaomi come `ModelAdapter` (`runtime/models.ts`) | agent-kit |
| `@anomalia/agent-client` | `service.ts` (client HTTP verso `agent-lab/turn`), `store.svelte.ts` (lo store Svelte 5 con le rune, per la UI del lab) | agent-kit, agent-contracts |

`src/lib/agent/plugins/` e `src/lib/agent/bridge/` **restano nell'app**, non sono pacchetti: sono
il cablaggio di QUESTO repo verso `src/lib/server/*` (il "adapter" dell'app, non del kit).
`bridge/adapters.ts` in particolare è l'UNICO punto che importa insieme un pacchetto e
`$lib/server/*` — ogni adapter di `agent-adapters` che ha bisogno di qualcosa da $lib (creare i
tool sui file, leggere/scrivere `brand_memory`, aprire la sandbox Vercel, risolvere il modello
chat) lo chiede come **dep del costruttore**, mai come import diretto: un pacchetto non può
importare `$lib/*` o `$env/*` (non esistono fuori da SvelteKit) — `packages/no-app-imports.test.ts`
lo verifica ad ogni commit, file per file.

**Sulla naming**: questa tabella sostituisce una versione precedente che chiamava i pacchetti
`packages/adapter-kit` e `packages/contracts` — nomi mai esistiti nel codice. I pacchetti veri sono
`@anomalia/agent-{kit,contracts,core,adapters,client}`, come sopra.

## Le tre regole che non si negoziano

1. **Il contratto non importa implementazioni.** `agent-kit` non ha un solo import. Se un file
   di quel pacchetto importa da fuori, la PR è sbagliata.
2. **Parlare è un atto esplicito.** Il turno finisce con `reply` o `ask_user`; tutto il resto
   è appunti di lavoro. `ask_user` NON chiude il run: lo mette in `waiting_input`, persistito.
3. **Ogni tetto è dichiarato.** Un risultato tagliato lo dice; un budget superato nomina il
   numero; un prompt oltre `SYSTEM_PROMPT_MAX_CHARS` esplode in test, non in produzione.

## Il cablaggio verso la chat vera

`bridge/live.ts` è il ponte verso `src/routes/app/[brand]/chat/+server.ts`, dietro il flag
`AGENT_KIT` (vedi `shouldUseKit` in quel file) e uno specialista riconosciuto sul thread — non è
più "non ancora cablato": il motore vecchio resta il default, il nuovo si attiva per riga quando
il flag è acceso.
