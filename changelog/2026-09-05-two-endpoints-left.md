# Restano due trasporti: openrouter serve, kie ripiega

`Endpoint` era `google | kie | xiaomi | deepseek | openrouter`. Adesso è **`kie | openrouter`**.

La ragione non è il prezzo, ed è la stessa per tutti e tre:

| | chiamate | fallite | p95 |
|---|---|---|---|
| kie (immagini) | 199 | 3,5% | **142,9s** |
| **deepseek** | 5.122 | **41,3%** | — |
| OpenRouter | — | — | **3,4s** |

Su un fornitore che sbaglia due chiamate su cinque non ci si costruisce un prodotto. kie resta —
non come pari, come **ripiego** — perché il TTS lo fa e OpenRouter no, e perché un secondo
trasporto vale più di zero.

## Cosa cambia, tabella per tabella

Il registro è fatto per questo: togliere un endpoint è **una riga per tabella**.

- `Endpoint`, `LogProvider` → `kie | openrouter`
- `ModelFamily` → via `mimo` e `deepseek`, che avevano casa solo lì
- `HOME` → tutto su kie: è la tabella del RIPIEGO, e il ripiego ora è uno solo
- `SERVED_BY` → `gemini` e `nano-banana` su entrambi, `gemini-tts` **solo kie**, `grok`/`gpt` solo kie
- `SLOT_DEFAULT` → testo e immagini su openrouter, voce su kie
- `endpointConfigured` → due casi

E l'ultima spiaggia di `route()`, che era `'google'`, diventa `'kie'`. Era l'unico punto in cui
Google sopravviveva senza essere nominato.

## Il TTS non si sposta, ed è MISURATO

Su OpenRouter `lyria-3` è **musica**, non sintesi vocale. Restano `openai/gpt-audio` e
`gpt-audio-mini`, e non servono:

    modalities:['text','audio'] senza stream  ->  400 "Audio output requires stream: true"
    con stream:true e format wav              ->  400 "does not support 'wav' when stream=true"

E il nostro tagliatore pretende L16 **24 kHz mono 16 bit**, che è il formato che kie già
restituisce e che `gemini-audio.ts` verifica prima di tagliare. Quindi la voce resta su kie, e
l'assenza è **dichiarata** in `MISSING` come capacità `tts` — non scoperta in produzione.

Il codice, per inciso, lo diceva già: il ramo non-kie di `generateVoiceOver` lanciava
`'TTS is kie-only. Google speech is not on the gateway.'`. La riga `gemini-tts → google` in `HOME`
era già morta, e nessuno l'aveva notata.

## Gli embedding NON sono una dipendenza da Google

`EMBEDDING_MODEL=google/gemini-embedding-001` **sembra** Google e non lo è: passa da `llmClient()`,
cioè da OpenRouter, e ci passa da sempre. Verificato: `dimensions: 768` è onorato (senza il campo
tornano 3072), e `llmEmbed` scarta già ogni vettore di lunghezza sbagliata invece di scriverlo.

Sta scritto qui perché è esattamente il nome che qualcuno "sistemerà" per sbaglio.

## Una regola che viveva in due posti

`supportsClipInToolResult` chiedeva `geminiTransport() === 'kie'` per sapere se un clip sopravvive
dentro il risultato di un tool. È una **capacità dell'endpoint**, e la risposta vive nel registro:
`graphic-review.ts` la chiedeva già con `can(route('text').endpoint, 'media-in-tool-result')`. Le
due sarebbero divergute al primo endpoint nuovo — adesso è una sola.

## Il criterio, e la deroga dichiarata

La regola era: una riga esce quando `ai_calls` dice che non ci arriva più niente. Per `deepseek` è
soddisfatta alla lettera — **zero chiamate nelle ultime 24 ore**. Per `gemini` e `xiaomi` no: nelle
ultime 24 ore restano `renderPostImage` (85) e `critiqueImage` (8).

Quel traffico però viene da codice che **non esiste più su `dev`**: #333 ha spostato le immagini su
OpenRouter e #329 ha cancellato il critico. La produzione gira codice di due giorni fa, quindi
`ai_calls` misura il passato, non il presente. Qui il criterio è il **grafo dei chiamanti**, non il
registro delle chiamate — ed è una deroga, quindi è scritta invece che applicata di nascosto.

## Quello che NON esce in questa PR

Il registro non instrada più lì, ma i moduli client restano finché non si dimostra che nessuno li
chiama: `gemini.ts`, `xiaomi.ts` (importato da 15 file), `deepseek.ts`, `deepseek-search.ts`,
`gemini-audio.ts`. Sono una storia diversa e una revisione diversa.

Per la stessa ragione **le chiavi restano in `.env.example`**: `deepseek-search.ts` legge ancora
`DEEPSEEK_API_KEY` e `xiaomi.ts` legge ancora `XIAOMI_MIMO_API_KEY`. Toglierle adesso farebbe
mentire il file nell'altro verso — escono col codice che le legge.

Restano anche da fare: le righe di `RATES` dei modelli di quegli endpoint, e il ramo Google dentro
`renderPostImage`, che il registro non può più raggiungere.
