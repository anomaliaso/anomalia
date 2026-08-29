# Grok rifiutava i prompt video troppo lunghi e il clip moriva in silenzio

Cosa c'era: la pipeline immagini tagliava il prompt a 10.000 caratteri
(`buildKieImageInput`), ma il percorso video non aveva nessun tetto. Un brief lungo
— tipicamente lo shot brief dell'agente UGC specialist nel batch UGC — superava il
limite di Grok (4096 caratteri) e kie rifiutava `createTask` con "The text length
cannot exceed the maximum limit". `runPreparedRender` ingoiava il fallimento e
restituiva undefined: da fuori si leggeva solo "Video render returned nothing",
indistinguibile da un modello giù o una chiave scaduta.

Cosa cambia: il tetto di testo diventa una proprietà del modello.

- `videoModelCaps` guadagna `maxPromptChars` (Grok 4096, Seedance 10000,
  unknown ripiega su Grok), insieme a `MIN/MAX_DURATION`, `ratios` e le altre cap.
- `buildJobInput` clampa il prompt con `clampVideoPrompt` PRIMA di ogni famiglia,
  perché è l'unico punto dove modello e prompt si incontrano prima di partire
  (copre render inline, submit asincrono e batch UGC).
- Le proprietà del tool (`create_post.video_prompt`, `make_video.prompt`) ora
  hanno `.max(1200)` — il valore che `buildVideoPrompt` già onora a monte — così
  il modello viene RIFIUTATO subito e impara il limite invece di bruciare un giro.

Scartato: clammare solo nel ramo Grok. Il tetto è una proprietà del modello, e la
cap di Seedance è più alta: un solo numero globale avrebbe tagliato prompt legittimi
o lasciato scoperte le famiglie future. `clampVideoPrompt` lascia la testa del
prompt (scena + regola del frame pulito) e butta solo la coda che eccedeva.
