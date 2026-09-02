# Il mix lo decide chi pianifica, con il listino in mano

Il formato di un post lo sceglievano numeri che nessuno aveva scelto guardando niente:
un carosello per batch da una variabile d'ambiente, i video come percentuale fissa
della quota di post, e `maxVideos: 1` scritto a mano su onboarding, anteprima e chat.
Nessuno di questi sa cosa costa quello che sceglie, quindi la scelta che conta —
questa settimana un fumetto da otto riquadri o due video? — non era di nessuno.

`content-cost.ts` è il listino, in un posto solo e **misurato**, da `ai_calls` in
produzione al 31/08/2026: un'immagine costa $0.069 di render più $0.008 del critico che
la rilegge, una clip $1.181 su 97 render veri, il testo di un batch $0.095 comunque sia
composto. Ne esce che **un video vale ~16 immagini singole** — il commento in
`weekly-planner.ts` diceva 25, e un rapporto sbagliato nel prompt sbaglia il prezzo
proprio della decisione più cara che l'agente prende.

Il planner riceve quel listino insieme ai suoi crediti e lo spende; il gate di
fattibilità rifiuta un batch che il brand non può produrre — prima del primo render,
non a metà con nove post fatti e sei vuoti. E il tetto ai caroselli smette di fare art
direction da una variabile d'ambiente: di default non c'è più tetto editoriale, resta
il freno d'emergenza. Il tetto alle SLIDE resta, perché quello è fisico.

**E per gli articoli era un buco, non un miglioramento.** `estimateBlogMonth` esisteva
apposta per non far partire un mese che non può finire, ma era collegato al solo
bottone manuale: `planBlogMonth` — autopilot e scheduler — pianificava per quota e non
guardava il costo. Cioè esattamente il guasto scritto in cima a `blog-cost.ts`, lasciato
aperto sul percorso che gira da solo. Ora `articlesAffordable()` taglia il mese a quello
che i crediti coprono, traduzioni comprese, e con budget sconosciuto non taglia niente:
un vincolo inventato è peggio di un vincolo assente.

Da rimisurare quando cambia il modello di default: i numeri sono medie e mediane di un
momento, non tariffe. Una tariffa copiata in un secondo posto è il difetto che
`blog-cost.ts` ha già pagato una volta.
