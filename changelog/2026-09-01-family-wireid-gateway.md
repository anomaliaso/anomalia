# Una famiglia scelta nel picker non uccide più il turno

Il catalogo (`src/lib/models/catalog.ts`) tiene per ogni famiglia il suo nome **nativo**:
`luna` → `gpt-5-6-luna`, `grok` → `grok-4-6`. Sono i nomi di kie, di quando ogni provider
parlava il suo vocabolario. Da quando la chat passa tutta dal centralino
(`LLM_BASE_URL`, OpenRouter), il vocabolario è un altro: `openai/gpt-5-6-luna`, `x-ai/grok-4-6`.

`resolveHarnessModelRef` prendeva il `wireId` del catalogo e lo passava al gateway così com'è.
Il gateway non conosce `gpt-5-6-luna`, e il turno moriva prima di cominciare: lo stream chiudeva
senza `finish_reason`, il reaper trovava un turno senza output, l'utente vedeva un errore rosso.
Il test che stava a guardia (`adapters.test.ts`) fotografava proprio il difetto: pretendeva
`llm/grok-4-6`, cioè l'id che il gateway rifiuta.

Non era teoria in attesa di un caso raro: `policyForChoice` scrive la famiglia su
`chat_threads.model` **al primo click sul picker** — chiunque scegliesse Fast si comprava un
thread che non risponde più. Il 2026-09-01 nessuna riga in `chat_threads.model` né in
`custom_agents.model` era ancora popolata: la mina era armata e non ancora pestata.

Ora la famiglia vale solo se la lista dichiarata (`LLM_MODELS`) serve davvero quel modello —
per id esatto o per ultimo segmento, così `x-ai/grok-4-6` copre la famiglia `grok`. Se non lo
serve, `servableWireId` torna `null` e decide il tier, che passa da `llmModelForPicker` ed è
sempre un id che il gateway ha.

**Scartato:** riscrivere i `wireId` del catalogo con gli id del centralino. Il catalogo non
descrive solo la chat — descrive anche i gradini di thinking e le capacità di ogni famiglia, e
il nome nativo è ciò che serve a `toNativeThinking`. Fare del catalogo un elenco di id
OpenRouter avrebbe legato la tassonomia dei modelli al gateway di oggi: la traduzione sta in un
posto solo, dove il gateway viene interrogato.
