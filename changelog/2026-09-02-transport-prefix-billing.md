# L'ultimo prefisso che mangiava i crediti

Contato su produzione, 30 giorni. Delle righe di `ai_calls` senza costo, la stragrande maggioranza
è **giusta**: sono chiamate FALLITE, che non ci vengono fatturate (1456 deepseek, 467 kie, 169
xiaomi, 140 gemini — tutte `ok = false`, zero token).

I buchi veri sono le righe **riuscite, con i token contati e nessun addebito**:

| provider | modello | righe | in | out |
|---|---|---|---|---|
| openrouter | `openrouter/stealth/ox-alpha` | 20 | 2.079.159 | 31.120 |
| llm | `llm/z-ai/glm-5.3-flash` | 6 | 1.113.621 | 25.838 |
| llm | `llm/deepseek/…-vision-exp` | 2 | 682.070 | 41.970 |
| llm | `google/gemini-3.7-flash` | 42 | 126.912 | 100.141 |
| openrouter | `minimax/minimax-m3:free` | 3 | 148.290 | 7.130 |
| kie | `kie/gpt-5-6-luna` | 4 | 49.474 | 56 |
| llm | `google/gemini-embedding-001` | 10 | 479 | 0 |

Ai prezzi di listino fanno **circa un dollaro in trenta giorni** — su $450 fatturati nello stesso
periodo. Non è un'emorragia: è piccolo perché il traffico sul gateway è ancora piccolo, ed è
esattamente la ragione per cui va chiuso adesso, non quando il picker lo avrà moltiplicato.

Due voci non erano nemmeno un buco: `minimax-m3:free` costa zero davvero, e `stealth/ox-alpha` era
un modello a tempo (oggi non è più nel listino) servito gratis durante la prova.

## La rincorsa ai prefissi, chiusa

`llm/`, `kie/`, `google/`: ogni trasporto che passa aggiunge il suo davanti all'id, e la
normalizzazione ne toglieva due su elenco. Elencarli è una rincorsa che si perde al prossimo
trasporto. Ora si prova l'id intero e poi il suo **ultimo segmento**, e solo se le RATES lo
conoscono davvero — un id sconosciuto resta senza prezzo invece di prendere quello di qualcosa che
gli somiglia (`vendor/deepseek-v4-flash-vision-exp` non diventa `deepseek-v4-flash`).

Il resto di quelle righe lo chiudono le due cose già in `dev`: il listino live di OpenRouter per i
modelli che nessuno ha scritto nelle RATES, e `usage.cost` letto dalla risposta. **Nessuna delle
due è ancora in produzione**: `main` è indietro di quindici commit.
