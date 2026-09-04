# La variante `neutral` di TopbarCta non ha piu' nessuno

69 righe fra `TopbarCta.svelte` e `PageTopBar.svelte`.

## Cosa spariva

- `TopbarCta.svelte`: `variant?: 'primary' | 'ghost' | 'neutral'` torna a due valori, via
  la riga `class:neutral={...}` e le cinque regole `.topbar-cta.neutral*`.
- `PageTopBar.svelte`: le cinque regole `:global(.topbar-cta.neutral*)` che la
  rivestivano dentro la topbar.

## Perche' e' morta

`4cdcdb1` ha tolto il pannello del desktop agentico da
`src/routes/app/[brand]/chat/[thread]/+page.svelte`. Era **l'unico** posto che passasse
`variant="neutral"`. Dopo quella rimozione l'unica occorrenza rimasta in tutto il repo
stava in `topbar-cta.test.ts`, che asseriva sul markup del pannello appena cancellato —
un test rimasto senza soggetto, che la #262 elimina. Tolto il test, la variante non ha
piu' **nessun** riferimento.

`TopbarCta` resta viva e molto usata (agents, backlinks, competitors, geo, gtm,
keywords, seo, site): muoiono solo `neutral` e il suo vestito.

## Come l'ho provato, e la trappola che ci sta sotto

Un `grep` di `variant="neutral"` su tutto `src` non trova nessun consumatore.

Ma il punto vero e' un altro, ed e' una lezione che oggi ha fatto diventare rossa `dev`
tre volte: **77 test in `src` leggono un sorgente con `readFileSync` e asseriscono sul
suo testo, senza importarne un simbolo.** Cancellare quel sorgente non rompe nessun
import: un censimento fatto sul grafo degli import non se ne accorge, e il guasto arriva
in CI. Peggio, il nome del test non dice cosa controlla — `topbar-cta.test.ts` asseriva
sul pannello del desktop agentico, e nessuna suite scelta «per area» lo avrebbe caricato.

Da qui in avanti il cancello prima di ogni cancellazione e' questo:

```
npx vitest run $(git grep -ln "readFileSync" -- 'src/**/*.test.ts') > /tmp/src-read.log 2>&1
```

Qui: **79 file, 1.116 test, verdi** — e `ui-tokens.test.ts`, che sta in quel gruppo,
copre anche i token CSS che queste regole usavano.
