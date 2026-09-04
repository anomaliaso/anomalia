# Via il controllo qualità dalle immagini

Decisione di Andrea: **«Niente controllo qualità nelle img.»** Gli erano stati portati i numeri e
una raccomandazione più timida — tenere il candidato scartato, ritentativi da 2 a 1. Ha scelto di
togliere tutto.

## Cosa costava

Misurato prima: **~4 render pagati per ogni immagine consegnata**, 1.058 render per ~250 artefatti
in 30 giorni, **$78,29**. Due sorgenti in `renderWithQC`, entrambe attive:

- `HIGH_STAKES_CANDIDATES = 2` — due render **in parallelo**, il critico ne sceglieva uno e
  l'altro si buttava, già pagato;
- `MAX_QC_RETRIES = 2` — un render **riuscito** bocciato dal critico veniva ridisegnato a prezzo
  pieno, fino a due volte.

`IMAGE_CREDITS` ha sempre dichiarato **un** render. Ora è vero, e il numero è stato corretto:
`credits(0.069 + 0.008)` → `credits(0.069)`, perché lo `0.008` era il critico.

## Cosa cambia per il prodotto — e va detto

Senza critico, **quello che esce è quello che il cliente vede**: un render storto non viene più
intercettato prima della consegna. Il rimedio si è spostato, non è sparito: è `refine_image`, che
l'agente esterno chiama **guardando** il risultato. È coerente con la direzione — giudica l'AI del
cliente, non un nostro critico — ma va scritto qui, perché fra sei mesi qualcuno vedrà mancare il
critico e penserà a una dimenticanza.

## Quello che si è dovuto salvare per strada

Tre cose che sarebbero uscite insieme al critico senza che nulla fallisse:

1. **Il pavimento di esecuzione del design.** Lo iniettava `renderWithQC` (`craftFloor:
   designWallDigestSection()`). Non è un giudizio, è un ingrediente del prompt: sarebbe uscito dal
   percorso immagine in silenzio, e le immagini sarebbero diventate solo un po' peggiori. Ora vive
   in `renderBrandImage`, una funzione sola che i cinque chiamanti usano al posto di ricopiarselo.
2. **`extractVisualPlaybook`**, che stava dentro il blocco cancellato ed è tornata.
3. **Il tipo `QcVerdict` e il campo `qc`**, che NON si potevano togliere — vedi sotto.

## Perché `QcVerdict` resta

`posts.qc` è una **colonna viva** e porta anche altro: `scene_deviation`, che scrive il produttore
e non il critico. La leggono `weekly-recap.ts`, `postQcPayload` in `scheduler.ts` e `radar.ts`,
`mint-standalone-image.ts` (`qc_score`, `qc_pass`), la pagina di dettaglio di un post, e due punti
in `src/lib/agent/tools/create-content-tools.ts` — che è fuori dai file che posso toccare.

Quindi il tipo e il campo restano, e sul percorso immagine il campo è ora **sempre assente**. Che è
la verità: nessuno ha giudicato quel render. Togliere il campo avrebbe rotto in silenzio dei
lettori a valle, che è il modo peggiore di fare una cancellazione.

## Il ritentativo legittimo non è stato toccato

Un render che torna **vuoto** — il modello risponde 200 senza parte immagine — ritenta ancora, ed è
giusto: è un fallimento vero, non un verdetto di qualità. Un test lo tiene fermo, così il prossimo
che legge non li confonde.

## Nessuna riga da togliere in `RATES`

Verificato: `RATES` in `ai-log.ts` è indicizzato per **modello**, non per label, quindi non
esisteva una riga `critiqueImage` da rimuovere. L'unico posto che nominava il critico era il
commento delle misure in `content-cost.ts`, tolto insieme al resto.

## E via anche l'agente immagini

Segnalato come fuori portata, e Andrea ha deciso subito dopo: **«Togli anche l'image agent, se fa
reviews, in quanto non ci serve proprio.»**

Era il secondo meccanismo di controllo qualità sulle stesse immagini, ed era **acceso di default**:
su `generateStandaloneImage` e sulle immagini degli articoli il ramo del critico era già morto in
produzione, perché quei percorsi eseguivano `runImageAgent` — un anello LLM con
`MAX_AGENT_RENDERS = 4`. I ~4 render misurati gli corrispondevano almeno quanto corrispondevano
alla QC.

Il criterio applicato a ogni pezzo, con le parole di Andrea:

- **giudica?** → via. Punteggi, verdetti, soglie, l'anello che ridisegna in base a un parere.
- **serve a disegnare?** → resta. Contesto del brand, riferimenti visivi, il `craftFloor`.

Non c'è una terza categoria, e i pezzi che sembrano starci in mezzo sono quasi sempre ingredienti
travestiti da giudizio — è successo col `craftFloor` un'ora prima.

Qui il taglio è stato pulito perché **il ramo non-agente assemblava già gli stessi ingredienti**:
`logoImage`, `visualStyle`, `visualPlaybook`, `brandLook`, `baseImage`, i riferimenti, il rapporto
d'aspetto. Quello che spariva con l'anello era solo la sua facoltà di **scegliere** — quali
riferimenti pescare dal catalogo e quando rifare. Verificato riga per riga prima di cancellare.

**Il flag è tolto, non spento.** `IMAGE_AGENT_ENABLED` è uscito da `.env.example` insieme al
codice: un interruttore morto lasciato a `false` sembra una manopola, invita a girarla, e dietro non
c'è più niente. **Da verificare in produzione**: se quella variabile è impostata nell'ambiente, ora
non fa nulla e va rimossa di là.

`IMAGE_AGENT_MODEL` non è morto con l'agente perché non era suo: era un alias di `llmDefaultModel`
sotto un nome che adesso mentirebbe, e i tre file del media generator che lo importavano ora
puntano alla cosa vera. (Sono file di `media-generator/`, toccati solo per questo cambio di import
— segnalato come da accordi.)


## Dopo i due tagli: l'immagine è a colpo singolo

Non resta nessun anello che ridisegni. **Quello che esce è quello che il cliente vede**, e il
rimedio è `refine_image`, che l'agente esterno chiama **guardando** il risultato.

È una riduzione di qualità **scelta**, e va scritta come scelta: è coerente con la direzione —
giudica l'AI del cliente, non un nostro anello — ma senza questa riga, fra sei mesi, sembrerà che
qualcuno abbia dimenticato un pezzo.

Il ritentativo legittimo sopravvive a entrambi i tagli: un 200 senza parte immagine è un fallimento
vero, non un verdetto, e il test che tiene la distinzione regge anche dopo la rimozione
dell'agente.
