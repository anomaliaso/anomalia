# Un agente esterno può portare in Anomalia un media prodotto altrove

Quarta e ultima slice della Fase 1 del piano [external agent](../docs/external-agent-plan.md).
`import_media_url` copia un'immagine o un video da un URL pubblico dentro la libreria del brand,
e restituisce l'id che `create_post` accetta in `media_ids`.

## Perché non basta l'URL

L'alternativa gratis era lasciare che il post puntasse all'URL remoto. È la stessa trappola già
pagata con il logo del brand (`storeBrandLogoFromUrl`): un URL di CDN social, un signed URL, un
allegato di chat muoiono in giorni. Il post resta, l'immagine no, e non fallisce niente — quindi
non se ne accorge nessuno finché non è uscito. Il file viene copiato, e la riga conserva in
`source_ref` l'URL da cui è arrivato.

## La superficie vera di questa slice è il rifiuto

L'URL lo sceglie un agente esterno, quindi è input ostile e la domanda non è «cosa accettiamo»
ma «cosa impedisce a questa chiamata di diventare un request forger puntato sui nostri servizi
interni». Le regole:

- **https, su ogni hop.** `assertPublicUrl` da sola accetta anche http; un `302` da https a http
  consegna il file a chiunque stia sul percorso, quindi lo schema si ricontrolla dentro il ciclo
  dei redirect e non solo sull'URL che ci hanno dato.
- **L'indirizzo, non il nome.** Un host pubblico può risolvere su `127.0.0.1`. Il controllo è su
  ciò che il resolver restituisce (`isPrivateAddress`), non sulla stringa.
- **Ogni hop, non il primo.** `169.254.169.254` non si raggiunge digitandolo: si raggiunge
  facendosi rispondere `302 Location:` da un URL che sembra innocuo.
- **Il content-length è dell'attaccante.** Serve solo a rifiutare presto. Il tetto vero lo fa il
  lettore mentre il corpo arriva, quindi un `content-length: 120` davanti a 13MB viene fermato
  comunque, e un content-length assente pure.
- **Un tipo che non sappiamo pubblicare non entra.** Sette MIME in una tabella; `image/svg+xml`
  non c'è, ed è deliberato: un SVG è codice eseguibile travestito da immagine.

Niente di tutto questo è stato scritto da zero: `tool-guard.ts` aveva già la guardia giusta —
resolve-then-check, redirect manuali, tetto di byte — per i tool pubblici. Le mancava solo un
corpo binario.

## Passare il tetto: troncare o rifiutare

`safeFetchUrl` **tronca** quando supera il budget, ed è corretto per una pagina: un `<head>`
tagliato si analizza lo stesso. Per un file è il difetto peggiore possibile — un JPEG tagliato è
un asset corrotto salvato come se fosse intero, e a scoprirlo è il cliente. Da qui
`safeFetchBytes`, che sullo stesso cammino **rifiuta** invece di troncare.

Il ciclo dei redirect è stato estratto prima, in un commit separato che non cambia niente: due
copie di una guardia SSRF sono due guardie che divergono, e la seconda diverge in silenzio.

## Il catalogo AI resta fuori

L'upload dal browser, dopo l'insert, chiama `catalogBrandMedia` (Gemini in visione). Qui no, di
proposito: farlo renderebbe l'import un'operazione che spende crediti, e allora servirebbe
`gateAiAction`. La riga nasce `catalog_status: 'pending'` — `list_media` la mostra comunque e
`create_post` la accetta comunque, perché nessuno dei due filtra sul catalogo. Chi vuole la
schedatura la chiede dalla libreria.

## `source: 'agent'`, e il vincolo che potrebbe non esserci

`brand_media.source` ha un CHECK. `'agent'` ci è entrato con la `0220`, che è
**da applicare a mano** come tutte le migration di questo repo. Non ho introdotto un valore nuovo
proprio per non aggiungere una dipendenza da una migration in più: `'agent'` è già scritto da
`agent/bridge/attach.ts`, quindi o funzionano entrambi o è già rotto quello. Se la 0220 non fosse
applicata, l'insert prende 23514 e l'endpoint risponde `store_failed` — un errore, non un
successo finto.

## Fuori da questo giro

Il payload base64 come trasporto MCP: il piano lo esclude esplicitamente («large base64 payloads
are not the primary MCP transport»), e il file dal disco dell'operatore continua a passare dal
web.

`storeBrandLogoFromUrl` (`studio-actions.ts`) scarica un URL scelto da un modello usando
`isUrlSafe` — che confronta pattern di hostname, non risolve il DNS — segue i redirect in
automatico senza ricontrollare niente, e bufferizza tutto il corpo prima di guardarne la
dimensione. È lo stesso identico mestiere di questo endpoint fatto con la guardia debole, e non
l'ho toccato qui: è una PR sua, che si legga da sola.
