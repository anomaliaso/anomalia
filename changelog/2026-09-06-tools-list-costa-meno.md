# `tools/list` costa 109.837 caratteri invece di 129.212

La superficie MCP si paga a ogni sessione e nessuno l'aveva misurata. Sul transport vero —
`initialize`, poi `tools/list`, `JSON.stringify(result).length` — erano **129.212 caratteri, circa
32.300 token** prima che l'agente chiedesse qualunque cosa. Ora sono **109.837, circa 27.500**:
**−19.375, −15,0%**, con 119 tool identici e nessuna capacità tolta.

Il confronto con #383, che ha ritirato sette tool, è la lezione vera: **quei sette pesavano 2.747
caratteri, 686 token, il 2%.** Le descrizioni ne tolgono dieci volte tanto. Il problema non era
quanti tool ci sono — era quanto scrive ciascuno.

Due conteggi che sembravano in disaccordo di dieci caratteri erano lo stesso conteggio: uno misura
`result`, l'altro il solo array. `{"tools":` più `}` fa esattamente 10. Qui si misura `result`.

Si misura il transport e non i sorgenti. Il conto sui sorgenti è già stato sbagliato due volte in
un giorno, e il motivo è strutturale: lo schema JSON che il protocollo spedisce non somiglia allo
zod da cui nasce — un `z.enum` di 150 nomi è una riga nel sorgente e tremila caratteri sul filo.
`cli/mcp/tool-surface-cost.test.ts` fa quella misura e tiene un tetto, perché la superficie
ricresce da sola: ogni tool nuovo porta la sua descrizione e nessuno somma.

## Due chiavi che nessun client legge — 10.948 caratteri, l'8,5%

L'SDK aggiunge a ogni tool `$schema: "http://json-schema.org/draft-07/schema#"` e
`execution: { taskSupport: "forbidden" }`. Il primo dichiara il dialetto di uno schema che il
protocollo dichiara già JSON Schema; il secondo è il valore che l'**assenza** del campo significa
(`taskSupport` è opzionale, e nessun tool qui accetta un task). Moltiplicati per 119 fanno l'8,5%
della lista, e togliere una chiave che nessuno legge non costa niente a nessuno.

Si decorano una volta sola: `trimListedTools` avvolge l'unico punto in cui l'SDK installa il suo
handler di `tools/list`, prima che i tool lo creino. Non è una riscrittura della conversione zod →
JSON Schema — quella resta dell'SDK, con le sue unioni e le sue pipe.

## Le descrizioni — 8.427 caratteri, e nessun tool è cresciuto

La regola del taglio è una sola: **una frase resta se toglie un errore osservato, esce se sta lì
per completezza.** Prima di togliere qualcosa l'ho cercata con `git log -S`, perché parecchie sono
state scritte in risposta a un difetto vero e il changelog lo dice.

**Uscite, e perché:**

- **`id accepts a short prefix.`**, quindici volte. È una regola del server, non di un tool, e sta
  già nelle `instructions` del handshake che il client mostra una volta per sessione:
  *«Post and article ids accept short unambiguous prefixes from any list tool.»* Scritta in due
  posti, quindici volte in uno solo. Ora `findability.test.ts` pretende che la regola stia nel
  handshake, che è dove si legge per prima.
- **`.describe('Brand URL slug')` sul parametro `slug`**, su ogni tool che prende un brand. Ripete il nome del campo. La
  variante *opzionale* resta intera: quella nasce da un difetto (un opzionale che non si dichiara
  viene riempito comunque, e con un brand a caso).
- **Tetti ripetuti tre volte.** `search_knowledge` diceva «`limit` is 6 by default and 20 at most»
  nella descrizione, nella `.describe()` del campo e nel `max()` dello schema — tre copie nello
  stesso messaggio. Resta quella sul campo che il tetto lo impone davvero.
- **Prosa che spiega il prodotto invece del tool**: il modello che *«cambia no brand setting»*
  spiegato in quattro righe cinque volte, il `brand_style` in nove righe due volte, l'esempio
  Roma/New York sul fuso orario. Il fatto che ci sta sotto — i post già programmati non si spostano
  — resta.
- **Un aforisma** (*«you do not win by arriving last»*) e una giustificazione preventiva
  (*«Reading it costs a few thousand tokens»*). Il 409 con i due valori resta: quello è il fatto.

**La dichiarazione del costo non è uscita, si è accorciata.** «Reads only — no model, no credits.»
e le sue otto varianti diventano **`Free.`** — 5 caratteri invece di 34, sessantasei volte. La
regola 3 di [`2026-09-05-tool-descriptions-say-the-problem.md`](2026-09-05-tool-descriptions-say-the-problem.md)
è esplicita e nasce da un difetto vero: un agente ha chiamato «spreco» una generazione richiesta
dall'utente, e *«un agente prudente evita ciò di cui non conosce il prezzo»*. Cancellare la frase
avrebbe riaperto quel difetto per risparmiare 1.900 caratteri; accorciarla ne risparmia 1.600 e non
riapre niente.

**Restate perché rispondono a un difetto**, verificate una per una in `git log`:

| frase | difetto |
|---|---|
| `media_not_found` (400) vs `media_unavailable` (502), su `create_post` | un modello esterno ha bruciato sei tentativi correggendo un id contro uno Storage rotto — il 400 gli diceva che l'input era sbagliato |
| `a ninth is refused, not dropped` | il troncamento silenzioso è solo della UI; il contratto rifiuta la richiesta intera |
| `Do NOT call list_brands to decide where to draw` | agenti che chiamavano `list_brands` e sceglievano un brand a caso: crediti di un'organizzazione vera, libreria di un cliente vero |
| `WITHOUT slug this is a one-off drawing`, `id comes back null` | *«puoi generare la img di un gatto?»* → *«non ho uno strumento di generazione immagini»* |
| `Do NOT reach for generate_image to alter something` | un'immagine da rendere rossa ridisegnata da zero |
| `continuity_tokens` su `generate_carousel` | una slide modificata senza i gettoni esce dalla serie, e nessun errore lo dice |
| `there is no field for arbitrary JavaScript`, `ONLY on a verified custom domain` | `/blog/<slug>` è l'origine di anomalia.so, accanto alle sessioni `/app`, e non esiste CSP |
| `consent` — `Never infer it` | l'API scriveva `consent = true` senza che nessuno lo attestasse |
| `it works precisely when credits are gone` (link Stripe) | un agente senza crediti salta il tool che serve proprio a comprarli |
| `not_in_library` su `check_media_job` | un clip pagato ed esistente che, chiamato `failed`, verrebbe ricomprato |
| `IT IS ALSO THE READ FOR QUESTIONS THAT HAVE NO TOOL OF THEIR OWN` / `products` (su `query`) | `list_products` è stato tolto: senza queste parole la capacità è irraggiungibile |
| `Turning one OFF spends nothing` | l'asimmetria fra accendere (spende per sempre) e spegnere è l'unica cosa che un agente legge prima di chiamare |

## Tre test che citavano una formulazione ora chiedono il concetto

`check_content` e `get_creation_kit` pretendevano le parole `spends no credits` e
`no model, no credits`; `get_post` pretendeva `id accepts a short prefix`. Un test che cita la
prosa alla lettera rende ogni riscrittura una modifica in due posti — è la stessa ragione per cui
le copie testuali delle descrizioni erano già state tolte da `read-tools.test.ts`. Ora chiedono
`/free/i`, e la regola del prefisso è verificata dove adesso vive: il handshake.

## Non toccati, e perché

`ads.ts` e `search.ts`, `set_appearance`, `edit_post`: sono in PR aperte (#383, #385). Ci passo
sopra quando mergiano — `set_appearance` da solo pesa 1.835 caratteri e ha almeno una frase di
default (*«renders as Inter with nothing said»*) che è documentazione, non un difetto.

## Quello che resta, con il suo numero

Lo **schema** pesa più delle descrizioni, e quasi tutto è forma dell'API, non prosa:
`save_week_seeds`, `save_plan`, `set_blog_settings` sono i tre più grossi.

L'oggetto singolo più pesante che resta è **l'enum delle tabelle di `query`: ~2.955 caratteri**,
150 nomi spediti a ogni sessione — mentre la descrizione dello stesso tool dice già *«Omit `table`
to list every table you can name»*. **Resta**, e la ragione è quella che ha guidato tutto il resto:
la contropartita è un modello che indovina un nome di tabella, cioè la classe di fallimento
silenzioso che questo lavoro esiste per togliere, e un giro in più costa meno di una risposta
sbagliata. Se quel peso va recuperato, la domanda è se servono davvero tutte e 150 le tabelle in
quell'elenco — non se serve l'elenco.
