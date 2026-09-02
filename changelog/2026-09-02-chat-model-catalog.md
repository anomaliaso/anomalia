# Il modello della chat lo sceglie il brand, dal catalogo vero

Il picker offriva tre preset e tre "modelli custom" scritti a mano — e mentiva. In
`llmModelForPicker`, con `LLM_MODELS = deepseek/…-flash, openai/gpt-5.6-sol`:

| voce nel menu | modello che girava |
|---|---|
| Auto / Fast | `deepseek/…-flash` |
| **Pro**, **DeepSeek Pro**, **GPT Sol** | `openai/gpt-5.6-sol` — tre etichette, un modello |
| **GPT Terra** | `deepseek/…-flash` — l'etichetta dice OpenAI, girava DeepSeek |

Ora il menu mostra il catalogo del gateway: 16 modelli di punta più tutto ciò che l'operatore ha
messo in `LLM_MODELS`, con nome, finestra di contesto e prezzo **letti vivi** da `/models` di
OpenRouter (v. `openrouter-models.ts`, arrivato con la fatturazione reale). Nessun elenco scritto
a mano: un modello ritirato sparisce da solo invece di fallire al primo turno, e un prezzo che
cambia non resta qui dentro a mentire.

Il filtro non è editoriale: **tools + visione**. I nostri agenti chiamano strumenti e leggono
immagini; un modello che non sa farlo non è una scelta, è un turno che muore a metà. Dei 421
modelli di OpenRouter ne passano 227.

## Cinque punti da attraversare, e ognuno era rotto

La scelta è un id (`anthropic/claude-opus-5`), non più una delle sei parole nostre. Ognuno di
questi cinque punti la buttava via, e ognuno è stato trovato **facendo girare un turno vero**:

1. `isChatTier` conosceva sei valori: un id non era un tier. Ora la FORMA la riconosce il client,
   l'ESISTENZA la verifica il server contro il listino.
2. `REASONING_LEVELS[tier]` e `DEFAULT_REASONING[tier]` erano mappe con sei chiavi: su un id nuovo
   tornavano `undefined`, e il menu si schiantava su `.length`. Ora passano da `familyForTier`, che
   per un id del gateway dà la scala comune a tre gradini.
3. `AgentModelPolicy` sul thread era `{family, thinking}`: non sa dire "claude-opus-5". Ha un campo
   `model` in più; le righe salvate prima non ce l'hanno e continuano a valere.
4. `resolveHarnessModelRef` ignorava il tier quando non era `pro`/`fast` e cadeva sul primo id di
   `LLM_MODELS`. **Il default del brand era qwen e il turno girava su deepseek.**
5. `ensureKieAgentDir` dichiarava all'harness solo i due id di `LLM_MODELS`. Un id fuori da quella
   lista l'harness non lo conosce: ripiegava sul gateway Vercel e tornava `403 Free tier users do
   not have access` su `zai/glm-5.1` — un modello che nessuno aveva scelto.

E il default di brand non arrivava mai al composer della home: l'effetto di idratazione usciva
subito quando non c'era ancora un thread (`id === hydratedThread`, entrambi `null`), quindi ogni
chat nuova partiva su Auto. Difetto che c'era già con "Pro", solo che nessuno lo vedeva.

## Il vincolo sul database

`brands_chat_default_tier_check` ammetteva solo le sei parole: salvare un id era un errore SQL
mostrato in faccia all'utente. La migration lo allarga alla FORMA di un id — che esista lo dice il
listino vivo, non un CHECK che nessuno aggiornerà mai.

## Quello che NON funziona ancora, e di chi è la colpa

Il turno su `qwen/qwen3.8-flash` è arrivato in fondo, ma l'harness non ha riportato l'uso di token
(`? in / ? out`) e quella riga di `ai_calls` è rimasta senza costo. Sul modello di default i token
c'erano.

**Non è OpenRouter.** Chiamando i due modelli in streaming senza alcun flag, l'ultimo chunk porta
`usage` con dentro `cost` per entrambi:

```
qwen/qwen3.8-flash        → "usage":{"prompt_tokens":62,"completion_tokens":3,"cost":0.00001071,…}
deepseek/…-flash-vision   → "usage":{"prompt_tokens":84,"completion_tokens":3,"cost":0.00002046,…}
```

Il dato **c'è già nella risposta**: è l'harness a non estrarlo per quel turno. Il che rende la
strada strutturale più semplice di come sembrava — non serve convincere nessuno a mandarci il
conto, serve solo passare da un posto dove possiamo leggerlo: puntare il `baseUrl` dell'harness a
un endpoint nostro che inoltra a OpenRouter e registra `usage.cost`, come fa già `llmClient` per
tutto il resto. Non è in questa PR.
