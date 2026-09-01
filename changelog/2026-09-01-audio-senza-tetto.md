# Voce e musica: via il tetto per turno

`MAX_VOICEOVERS_PER_TURN = 2` e `MAX_MUSIC_PER_TURN = 2` limitavano i tentativi
audio dell'agente motion. Peggio del tetto era la contabilità: lo slot si
prendeva PRIMA della chiamata e non tornava indietro se la generazione falliva.
Una generazione fallita non addebita crediti (`gemini-audio.ts` logga `ok:false`
e non passa da `credits`), quindi il turno pagava in tentativi una cosa che non
era costata niente — e dopo un fallimento passeggero all'agente ne restava uno
solo. Nello stesso file `render_motion_video` il rimborso c'era già: il render
rifiutato dal voice-gate restituisce lo slot «perché non ha speso niente».

Ora non c'è tetto. Provare una voce, riascoltarla, rifarla con un'altra
inflessione è il mestiere, e la spesa la governano i crediti: il turno si ferma
su `credits_exhausted`, che è il freno vero.

Resta UN freno, e non è un tetto: un fallimento permanente della musica (modello
ritirato, chiave assente — `permanentMusicFailure`) spegne la musica per il resto
del turno. Nessun prompt diverso ripara un 404, e senza contatore quel caso
girerebbe all'infinito. L'errore ora si chiama `music_unavailable`: dice cosa è
successo invece di dire che il budget è finito.
