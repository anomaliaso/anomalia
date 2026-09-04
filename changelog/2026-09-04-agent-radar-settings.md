# Il Radar si punta da fuori, e il piano lo dice prima del 403

Quarto giro sulle impostazioni headless. Quattro tool: `get_radar`, `set_radar_platform`,
`add_radar_source`, `remove_radar_source`. `tools/list`: **99 → 103**, additivo, `changed: []`.

## Perché la lettura non è di cortesia

Due cose, qui, un agente non le può indovinare, e sono esattamente quelle che decidono se una
scrittura riesce:

- **il piano**. `threads`, `x`, `linkedin` (piattaforme) e `threads_query`, `x_community`,
  `linkedin_query` (tipi di fonte) sono del piano Pro. Sotto, `get_radar` li segna `plan_locked` e
  i write rispondono `plan_required`;
- **il tetto**. `radarSourceLimit(plan)` limita quante fonti un brand può avere. `get_radar` porta
  `source_limit` e `sources_used`; oltre, l'aggiunta risponde `source_limit` nominando il tetto.

Un enum più corto per i tipi Pro sarebbe stato sbagliato: il piano è un fatto del runtime, non
della forma della richiesta, e togliere quei nomi dallo schema significherebbe che un agente su
Starter non può nemmeno sapere che esistono. Stanno nel vocabolario, e il rifiuto è dichiarato.

## Niente id: la coppia che aggiunge è la coppia che toglie

`(brand_id, kind, value)` è già la chiave unica sul database. Quindi `remove_radar_source` prende
`(kind, value)` — l'unica cosa che un agente ha in mano subito dopo aver aggiunto una fonte — e
non c'è nessun id da ricordare né un giro di rete per scoprirlo.

È un `POST` a `/sources/remove` e non un `DELETE`: il client generato dal registry non manda un
corpo su `DELETE`, e inventare una risorsa con `:id` avrebbe voluto dire una riga in
`BRAND_RESOURCES`, un risolutore di prefissi e un metodo nuovo nel client — machinery per un id
che il dominio non usa.

## Il difetto che questa scelta ha reso visibile

Un subreddit si scrive `r/coffee` e si **conserva** `coffee`: l'azione del form lo normalizzava
inline, in aggiunta. Con una rimozione per coppia, normalizzare solo da un lato sarebbe stato un
guasto silenzioso preciso: `remove('r/coffee')` non trova `coffee`, e la risposta dice «tolta»
senza aver tolto niente.

`radarSourceValue(kind, value)` sta in `$lib/server/radar.ts` e la chiamano tutti e tre i punti
che scrivono — aggiunta, rimozione, form del browser. Un test dice esattamente questo: le due
strade convergono sullo stesso valore.

Nella stessa pagina c'era anche l'elenco dei tipi validi ricopiato a mano — la **quarta** copia,
dopo `RADAR_BASE_KINDS`, `RADAR_PRO_LEAD_KINDS` e il tipo `RadarSourceKind`. Sostituito con
l'unione dei due, che è ciò che era già.

## Una fonte che c'è già non è un errore

`added: false`, niente cambia, 200. Deliberatamente non un 409: un agente che riprova dopo un
timeout non deve vedere un fallimento per una cosa che è nello stato giusto.

## `destructive` per caso, non per famiglia

`remove_radar_source` è l'unico dei quattro con `destructive: true`: cancella una riga che non
torna. Aggiungere una fonte, accendere e spegnere una piattaforma non distruggono niente —
spegnere restringe cosa il Radar trova e non tocca né le fonti né i risultati già trovati.

## Cosa è stato visto rosso

- il contratto, prima di essere nel registry;
- il guardiano del vocabolario, con `mastodon` aggiunto alle piattaforme del contratto;
- le rotte: tolti la normalizzazione, il gate del piano, il controllo della URL RSS, il tetto e il
  404 della rimozione, **cadono 9 test su 16** e 7 restano verdi.
