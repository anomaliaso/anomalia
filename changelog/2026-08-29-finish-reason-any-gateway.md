# Il fix finish_reason copriva solo OpenRouter: kie moriva uguale

PR #38 ha reso il parser pi-ai tollerante al `finish_reason` mancante **solo per OpenRouter**
(`supportsFinishReason: !(provider === 'openrouter' || baseUrl.includes('openrouter.ai'))`).
L'eval su Render ha riprodotto l'identico errore con provider `kie` e modello `gpt-5-6-luna`:
qualsiasi gateway OpenAI-compatibile diverso da OpenRouter restava severo.

Nuova semantica del patch, per ogni provider: se nella risposta è arrivato **qualcosa** (testo o
tool call), il turno si chiude bene (`stop`/`toolUse` dedotti dal contenuto) anche senza
`finish_reason`; se non è arrivato **nulla**, l'errore resta — lì il flusso è davvero rotto e
nasconderlo produrrebbe una risposta vuota fingendo tutto normale.

Tre test nuovi in `pi-stream.test.ts`: kie con testo → `stop`; kie con solo tool call →
`toolUse`; kie senza nulla → `error` (il parser non lancia: il fallimento emerge come
`stopReason: 'error'`, scoperto scrivendo il test).
