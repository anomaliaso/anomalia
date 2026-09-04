# Via i file che nessuno importa

39 file cancellati, 2.026 righe. Nessun refactor: solo cancellazioni, piu' le due
correzioni che tengono verde la suite.

## Cosa spariva

| file | righe | perche' e' morto |
| --- | --- | --- |
| `src/lib/components/OnboardingChecklist.svelte` | 482 | nessuna pagina lo monta |
| `src/lib/components/PublishHeatmap.svelte` | 294 | zero occorrenze del nome nel repo |
| `src/lib/components/ui/select/` (12 file) | 292 | barrel shadcn mai importato |
| `src/lib/components/ui/card/` (8 file) | 181 | idem |
| `src/lib/components/ui/avatar/` (7 file) | 157 | idem |
| `src/lib/components/ui/tabs/` (5 file) | 122 | idem |
| `src/remotion/StyleReel.tsx` | 188 | `Root.tsx` registra solo `Design` e `MotionAd` |
| `src/remotion/mount-style-reel.ts` | 119 | monta il componente qui sopra |
| `src/lib/server/meta-capi.ts` | 106 | `metaCapiEvent`/`metaCapiPurchase` mai chiamati |
| `src/lib/server/creative-script.ts` | 103 | `extractCreativeScript` mai chiamato |
| `src/params/bloglang.ts` | 9 | nessuna rotta usa `[...=bloglang]` |

## Come ho provato che erano morti

Non «i test passano»: un file morto non rompe nessun test **proprio perche'** e' morto.
La prova e' il censimento degli importatori.

1. **Grafo degli import.** Ho risolto ogni specificatore (`$lib/…`, relativi, `@anomalia/*`,
   con lo swap `.js` -> `.ts` e le forme `import 'x'`, `import()`, `vi.mock`) e fatto una
   BFS dai veri punti d'ingresso: i file di convenzione SvelteKit (`+page*`, `+layout*`,
   `+server.ts`), `src/params/*`, hooks, service worker, worker, `Root.tsx`, i test, gli
   entrypoint di `cli/` e gli script citati in `package.json`. Questi 39 file non sono
   raggiunti da nessuna radice.
2. **Accesso dinamico.** Le due glob che contano — `src/lib/content/changelog/index.ts`
   (`./2*.ts`) e `PageModal.svelte` (`/src/routes/app/**/+page.svelte`) — sono state messe
   fra le radici: nessuno dei 39 ci cade dentro.
3. **`git grep` del nome nudo** su tutto il repo (`src`, `packages`, `cli`, `scripts`,
   `supabase`, `.github`, `vercel.json`). Le uniche occorrenze rimaste sono **commenti**:
   `email.ts` e `setup-checklist.ts` citano OnboardingChecklist a parole,
   `analytics.ts` cita `metaCapiEvent` come controparte server, `presets/shared.ts` e
   `bake-style-reels.ts` nominano StyleReel per analogia. Nessun import, nessuna chiamata.
4. **`[...=bloglang]`**: i soli matcher usati dalle rotte sono `indexnow`, `locale`, `md`.

## Le due correzioni che accompagnano

- `src/lib/ui-tokens.test.ts` — tre voci di `LEGACY_STRAYS` puntavano a
  OnboardingChecklist. Il test asserisce che il debito **puo' solo scendere**: lasciarle
  lo avrebbe fatto fallire.
- `src/lib/workbench-paths.ts` — `BRAND_MODAL_ROUTES` elencava ancora `agent-lab`, rotta
  cancellata da `b6eead1`. `page-modal-tiers.test.ts` era **gia' rosso su `dev`** per
  questo; la riga se ne va con gli altri riferimenti a codice inesistente.

## Cosa NON ho toccato, e perche'

- `src/lib/server/c2pa-node.d.ts` sembra orfano ma serve a `content-credentials.ts`:
  dichiara un modulo installato di proposito **no**, importato dinamicamente.
- `src/lib/i18n/index.ts` non ha importatori con `from`, ma `src/routes/+layout.ts` fa
  `import '$lib/i18n'` per l'effetto collaterale (`register` + `init`).
- `src/lib/blog-locales.ts` resta: muore solo il matcher di rotta.
- Le altre 14 cartelle sotto `src/lib/components/ui/` sono vive.
