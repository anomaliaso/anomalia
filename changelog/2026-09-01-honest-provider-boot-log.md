# La riga di boot dice chi serve il testo, o tace

Due `console.log` al livello del modulo — `xiaomi.ts` e `gtm.ts` — annunciavano a ogni avvio:

```
[AI] provider: gemini (gemini-3.7-flash)
[GTM] provider: gemini (gemini-3.7-flash)
```

Nessuna delle due era vera. `AI_PROVIDER` viene dal registro delle rotte, il cui default è
`gemini`, ma da quando ogni testo passa dal centralino quel ramo non chiama più Google:
`aiStructured` con `AI_PROVIDER === 'gemini'` va a `llmStructured`, cioè al gateway, col modello
di `LLM_DEFAULT_MODEL`. `gemini-3.7-flash` era `geminiFlash()`, un id che quel percorso non
chiede a nessuno. `'gemini'` lì dentro ha smesso di essere una famiglia ed è diventato il nome
del ramo "gateway".

Il costo non è estetico: è la PRIMA riga che si legge quando qualcosa non torna, e manda la
diagnosi dalla parte sbagliata prima ancora che cominci — è successo, cercando su Gemini un
turno che moriva altrove. È il commento scaduto della CLAUDE.md, in forma di log.

Ora la traduzione sta in una funzione sola, `textRouteLabel()`, accanto a `AI_PROVIDER` che la
governa, e dice il provider che serve DAVVERO il testo:

```
openrouter.ai (z-ai/glm-5.3-flash)      il gateway, con la lista dichiarata
kie (grok-4-5)                          rotta deviata a mano su kie
xiaomi (mimo-v2.5-pro)                  idem su MiMo
not configured (LLM_API_KEY missing)    il guasto, invece di un modello inventato
```

La stampa una volta sola, e nel punto dove un boot esiste davvero: la riga `[worker] started`,
che già dice origin, batch e poll. Un `console.log` in cima a un modulo di servizio non è il
boot di niente — gira quando qualcuno importa il file, e in un test.

**Scartato: rimetterne uno in `hooks.server.ts`.** L'app non ha un boot solo, ne ha uno per cold
start, e per stampare quella riga dovrebbe importare il grafo di `xiaomi.ts` dentro il modulo più
caldo che ha. Chi lavora davvero lo dice già dove serve, a chiamata avvenuta:
`[AI] structured call → …` e `[AI] llm responded in Nms`.

**Scartato anche: metterla in `/api/status`.** Quell'endpoint è pubblico e nasconde i vendor
apposta ("role, not vendor"): il nome del provider non ci va.
