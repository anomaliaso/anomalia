# Lead gist + retention — il contenuto del post non resta nel database

Prima: `brand_news_items.snippet` specchiava fino a 1000 caratteri del testo
verbatim del post di una persona, senza nessuna scadenza — lead, esiti e
telemetria crescevano senza limiti.

Ora:

- Il judge del radar distilla un `gist` (≤140 caratteri: cosa ha chiesto la
  persona) nella STESSA chiamata AI che già giudicava la pertinenza — zero
  chiamate extra. Al momento della stesura del verdetto lo snippet verbatim viene
  messo a null: il testo vero vive solo sulla piattaforma, al permalink.
- Chi approva vede il gist con l'etichetta "riassunto AI" e il permalink a un
  click; il drafting (engage) legge comunque il contenuto live.
- Sweep di retention (`sweepLeadRetention`) dentro il tick del radar, no-throw:
  gist a 14 giorni; righe non convertite (proposed/suggested/skipped/dismissed)
  eliminate a 90 giorni; lead_outcomes a 12 mesi; radar_searches a 90 giorni.

Decisioni:

- 14 giorni per il contenuto e 90 per la riga, non 14 per tutto: gli outcome
  check girano tra 48h e 14 giorni dal done — cancellare la riga a 14 giorni
  ucciderebbe l'ultimo controllo a metà.
- I lead convertiti (done) restano: sono l'àncora degli outcome e la storia del
  rapporto; il loro contenuto (gist) scade comunque a 14 giorni.
- I lead passati senza `gist` mostrano lo snippet storico: nessuna migrazione
  retroattiva dei dati esistenti.
