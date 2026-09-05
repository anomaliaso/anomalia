# generate_captions — testo e basta, con la sequenza che non si può pubblicare

Mancava un tool che scrivesse **solo didascalie**. Chi voleva del testo passava da
`create_post`, che però deposita un post: per avere tre varianti da guardare ne creava tre da
cancellare. E la scorciatoia opposta — scrivere una didascalia sola e riusarla ovunque — è
esattamente ciò che `ensureShortNetworkCuts` fa oggi in fase di pubblicazione: tronca. Un testo
pensato per LinkedIn, amputato a 280 caratteri, non è una didascalia per X.

`generate_captions` (POST `/captions/generate`) scrive per ogni piattaforma la sua, dentro il
limite di quella piattaforma. Una chiamata sola al modello, con lo schema che nomina **solo** le
piattaforme chieste: chiedere X da sola costa una didascalia, non nove con otto buttate. È il
requisito che il test tiene (`caption-writer.test.ts`), e lo tiene guardando lo schema passato al
modello, non le didascalie tornate.

## La sequenza esiste, ma non si pubblica da qui — ed è dichiarato

Prima di generare thread ho verificato se si potessero pubblicare. **No.** Il publisher è Zernio
(`src/lib/server/publishing/zernio.ts`): il payload porta `content: string`, uno, e
`platformSpecificData` è un insieme chiuso — `subreddit`, `url`, `title`, la dichiarazione AI.
Nessun `in_reply_to`, nessun parent id, in tutto lo stack: `PublishInput`
(`publishing/port.ts`) non ha un campo dove appendere le parti 2..N, `posts` non ha una colonna
di ordinamento, e `platform_captions` è `Record<string, string>` — un array lì dentro cade nel
fallback silenzioso di `captionFor`. Composio non è una seconda strada: il proxy lo usano solo
gli ingestori di conoscenza.

Quindi `format: 'thread'` torna le parti con `publishable: false`, e la descrizione del tool dice
perché: pubblicare manda **un** post per piattaforma, la sequenza è da incollare a mano. La
scelta è deliberata e reversibile in un diff piccolo — generare thread taciuti sarebbe stato
peggio che non generarli, perché l'agente crede di avere una cosa che non arriverà mai in linea.

## Il taglio, che è la parte che si rompe in silenzio

`splitForPlatform(testo, limite)` sta in `platform-limits.ts`, pura: niente modello, niente
database, niente rete. Riserva **prima di impacchettare** il marcatore più largo che la sequenza
può produrre (`" 12/12"`), così ogni parte ha lo stesso budget e l'ultima non sfora quando la
numerazione viene appesa — il difetto classico di questa funzione, e il test lo prova con un
testo che sfora di un carattere solo.

I punti di taglio non sono nuovi: riusano `truncateForPlatform`, che guadagna il livello che gli
mancava. L'ordine ora è frase, riga, **proposizione**, e solo come ultima risorsa lo spazio fra
due parole; il pavimento al 50% del budget resta, così una frase che finisce troppo presto non
produce una parte mezza vuota. Ogni candidato è ancorato a uno spazio, per cui un URL, una
menzione o un hashtag non si spezzano mai: la prova non elenca i casi, verifica che ogni parte
cominci e finisca su un confine di parola nel testo originale.

Aggiungere la proposizione cambia il comportamento anche di chi già usava
`truncateForPlatform` (il taglio automatico per X/Threads in pubblicazione, e il manual posting):
le parti diventano leggermente più corte e più sensate. È un miglioramento nella stessa
direzione, non un effetto collaterale.

## Il costo lo dice chi ce lo fattura

`gateAiAction` prima del corpo, come gli altri: una chiave di sola lettura e un brand senza
crediti si fermano prima che qualcosa costi, e il test che conta lo verifica guardando che il
modello **non** sia partito. La chiamata sta dentro `withBrandContext`, così la riga in
`ai_calls` è attribuita al brand e il prezzo è quello che OpenRouter ci fattura.

La risposta **non** porta un campo con il costo, ed è una scelta: nessuna rotta lo fa, e l'unico
modo per metterlo lì sarebbe stato ricalcolarlo — cioè una tariffa scritta a mano accanto a
`ai_calls`, una seconda verità che diverge al primo cambio di listino. La descrizione dice
«Costs credits», come `ads_remix`.

## Scartato

- **Una chiamata per piattaforma.** Nove volte il contesto del brand in prompt per lo stesso
  lavoro, e il modello che non vede le altre otto didascalie mentre scrive la nona — quindi si
  ripete. Una chiamata sola con lo schema ristretto costa meno e differenzia meglio.
- **Un secondo motore di taglio** accanto a `truncateForPlatform`. Due algoritmi che decidono
  dove finisce una frase divergono al primo ritocco.
- **`slug` opzionale.** Il lavoro brand-free non è atterrato: `BRAND_ENDPOINTS` inietta `slug`
  per costruzione (`cli/mcp/tools/brand-content.ts`), `pathFor` lo mette nel percorso, e
  `registry.test.ts` lo dà per scontato. Senza brand non c'è nemmeno la voce del brand, che è
  metà del valore del tool.
