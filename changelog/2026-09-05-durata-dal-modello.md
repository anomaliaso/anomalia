# La durata di un video viene dal modello, non da una costante nostra

Andrea ha chiesto **5 secondi** e ne ha pagati **10**. I video si fatturano al secondo, quindi era
il doppio del conto, e niente lo diceva.

```ts
const floor = Math.min(Math.max(caps.minDuration, MIN_DURATION), caps.maxDuration);
```

`MIN_DURATION = 10` vinceva sul minimo che il modello **dichiara**. E il minimo vero non è
un'incognita: il catalogo video di OpenRouter pubblica `supported_durations` modello per modello.

```
alibaba/wan-3.0         [2,3,4,…,30]     ← parte da 2
bytedance/seedance-2.5  [4,5,6,…,30]
minimax/hailuo-3-max    [5,…,15]
```

Decisione di Andrea: **«leviamolo, lasciamo all'ai esterna decidere la durata, usando il range di
valori ripreso dall'api di openrouter direttamente»**.

## Pavimento e default sono due cose diverse

È la distinzione che rende il cambio sicuro, ed è quella che mancava:

- **un DEFAULT si può scavalcare.** Chi non chiede una durata riceve `DEFAULT_VIDEO_DURATION`, che
  **non è stato toccato** — ed è **13**, non 10. Verificato invece che assunto: `MIN_DURATION` non è
  mai stato un default, solo un pavimento.
- **un PAVIMENTO no.** E questo si spacciava per legge, facendo pagare il doppio di quanto chiesto.

Chi chiede una durata la ottiene, se il modello la sa fare. `clampVideoDuration` ora prende minimo e
tetto **entrambi** da `videoModelCaps(model)`.

## Cosa NON è cambiato

- **I gradini di Settings** (`videoDurationOptions`) restano 10/13/15/20/22/30. Sono una scelta di
  interfaccia, non un pavimento: chi passa dalla API può chiedere 5, chi sceglie da una tendina
  sceglie fra i gradini. Un test lo dice, perché la prima versione di questo cambio aveva provato a
  spostarli anche lì — allargamento non richiesto.
- **Il default**, appunto.

## Due test che asserivano il difetto

- `raises anything under the product floor — a clip too short to hold a cta is not a saving`
  asseriva il pavimento. Era una decisione difendibile e Andrea l'ha rovesciata; il test ora dice
  che si scende al minimo **del modello**, con il motivo scritto sopra così non viene «corretto»
  all'indietro.
- Il rifiuto `duration_out_of_range` della #347 usava **5 secondi su Grok** come esempio di durata
  irraggiungibile. Con il pavimento tolto, 5 su Grok si ottiene eccome. Il rifiuto resta giusto —
  cambia quando scatta: sui numeri che il modello davvero non fa, non su una preferenza nostra.
  L'esempio è ora 1 secondo su Seedance 2.5, che parte da 4.

È la quinta specie di test difettoso di queste due giornate, e la stessa della QC: **un test che
difende attivamente il comportamento sbagliato quando qualcuno prova a correggerlo.**
