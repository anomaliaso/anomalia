# La GEO misura sei motori scelti, tutti da un tubo solo

I motori dell'audit di visibilità AI erano quelli che via via si erano potuti
collegare: Gemini sul gateway, DeepSeek con la sua chiave, GPT/Grok/Claude via
kie, Perplexity con `PERPLEXITY_API_KEY`, Bing con `BING_SEARCH_API_KEY`, Exa.
Cinque trasporti e quattro chiavi per rispondere a una domanda sola.

Il roster nuovo sono gli assistenti che la gente interroga davvero — ChatGPT,
Claude, Gemini, Perplexity, Grok — più Exa come base di ricerca generica. Non è
una lista di gusto: sono **esattamente** i provider che su OpenRouter hanno una
ricerca web vera, quindi sono gli unici interrogabili con ricerca reale passando
da un gateway solo.

Gli id dei modelli sono FISSATI nella tabella e non ereditati dal picker della
chat: l'audit deve interrogare un modello noto, o il confronto fra due cicli non
vuol dire niente.

## Misurato prima di cablare, non dopo

«Esiste la ricerca nativa» e «torna delle citazioni» sono due cose diverse. Una
chiamata vera per ognuno, `plugins:[{id:'web',engine:'native'}]`:

| Motore | Id sul gateway | Ricerca | Citazioni | Costo/chiamata |
|---|---|---|---|---|
| Google | `google/gemini-3.7-flash` | plugin nativo | 3 | $0,031 |
| Anthropic | `anthropic/claude-sonnet-5` | plugin nativo | 4 | $0,067 |
| xAI | `x-ai/grok-4.6` | plugin nativo | 4 | $0,131 (43s) |
| Perplexity | `perplexity/sonar` | **da sé, senza plugin** | 20 | $0,0055 |
| OpenAI | `openai/gpt-5.6-luna` | plugin nativo | **0, 0, 2** | $0,031 |

Due fatti che la tabella ha tirato fuori e che nessuna lettura di documentazione
avrebbe dato:

**Perplexity col plugin risponde 404** — «does not support native web search».
Cerca comunque da sé, e senza plugin torna la lista di fonti più ricca del
roster al prezzo più basso. Per questo `WebSearchMode` ha due valori e non è un
booleano, ed è dichiarato in UN posto solo (`ANSWER_ENGINES`) invece che in due
`if`: la differenza è misurata, non estetica, e sparpagliarla è come nasce una
regola che diverge al primo cambiamento.

**OpenAI entra sapendo che due risposte su tre non citano niente.** Su tre prompt
reali: 0, 0, 2 annotazioni, al secondo prezzo più alto. La decisione è di Andrea,
presa con questa misura davanti e con i due preventivi ($4,78 con OpenAI, $4,22
senza). Sta scritto qui perché chi vedrà `domainCitedShare` quasi vuoto per `gpt`
trovi il motivo invece di aprire un'indagine: **non è un guasto, è il motore.**

Il codice tiene separate le due cose, e c'è un test che lo dice
(`geo-citation-engines.test.ts`, «un motore che non cita non è un motore che non
ha risposto»): una sonda FALLITA esce dal conteggio, una risposta SENZA FONTI ci
resta e vale zero solo sul dominio citato. Confonderle trasformerebbe il guasto
di un provider in un voto più basso per il brand.

## Il costo per ciclo è cambiato, in su

Con 3 campioni × ~6 domande = 18 chiamate per motore, per brand, per ciclo:

```
Perplexity $0,10 · Google $0,56 · OpenAI $0,56 · Anthropic $1,21 · xAI $2,36
cinque motori nativi, sole risposte grounded: ~$4,78 / brand / ciclo
```

DeepSeek, che esce, era il più economico di tutti (~$0,0006-0,004 a chiamata).
xAI e Anthropic da soli sono circa il 75% del conto: se un giorno il costo va
tagliato, la leva è lì, e si tira togliendo una riga dalla tabella.

## DeepSeek esce, e con lui tre file

Non per pulizia: via gateway la sonda avrebbe misurato **la ricerca di Exa con la
prosa di DeepSeek**. Il silicio vero si raggiunge (`deepseek/deepseek-v4-flash-0731`
con `provider.only:['deepseek']` risponde in 4,6s a $0,00029 — l'alias non datato
`deepseek-v4-flash` invece non ha nessun endpoint DeepSeek, solo quindici
rivenditori con pesi requantizzati fp8/fp4), ma **la ricerca no**: DeepSeek non è
fra i provider con ricerca nativa su OpenRouter, e senza plugin il gateway ripiega
su Exa a $0,007. Exa è già un motore misurato a parte, quindi due dei sei
avrebbero letto lo stesso backend cambiando solo chi scriveva il paragrafo.
Tenerla diretta era l'altra strada, ed è stata scartata: tutto passa dal gateway.

Spariti con lei, perché senza chiamanti: `citation-probe.ts`, `deepseek.ts`,
`perplexity-search.ts`, `bing-search.ts`. E cinque variabili: `DEEPSEEK_API_KEY`,
`DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `PERPLEXITY_API_KEY`,
`BING_SEARCH_API_KEY`. Il nome DeepSeek resta nel prodotto solo dove è ancora
vero: il **tier di chat** `deepseek-pro`, che è un modello vivo servito dal
gateway e non c'entra niente con la GEO.

## Il punteggio salterà, ed è previsto

La share of voice si calcola ora su un insieme di motori diverso, quindi al
prossimo ciclo un brand può vederla muoversi senza aver fatto niente. Non serve
una migration: `brand_geo_audits` salva sia lo scalare `share_of_voice` sia il
jsonb `citations`, e **ogni riga di `citations` porta il suo `engine`** — il
per-motore storico c'è, e un confronto prima/dopo si ricalcola su qualunque
sottoinsieme. Salta solo lo scalare, che era aggregato sul roster di allora.

I valori `GeoEngine` non sono stati rinominati apposta (`gemini`, `gpt`, `grok`,
`claude`, `perplexity`, `exa` esistevano già): rinominarli avrebbe reso illeggibile
lo storico e rotto la mappa delle icone in `ai-surfaces.ts`. Cambia il trasporto,
non l'identità del motore.

## Lasciato indietro, di proposito

`groundedGemini` in `research.ts` resta esportato e ora non lo chiama nessuno:
la GEO era il suo unico chiamante. Non l'ho tolto perché `research.ts` è in mano
all'agente che sta togliendo `ai: GoogleGenAI` da tutto il repo, e la sua firma
è esattamente una di quelle che sta riscrivendo — cancellarla adesso è un
conflitto garantito. Il commento sopra dice che è senza chiamanti, così chi
atterra per secondo la trova.

Tolto invece `ai` dalle due firme dove stava **in mezzo** (`groundedAnswer`,
`auditOnePrompt`) e dai due chiamanti posizionali: erano le uniche due
mid-signature del repo, e stavano dentro questa riscrittura.
