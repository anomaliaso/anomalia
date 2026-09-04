# Il SEO agent esce dal framework, sesto dei dodici

Sesto giro, stessa ricetta, nessuna variazione: `harnessGenerateText` via, `generateText`
dell'SDK al suo posto, e le tre aggiunte vive su `batch` — traccia di sessione, guardiano,
toppa al system di ogni step — scritte dove il giro succede.

Una particolarità che vale la pena scrivere: **questo agente non solleva mai.** Se il
modello esplode, il `catch` registra il fallimento e la funzione torna `null`, perché una
review SEO che fallisce non deve portarsi dietro chi l'ha chiamata. La riscrittura non lo
tocca, ma adesso si vede che la sessione viene chiusa come `failed` e salvata prima che
quel `catch` faccia il suo lavoro.

Il guardiano resta per la regola che qui morde: gli strumenti `dfs_*` sono ricerche a
pagamento, e due fallimenti di fila sullo stesso strumento lo tolgono dal tavolo. `seo` non
è fra gli agenti che devono ancorarsi al brand prima di cercare — non ha un tavolo di
letture del brand da chiamare — quindi quella regola qui non si applica, ed è giusto così.

## L'arco che spariva

Prima: `seo-agent.ts → harness/index → harness/run → chat/model` e `→ chat/controller`.
Adesso non più da qui.

## Cosa non cambia

Il cliente non osserva niente: stessa valutazione, stesse iniziative, stesse righe. Nessun
changelog pubblico.
