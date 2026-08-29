# Il chat-text non ha più una catena di provider di riserva

La migrazione al centralino LLM (PR #10) ha reso morta la vecchia catena multi-provider del
chat-text: risoluzione tier per kie/deepseek/xiaomi, `legacyFallback`, `takeKieUsage` (un no-op su
ogni turno reale), e la macchina provider dell'harness (`HarnessProviderName`, `activeProvider` con
`CHAT_PROVIDER`/`HARNESS_PROVIDER`, liste `OPENROUTER_MODELS`/`OPENCODE_MODELS`). Il registro
adattatori in `packages/agent-adapters/src/runtime/models.ts` era esercitato solo dai suoi test.

Cosa è stato cancellato, verificato chiamata-per-chiamata prima di ogni rimozione:

- `chat/model.ts` −~230 righe: `resolveTier`, `resolveLuna`, `resolveGrok`, `legacyFallback`,
  `kieCodex`, `kiePro`, `lunaFast`, `deepseekChat`/`deepseekPro`, i config-check per provider,
  `kieClient`/`kieMeteredFetch`/`scanCredits`, `takeKieUsage` + il campo `takeCredits?` che
  alimentava, e `geminiCallOptions` (trovato morto durante la verifica).
- 7 call site di `takeKieUsage` smontati meccanicamente (queue, turn-finish, respond/run, room,
  compaction, subagents) e le chiavi `takeKieUsage` morte nei mock di 5 test.
- `adapters.ts` −~120 righe: collassata a `llm`-only; `ensureKieAgentDir` scrive solo la voce llm
  nel `models.json` del pi harness. Unica sfumatura di comportamento: non consulta più i
  `*_BASE_URL` per-provider.
- Registro `packages/agent-adapters` runtime/models + shim `src/lib/agent/runtime/models.ts`
  cancellati; export `./runtime/models` rimosso dal package.json.
- `.env.example` e compose: `CHAT_PROVIDER` rimosso, contraddizione AGENT_KIT (riga 71 vs 417)
  sistemata sul default reale (off), KIE_API_KEY riscoperta come solo-media/GEO.

Non toccato di proposito: `AGENT_KIT` e il motore classico (fase successiva, richiede il porting
DM/room/persona nel bridge), `$lib/server/kie.ts` (immagini/video/TTS/GEO ancora vivi),
`ChatModelResolved.provider` tenuto largo per non far ripple nelle typings di log.
