# La vetrina della chat non è più un array in un file

`FEATURED_CHAT_MODEL_IDS` era una costante in `chat-models.ts`: sedici id scritti a mano. Il
prezzo, il nome e la finestra di contesto arrivavano già vivi da OpenRouter, ma *quali* modelli
comparissero nel menu no — `google/gemini-3.8-flash` è uscito il 2 settembre e sarebbe entrato
solo col deploy successivo, e solo se qualcuno se ne fosse accorto.

Ora la vetrina è una tabella, `chat_model_catalog`, e la riempiono in due.

**L'operatore**, che abilita o disabilita una riga da Supabase senza toccare il codice. Le tre
sorgenti hanno una precedenza dichiarata e non si mescolano: la tabella vince su `LLM_MODELS`,
che vince sul fallback in `chat-model-catalog.ts`. Un menu metà database e metà env sarebbe un
menu che nessuno sa spiegare; il codice resta ultimo perché è l'unico posto che non si cambia
senza un deploy — serve a far partire un'istanza appena installata, non a governare quella che
gira.

**Il cron** `/api/v1/chat/models/sync`, ogni notte alle 4: chiede `/models` al gateway e aggiunge
il modello più recente di ogni vendor che la tabella **già segue**. È la parte che decide quanto
il menu cresce. L'alternativa — prendere tutte le uscite di tutti i vendor — sono 229 modelli
usabili su 423, cioè un menu che nessuno legge; l'altra alternativa — una lista di vendor scritta
nel codice — riportava la decisione editoriale dove l'operatore non la può cambiare. Il vendor lo
dichiarano le righe stesse: segui OpenAI perché hai una riga OpenAI, non segui Sakana perché non
ne hai nessuna.

Cosa il cron **non** fa: non disabilita e non cancella. Un modello ritirato sparisce già dal menu
da solo, perché il listino vivo non lo serve più; togliergli la riga vorrebbe dire cancellare la
scelta di qualcuno per un guasto temporaneo di `/models`.

Le varianti (`:batch`, `:free`, `~vendor/…`) sono escluse: sono lo stesso modello con un altro
contratto, non un modello nuovo, e in vetrina sarebbero un doppione.

`GatewayModel` guadagna un campo, `created`: è l'unico modo per dire quale sia «l'ultimo uscito»
senza mettersi a interpretare i numeri di versione dentro gli id.

## Verificato

Stack locale, brand `demo`, utente `test@anomalia.so`. Il cron ha aggiunto quattro righe al primo
colpo (`google/gemini-3.8-flash`, `anthropic/claude-fable-5.1`, `openai/gpt-5.6-luna-pro`,
`mistralai/mistral-medium-3-5`) e zero al secondo; otto chiamate concorrenti lasciano venti righe,
non ventiquattro. Disabilitata una riga in Supabase, il modello sparisce dal picker; riabilitata,
torna. Un turno vero girato su `google/gemini-3.8-flash` — `ai_calls` registra
`llm/google/gemini-3.8-flash`, `ok=true`.
