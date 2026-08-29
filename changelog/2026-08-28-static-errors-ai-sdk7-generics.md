# Static errors: 415 → 263 (tsc), 456 → 304 (svelte-check)

## Perché

Il reaper dei static errors trova il debito: `tsc --noEmit` e `svelte-check` su `dev`
riportavano centinaia di errori, così un errore nuovo si annega in quelli vecchi e la
gate `typecheck-runtime` (che filtra solo TS2304/18004/2552/2554/2555) resta l'unica
difesa. Questo run accende la prima fetta di silenzio: i cluster a radice unica.

## Cosa c'era prima

Il codice era scritto contro l'API precedente di `ai` (v6): `ToolExecutionOptions`
senza tipo generico, `StreamTextResult<ToolSet>` a un argomento. L'upgrade a `ai@7`
ha reso `ToolExecutionOptions<CONTEXT>` e `StreamTextResult<TOOLS, RUNTIME_CONTEXT,
OUTPUT>` generici obbligatori: 78 errori `TS2314` su 21 file, tutti la stessa radice.

## Decisioni

- `ToolExecutionOptions<unknown>` nei 21 file: nessun tool di chat legge `opts.context`,
  quindi `unknown` è il tipo onesto (il default dell'SDK è `any`; qui si dice unknown).
- `StreamTextResult` in `adapters.ts` non si annota a mano: il tipo vero è quello che
  `HarnessAgent.stream` restituisce, e il cast a `StreamTextResult<ToolSet>` lo nascondeva.
  Alias `HarnessStreamResult = Awaited<ReturnType<InstanceType<typeof HarnessAgent>['stream']>>`
  e i due cast spariscono.
- `wrapTools` restituiva `out as T` — una menzogna: l'execute avvolto accetta due
  argomenti, l'originale anche zero. Mapped type `WrappedTools<T>`: l'execute del tool
  avvolto è `(input, opts) => Promise<unknown>`; i test che chiamavano `.execute(a, b)`
  su execute a zero argomenti smettono di essere errori perché ORA il tipo dice la verità.
- `attachHarness` sostituisce `prepareStep` con uno che accetta `{ stepNumber }` e torna
  `Record<string, unknown>`: i test che seminavano `prepareStep: () => ({})` annotano
  ora la firma reale.
- `queue-dm.test` non era ermetico: `$env/dynamic/private` in vitest porta dentro il
  `.env` LOCALE, e con `AGENT_KIT=on` il turno scappava nel ramo kit (live.ts), dove il
  mock di `./subagents` non ha `createSubagentTools`. Sul checkout principale passava
  solo per cache Vite stantia. Fix: il test fissa `AGENT_KIT: 'off'` — percorso classico,
  che è quello che intende provare. Lezione in LESSONS.md.

## Scartato

- `as any` / `@ts-ignore` come scorciatoia: proibiti dalle regole del repo, ogni errore
  risolto alla radice.
- `ToolExecutionOptions<Record<string, unknown>>` ovunque: `unknown` basta dove il
  context non si tocca; `Record` solo nell'agent-lab, dove l'execute lo esige.
