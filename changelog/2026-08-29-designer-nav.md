# Designer di nuovo in sidebar

La sezione Designer era uscita dalla nav (2026-08-22) per scelta: le pagine
restavano su disco e raggiungibili dai link della chat, da `propose_open_tab` e
da ⌘K. Questa modifica la rimette in sidebar come prima.

Cosa c'era prima: la voce mancava da `macros` (nav legacy, flag
`FEATURE_NAV_TEAM` OFF) e da `HUB_TABS`/`WORKBENCH_PAGES`/`WORKBENCH_HUBS` in
`workbench-paths.ts`. Pagine e i18n (`app.hub.designer.*`, `app.hub.overview.designer.*`)
sono sempre esistite: la landing `/designer` con le sue quattro card e le rotte
`media-generator`, `ugc-creator`, `motion-video`, `media`.

Decisioni:
- Ripristino nel percorso legacy (quello attivo col flag OFF, che è il default):
  voce di `macros` con icona `Sparkles` + riga di `HUB_TABS.designer`. I pin del
  test `workbench-paths.test.ts` (HUB_TABS e WORKBENCH_HUBS.length) son stati
  aggiornati di conseguenza.
- La nav "La squadra" (flag ON) resta com'era: `NAV_TEAM_TOOLS` la escludeva
  per scelta ("non deve tornare col flag"). Non l'ho toccata: è una gerarchia
  diversa e spenta di default. Se in futuro si vuole, è un secondo intervento.

Scartato: aggiungere Designer alla nav team nel stesso commit — sarebbe stato
un cambio di gerarchia (flag ON) mescolato a un ripristino del percorso legacy
(flag OFF), due comportamenti distinti da valutare a parte.
