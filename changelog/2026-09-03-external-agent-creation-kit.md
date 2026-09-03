# Un agente esterno può leggere il brief prima di scrivere

Ultima slice della Fase 1 del piano [external agent](../docs/external-agent-plan.md).
`get_creation_kit` prende un obiettivo, delle piattaforme e un formato, e restituisce il brief
minimo per quel lavoro — più un identificatore stabile per ogni template, rubrica, esempio e
versione di regola che ha selezionato.

## La funzione è la selezione, non il recupero

Il piano è netto due volte:

> «Dynamic tools select the smallest relevant subset; they never dump the full library into every
> model turn.»

> Rischio: «Guidance overwhelms or anchors the external model» → Controllo: «Select one focused
> creation kit instead of dumping the library.»

Quindi un kit che restituisce tutto è un fallimento anche se ogni test passa. Il budget è in
codice (`CREATION_KIT_MAX_BYTES = 8192`), è misurato in ogni risposta (`size_bytes`), e un test
lo tiene: se il kit cresce oltre il tetto, il test fallisce.

Perché 8192 byte: sono circa duemila token, una pagina di indicazioni — la dimensione di una buona
sezione di system prompt. Grande abbastanza da portare un template, una voce e qualche esempio;
piccola abbastanza che leggerla prima di ogni post non costi niente. Misurato: un brand appena
creato produce **3.826 byte**, un brand reale con rubriche, storico e campagna ne produce **5.378**.
Nessuno dei due taglia niente.

## Il tetto tiene per costruzione, non per amputazione

Ogni campo ha un massimo in caratteri (`CAPS`, una tabella sola). È quello che fa stare il kit nel
budget: tagliare intere sezioni è la rete, non il meccanismo. La rete c'è comunque, ed è ordinata
sulla **precedenza dichiarata nel piano** — vincoli di piattaforma, fatti del brand, voce, rubrica,
template, calendario, settimana, edit dell'operatore, evidenza. Si cede dal fondo: i vincitori
passati sono *evidence, not instructions*, e cadono per primi; `constraints` non cade mai. Quello
che cade è elencato in `trimmed`, così chi legge sa cosa non ha ricevuto.

Il primo test scritto su questo — un brand che satura *ogni* campo insieme — ha trovato un difetto
vero: il nome di una persona era l'unico campo senza tetto, e il kit arrivava a scartare i fatti
del brand pur di stare nel budget, tenendo un template statico. Il tetto mancante è la correzione;
il test è la guardia.

## Cosa ho composto, e cosa non ho scritto

Il kit non contiene **una sola regola sua**. Ogni sezione è una selezione sopra un modulo che la
regola ce l'ha già:

| Sezione | Da dove | Selezione |
|---|---|---|
| `constraints` | `platform-limits.ts` | solo le piattaforme richieste |
| `brand` | `brand_kit`, `products`, `people` | prodotti ordinati per sovrapposizione col goal (max 5); solo persone che passano `likenessConsented` |
| `voice` | `houseVoiceFor` (`caption-quality.ts`) | personalità approvata quando c'è |
| `rubric` | `loadApprovedRubrics` (`rubrics.ts`) | solo quelle del formato richiesto |
| `template` | `agent-docs/skills/social/references/post-templates.md` | un gruppo da formato+piattaforma, un blocco dal goal |
| `template.playbook` | `platformPlaybook` (`seed-model.ts`) | solo le piattaforme richieste |
| `calendar` | `posts` + `SLOT_OCCUPYING_STATUSES` | solo i minuti occupati da adesso in avanti |
| `week` | `editorial_plans` attivo + `currentWeekIndex` | solo la settimana corrente |
| `operator_edits` | `ownerCaptionEditPairs` (`caption-quality.ts`) | le ultime 3 riscritture vere |
| `history` | `loadOwnPostHistory` + `analyzePostHistory` | solo `source='zernio'`, vincitori sulle piattaforme richieste |

`post-templates.md` è la stessa reference che le skill di brand consegnano agli agenti interni
(`brand-skills.ts`). Il kit legge quel file e ne passa **un solo blocco**: due consigli diversi
sullo stesso argomento non possono nascere, perché la sorgente è una.

## Due regole che stavano dentro l'unica funzione che le usava

`listCalendarConflicts` teneva l'insieme degli stati che occupano un minuto in un `new Set([...])`
locale; `analyzePostHistory` teneva la formula del peso d'ingaggio in una `function weight` privata.
Un secondo lettore avrebbe dovuto copiarle, e due copie di «quale post ha vinto» classificano post
diversi. Sono diventate `SLOT_OCCUPYING_STATUSES` e `engagementWeight`, esportate dai moduli che le
possedevano già. Il commit che sposta è separato da quello che aggiunge, e i 29 test di quei due
moduli passano identici.

## Cosa ho lasciato fuori, e perché

Il piano elenca più di quello che esiste davvero per brand. Un campo sempre vuoto è peggio di un
campo assente — insegna a ignorare il kit — quindi:

- **Weak patterns.** Non esistono. `visualInsightsBlock` calcola i bucket perdenti e poi li
  **scarta** (`delta <= 0`); `post_verdicts.verdict = 'discarded'` è il dato giusto e non ha un
  solo lettore in tutto il repo. L'unico segnale negativo per brand che esiste è
  `content_prefs.avoid`, ed è dentro `constraints`. Inventare dei pattern deboli avrebbe prodotto
  un mio giudizio travestito da regola di Anomalia.
- **Approved assets.** `list_media` è già un tool, con ricerca e URL firmati. Ripeterli nel kit
  avrebbe raddoppiato la libreria proprio nello strumento che esiste per non dumparla. Il kit lo
  dice nella sua descrizione.
- **Ricerca semantica sulla knowledge base.** `loadCaptionKnowledge` avrebbe usato il goal molto
  meglio della sovrapposizione lessicale, ma `searchKnowledge` fa un round-trip di embedding quando
  il recall FTS è magro: una chiamata a modello dentro una lettura che promette di non farne
  nessuna. Fuori.
- **Campagne.** Non c'è nessuna tabella: `campaign_id`/`campaign_name`/`campaign_step` sono tre
  colonne su `posts`, senza stato e senza «corrente». Il contesto di campagna arriva quindi
  attaccato agli slot occupati — zero query in più, zero euristica — e il contesto strategico vero
  è la settimana del piano editoriale attivo, che un indice unico parziale garantisce unica.
- **`post_verdicts` come corpus di edit.** Ha le colonne giuste e nessun lettore. Scriverlo qui
  sarebbe stato codice nuovo su un dato mai letto, per lo stesso segnale che
  `content_prefs.captionEditPairs` già dà. Rimane lavoro di dopo.

## Perché una GET

Il kit è una lettura e l'input ci sta in una query string. `resolveCaller` nega le API key di sola
lettura su qualunque metodo diverso da GET: con la GET, **una chiave read-only può leggere il
brief prima di scrivere**, che è esattamente il permesso giusto. `platforms` viaggia come stringa
separata da virgole perché è così che `callEndpoint` serializza una GET; normalizzazione e
deduplica stanno nella route, e una lista di sole virgole dà `no_platforms` invece di passare per
vuota.

## Il goal, e cosa fa davvero

Il goal ordina i template dentro il gruppo scelto e i prodotti dentro il catalogo, per
**sovrapposizione di parole**. Non è ricerca semantica e il codice lo dice nel nome
(`goalOverlap`): è deterministica, non costa niente e non chiama nessun modello — che è la
promessa dell'endpoint. Un test lo verifica su due goal diversi che scelgono due template diversi.

## Il valore è dichiarato, non dimostrato

Il piano dice che il kit «ships only if it improves the facts without making completion materially
slower or more expensive». Quel confronto — stesso modello, stesso task, con e senza kit, su più
brand reali e abbastanza ripetizioni — **non è stato fatto**. Quello che questa PR porta è la
dimensione misurata e il costo misurato (zero chiamate a modello, zero crediti, provato da una spia
nei test). Che aiuti la qualità resta da verificare.

## La regola del likeness, non una mia copia

La prima versione del kit selezionava le persone con `.eq('consent', true)` nella query. È
sbagliata due volte: esclude le persona AI, che non ritraggono nessuno e non vanno mai gated, e
soprattutto **riscrive una regola che ha già una casa**. `likenessConsented` in
`design-visual-refs.ts` lo dice nel proprio docblock: «Re-stating the condition anywhere else is
how the rule diverges». Adesso il kit chiama quella funzione. Il test che lo tiene fallisce con la
condizione riscritta e passa con la regola vera.
