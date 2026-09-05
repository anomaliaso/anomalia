# La voce passa a OpenRouter, e kie diventa il ripiego

Lo slot `tts` era l'ultimo su kie, e il registro spiegava perché con una riga in
`MISSING`: «OpenRouter non fa sintesi vocale». Era falsa. Le prove che l'hanno
sostituita stanno qui sotto, insieme ai due modi in cui è stata cercata e non
trovata — perché la riga sbagliata è costata due sessioni, e chi rilegge
`MISSING` fra due mesi deve trovare scritto anche come ci si sbaglia.

## Le due conclusioni sbagliate

**Uno: «gpt-audio rifiuta il WAV».** Chi ha provato per primo ha usato
`chat/completions` con `openai/gpt-audio`, `audio.format: "wav"` e `stream: true`,
e ha preso un 400. Il 400 diceva: *«does not support 'wav' when stream=true.
Supported values are: 'pcm16'»*. La risposta era dentro l'errore, alla riga dopo
quella letta. Con `pcm16` lo streaming funziona — sei chunk, 79.200 byte di PCM.

**Due: «l'endpoint /audio/speech non è utilizzabile».** Corretto il primo errore,
`/audio/speech` è stato sondato con `openai/tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`,
`gemini-2.5-flash-preview-tts`, `eleven-v3` — tutti 400 «modello inesistente», e
la conclusione è stata che l'endpoint fosse morto. L'endpoint era giusto: erano
gli id a essere inventati. Il modello vero è `google/gemini-3.1-flash-tts-preview`,
e **non compare** nel catalogo `/models` filtrato per modalità audio — la seconda
superficie di OpenRouter in un giorno che da quel catalogo non si vede.

Il modo che funziona per trovarne altre: chiamare un modello TTS su
`chat/completions` restituisce un errore che **nomina l'endpoint corretto**.

## Cosa è stato misurato prima di scrivere il codice

Contro l'API vera, non dal listino:

- **`POST /audio/speech`** con `google/gemini-3.1-flash-tts-preview` → 200, e
  `content-type: audio/pcm;rate=24000;channels=1`. `response_format` accetta
  `mp3|pcm` sull'endpoint, ma questo modello risponde `pcm` e basta (400 esplicito
  sull'altro).
- **La frequenza è davvero 24 kHz**, e non perché lo dice l'intestazione. Stesso
  copione, stessa voce, su kie (il cui WAV dichiara 24000/1/16 nel suo header): il
  parlato copre **3,20 s** su kie e **3,20 s** su OpenRouter letto a 24000. Su uno
  script di tre righe le pause cadono a 2,20/3,82 s su kie e 2,16/3,80 s su
  OpenRouter. A 16 o 48 kHz quegli istanti sarebbero scalati di 1,5× o 2×.
  Il WAV prodotto, ridato a un modello con audio in ingresso, torna trascritto
  parola per parola e giudicato «natural in pitch and pace».
- **Le voci sono le stesse.** `Kore`, `Puck`, `Charon`, `Aoede`, `Fenrir` — le
  cinque che il prodotto offre — accettate tutte. Un nome fuori elenco (`alloy`) è
  400: l'endpoint valida invece di ripiegare in silenzio su una voce di default,
  che era il rischio vero. Per il cliente non cambia niente: stessa famiglia
  Gemini, stessi preset.
- **Il costo è lo stesso.** Stesso copione di tre righe: kie 1,19 crediti =
  **$0,00595**, OpenRouter **$0,005772**. La testata del registro diceva che il
  TTS su kie costa ~3× Google e che lo scopo era togliere una dipendenza, non
  risparmiare; il confronto giusto oggi è kie contro OpenRouter, e non c'è
  differenza. Il motivo per spostarsi non è il prezzo: è che kie torna a essere il
  ripiego che è ovunque, e la voce smette di essere l'unico slot senza rete.
- **La direzione di lettura non viene letta ad alta voce.** Il take con la
  direzione in testa dura **meno** di quello senza (3,36 s contro 3,76 s): è
  interpretata come stile, esattamente come `sample_context` su kie. Quindi
  `buildVoiceOverPrompt` passa così com'è.

## Cosa è cambiato

`SLOT_DEFAULT.tts` è `gemini-tts@openrouter`; `HOME['gemini-tts']` resta `kie`.
Sono due ruoli diversi e non si collassano: il default dice dove va il traffico
quando funziona, `HOME` dove va quando il default non è servibile. Senza
`OPENROUTER_API_KEY` la rotta ripiega su kie **rumorosamente**, come ogni altro
slot.

`MISSING.openrouter` è vuoto. `SERVED_BY['gemini-tts']` ha due endpoint.

Il trasporto è `llmSpeech` in `llm.ts`, una richiesta sola: non streaming, non
`gpt-audio`. `gpt-audio` funziona davvero (`pcm16` + `stream: true`, provato) ma è
OpenAI, cambierebbe la voce, e andrebbe ricomposto a pezzi. Resta annotato come
alternativa, non come scelta.

Il PCM grezzo non ha intestazione, quindi `llmSpeech` **riporta a chi chiama** la
frequenza e i canali che ha letto dal `content-type` invece di darli per scontati:
un 48 kHz stereo non fallisce, dura il doppio e parla a metà velocità. Il controllo
del formato, che prima esisteva solo dentro il ramo kie, adesso è una funzione
sola (`assertCuttable`) usata da entrambi i rami — la regola è una, e sta in un
posto. L'incapsulamento riusa `wavFromPcm`, che c'era già.

**UNA generazione per tutte le righe** resta la proprietà del file, e ora ha un
test che la sorveglia: sei righe, esattamente un POST, e tutte e sei nel corpo.

## Quello che si perde, e non si nasconde

Su kie la riga di `ai_calls` porta `creditsConsumed` e quindi un costo.
`/audio/speech` non porta nessuna fattura: nessuna intestazione, nessun corpo JSON.
`GET /generation?id=` esiste ma è già stato misurato e scartato — sta scritto in
`llm-usage-cost.ts`: il record compare **nove secondi dopo** la risposta, e tenere
viva una funzione serverless per aspettarlo perde anche la riga di log.

Quindi la riga del voice-over resta **senza costo**. Un buco visibile invece di un
numero plausibile e sbagliato, che è la regola già scritta in questo file. Il
prezzo per audio token esiste ($0,00002) ma i token per secondo misurati sono
ballati fra 25 e 49 su tre chiamate: dedurne un costo sarebbe inventarlo.

## I test

Il primo non è «arriva dell'audio»: quello passerebbe con un formato inutilizzabile,
che è precisamente l'errore che ha prodotto la conclusione sbagliata. È **la forma
che il tagliatore accetta** — il WAV caricato viene riletto da `pcmFromWav` e deve
dire 24000/1/16, con i campioni identici a quelli generati. Il secondo rifiuta un
48 kHz e uno stereo. Poi: una generazione sola, e il ripiego rumoroso su kie senza
chiave.

In `model-routing.test.ts` due test usavano `gemini-tts@openrouter` come esempio di
*coppia senza trasporto*, e sono diventati rossi — l'esito buono. Le coppie sono
state **cambiate**, non le asserzioni: restano `grok@openrouter` e `gpt@openrouter`,
e che sorveglino ancora qualcosa è stato verificato dando loro un trasporto e
guardandoli diventare rossi. Una coppia che diventa *non parsabile* invece che
*servita* lascerebbe il test verde a misurare il ripiego al default: è già successo,
e non si vede.
