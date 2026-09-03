# Il turno chiama il modello che abbiamo scelto, non quello che il gateway offre

Un turno è morto con un 403 del gateway Vercel — «Free tier users do not have access to this
model» — su `zai/glm-5.1`, mentre la riga di log dello stesso turno diceva `gemini-3.8-flash`.
Due modelli diversi nello stesso turno: quello che abbiamo scelto e quello che è stato chiamato.

## Come ci si arrivava

`harness-pi` decide il provider così:

```js
const useGateway = Boolean(getAiGatewayAuthFromEnv({ env }).apiKey);
const gatewayMatch = useGateway ? models.find(m => m.provider === 'vercel-ai-gateway' && matches(m)) : undefined;
if (gatewayMatch) return gatewayMatch;
```

e considera il gateway configurato appena vede `AI_GATEWAY_API_KEY` **o** `VERCEL_OIDC_TOKEN`.
`hydrateHarnessEnv` copiava la prima da `.env` dentro `process.env`; la seconda su Vercel c'è
sempre. Con quel ramo acceso, `resolvePiEnv` restituisce SOLO le credenziali del gateway e scarta
l'ambiente, e la risoluzione del modello preferisce il gateway al nostro provider.

Da solo non bastava a sbagliare modello: serviva anche che l'id chiesto non fosse fra quelli
dichiarati. `ensureKieAgentDir` scriveva `models.json` con `LLM_MODELS` ∪ listino OpenRouter,
mentre il modello del turno esce da `resolveHarnessModelRef` → `defaultChatModelId()`, cioè dalla
riga `is_default` di `chat_model_catalog`: una tabella del database che nessuno confrontava con
quella lista. Il listino, per giunta, è freddo al primo turno del processo — quindi subito dopo
ogni riavvio anche un id legittimo poteva non essere dichiarato.

Modello sconosciuto + gateway acceso = pi sceglie da sé, sul provider sbagliato. È il difetto che
il commento sopra `harnessDeclaredModels` descriveva già («un id che non sta qui dentro l'harness
non lo conosce, il turno ripiega su un altro gateway e finisce in un 403 su un modello che nessuno
ha scelto»): la lista, però, non conteneva il modello che stavamo per chiedere.

## Cosa cambia

**Le credenziali si dichiarano, non si lasciano trovare.** `harnessCredentials()` compone la mappa
dei provider che usiamo davvero e la passa a pi come `auth.customEnv`. Con un `customEnv`
configurato `resolvePiEnv` non guarda più l'ambiente: né la chiave del gateway né il token OIDC di
Vercel possono rientrare dalla finestra. `AI_GATEWAY_API_KEY` esce anche da `hydrateHarnessEnv`,
dove non serviva a nessun altro.

**Il modello del turno è sempre fra quelli dichiarati.** `ensureKieAgentDir` riceve l'id del turno
e lo aggiunge alla lista, spogliato dello scope `llm/` che vive nel ref ma non dentro il provider.

Quando il provider `llm` non è configurato affatto (nessuna `LLM_API_KEY`) il gateway resta
l'unica strada e le credenziali non si dichiarano: spegnerlo lì vorrebbe dire spegnere tutto.

Il nome del provider diventa una costante sola: lo scope del ref, la chiave in `models.json` e
l'id nudo che pi cerca lì dentro devono restare d'accordo, e prima erano tre stringhe scollegate.

## Cosa NON è

Non è il rate limit di OpenRouter visto lo stesso giorno (`google/gemini-3.8-flash is temporarily
rate-limited upstream`): quello è il pool condiviso di OpenRouter verso Google, si cura con una
chiave propria (BYOK), e non c'entra con quale broker riceve la chiamata. E non esiste ancora
nessun ripiego sul 429 — un turno che lo incontra muore.
