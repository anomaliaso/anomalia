# 63 script che nessuno lancia piu'

8.045 righe sotto `scripts/`. Uno script non si prova con «chi lo importa»: si prova
con **chi lo lancia**. Le tre strade sono `package.json`, `.github/workflows/` e la
documentazione. Nessuno di questi 63 file compare in nessuna delle tre.

## Come ho fatto il censimento

```
scripts citati in .github/workflows/ : release-notes.mjs, typecheck-runtime.mjs,
                                       update-homebrew-formula.sh
scripts citati in docs/ + i .md di radice : db-seed.mjs, eval/, install.sh,
                                            schema-drift-check.mjs, typecheck-runtime.mjs
scripts citati in package.json       : i 19 comandi npm
```

Tutto il resto e' stato incrociato col grafo degli import (nessuno di questi file e'
raggiunto da una radice) e con un `git grep` del nome nudo su tutto il repo. Le uniche
occorrenze sopravvissute erano **quattro commenti** che nominavano lo script: sono
scomparse con lui, perche' un commento che rimanda a un file inesistente e' peggio di
nessun commento.

## Cosa spariva, per famiglia

- **Infrastruttura rotta o doppia** — `_dump-tools.ts` importa
  `../src/lib/server/chat/tools`, che non esiste piu'; `_vn.config.ts` e' una copia di
  `vite-node.config.ts` citata solo in un commento; `_shims/env-dynamic-private.ts` e
  `env-dynamic-public.ts` non sono aliasati da nessuna delle due config (che puntano a
  `env-private.ts` / `env-public.ts`); `_prompt-size.ts` gira solo con `_vn.config.ts`.
- **`scripts/talent/`** (20 file) — generatore di prototipo per la libreria talent, col
  suo `VALERIA.md` che si dichiara «prototype». I talent oggi stanno nel database e si
  leggono con `read_talents`: il generatore non ha piu' un consumatore.
- **`scripts/debug/`** (7 file) — sonde una-tantum sul kit/pi, scritte per un incidente
  e mai richiamate.
- **Generatori di asset one-shot** (9) — `gen-ads`, `gen-og`, `gen-readme-hero`,
  `gen-agosto-hero`, `gen-plan-hero`, `gen-brand-posts`, `gen-insights-gemini-images`,
  `build-strategy-page`, `eval-visuals`. Hanno gia' prodotto quello che sta in `static/`.
- **Verifiche manuali superate da Playwright e dall'eval** (10) —
  `settings-modal-check`, `modal-query-check`, `home-responsive-check`, `palette-check`,
  `chat-knowledge-panel-check`, `collaudo-query-e-history`, `verify-demo-capture`,
  `verify-platform-terms`, `worker-soak-report`, `pi-suspend-resume`.
- **Runner ad-hoc contro agenti e API** (11) — `run-agents-smoke`, `run-produce-agent`,
  `run-strategy-agent`, `market-dry-run`, `preview-disruptive-ideas`, `propose-gtm`,
  `manual-radar-scan`, `test-ugc-media-generator`, `test-ugc-seedance-blocks`,
  `cleanup-empty-chat-threads`, `inspect-provenance`.

## Cosa resta, e perche'

`schema-drift-check.mjs` (CLAUDE.md lo prescrive dopo ogni migration),
`bake-motion-library` e `bake-style-reels` (comandi npm), `build-worker.mjs`,
`typecheck-runtime.mjs`, `release.mjs`, `release-notes.mjs`, `db-migrate`, `db-seed`,
`realtime-policy-harness`, `export-oss`, `tool-e2e/`, `eval/` e i quattro shim
effettivamente aliasati. `run-strategy-lab.mjs` se ne va nella PR delle rotte, insieme
all'endpoint `strategy-lab` che era il suo unico bersaglio.

Se uno di questi 63 tornasse utile, e' a un `git show` di distanza. Un file morto in
piu' costa una riga; sessantatre costano una cartella che non si legge piu'.
