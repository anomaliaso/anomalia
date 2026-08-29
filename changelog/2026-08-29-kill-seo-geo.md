# Kill superficie SEO/GEO

## Perché

Audit budget #1 (finestra 30 lug → 29 ago, dati reali da `ai_calls` + PostHog):

- SEO (crawl, ranks, keywords, review, links, backlinks/external, gsc): $3.87/30d
  di AI ma **zero output** — `brand_rank_snapshots` è vuota da sempre, il rank
  tracker non ha mai scritto una riga.
- GEO (audit citazioni, reprobe): $20.48/30d su 52 brand, con un motore di
  ricerca secondario (`deepseekSearch`) che fallisce il 73% delle volte pagando
  a tariffa piena.
- 9 crons dedicati girano ogni giorno/settimana per popolare pagine che la
  maggior parte dei brand non apre.

Decisione del product owner (2026-08-29): le pagine SEO/GEO si spengono,
l'auto-blog resta (15 articoli pubblicati/30d con $5.27 di AI — il miglior
rapporto output/costo del prodotto). Motion video, il kill candidate più
pesante dell'audit, è deferito: decisione di prodotto, non di costo.

## Cosa è stato fatto

Disablement minimo, tutto commentato e mai cancellato — il revert è
decommentare:

- `vercel.json`: 9 crons SEO/GEO commentati (JSONC). Nessun processo
  automatizzato riparte più.
- `workbench-paths.ts`: voci nav commentate in `HUB_TABS.web`,
  `WORKBENCH_PAGES` e `NAV_TEAM_TOOLS`. Sidebar, rail, palette e modal non
  linkano più le pagine.
- `web-activation.ts`: il passo "GEO audit" esce dal funnel di attivazione.
- Onboarding checklist (sidebar + home) e gauge/metric card della home:
  step e link SEO/GEO commentati; le gauge restano visibili come display
  passivo, senza link.

Le rotte (`/app/[brand]/seo|geo|keywords|backlinks`), i moduli server, le
tabelle (`brand_geo_audits`, `brand_rank_snapshots`, `brand_seo_plans`,
`brand_backlink_*`) e i tool chat on-demand restano intatti: chi ha un link
diretto vede i dati storici, nessuna migrazione, nessun dato toccato.

## Scartato

- Cancellare le rotte e i moduli: rompe i link diretti e i revert; il costo
  inattivo di codice non chiamato è zero.
- Tagliare i tool chat `seo`/`geo`: sono on-demand e gated dai crediti, il
  costo è scelto dall'utente, non dal cron.
