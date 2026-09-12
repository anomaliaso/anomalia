# La home del brand torna a disegnarsi

Quattro cose sulla stessa pagina, e una sola contava davvero.

## Lo shimmer che non finiva mai

La home restava sul caricamento per sempre. Il sospetto naturale era la promessa in streaming
di `loadHomeOverview`: sbagliato, e la sonda lo ha detto in un minuto — la promessa si risolve
(805 ms, dati completi, entrambi i chunk nel `__data.json`) e uno `$state` scritto dal suo `.then`
si aggiornava regolarmente.

A morire era il ramo `:then`. `HomeWorkbench` lanciava `ReferenceError: seoGauge is not defined`
mentre si disegnava: Svelte butta via il ramo a metà costruzione, lascia in piedi quello in attesa
e l'errore finisce solo in console. Da fuori è indistinguibile da una promessa che non arriva.

Le due variabili (`seoGauge`/`seoGaugeLabel`, `geoGauge`/`geoGaugeLabel`) erano state dichiarate
insieme ai tre gauge grandi — setup, SEO, GEO — e sono sparite con loro quando quel blocco è stato
tolto in favore della lista «cose da fare». I due `mini-ring` dentro le card della sezione Web,
però, sono rimasti nel markup con il loro CSS.

Il calcolo ora sta in `$lib/home-gauges.ts`, puro e sotto test come `home-todos` accanto: il
riempimento è il punteggio tecnico, l'etichetta è il voto, e **un anello vuoto non è uno zero
misurato** — senza analisi l'etichetta è un trattino, perché «0%» si legge come un risultato.

Perché `npm run check` non l'ha fermato: lo dice, ma in mezzo a **349 errori preesistenti**. Un
controllo che fallisce sempre non ferma niente.

## Le altre tre

- **«Panoramica» via dalla sidebar.** Portava a `/app/<slug>`, cioè dove porta «Home» due righe
  sotto: la stessa destinazione elencata due volte. Resta il guscio dell'header, che serve a
  tenere l'altezza della top bar e il filo allineato.
- **La guida MCP non era chiusa: era schiacciata.** La home è una colonna flex e la guida non
  dichiarava `flex: none`, quindi lo shimmer sotto la comprimeva a 194px di 537 — si vedeva un
  terzo del primo comando e sembrava un box da aprire. Con l'occasione ha preso una gerarchia:
  i tre modi numerati, l'accento dove serve a leggere, il bottone che diventa accento quando ha
  copiato.
- **La pillola delle notifiche non aveva una regola base.** C'erano solo i tre fondi per severità:
  niente raggio, niente padding, niente `font-size` — la cifra usciva a 16px su una striscia
  colorata. Ora è un cerchio che si allunga in pillola a due cifre.

E una riga di contorno: `GrowthReadiness` passava i valori solo alla descrizione e non
all'etichetta, quindi «Storico post ({detail})» arrivava a schermo con il segnaposto in chiaro.
