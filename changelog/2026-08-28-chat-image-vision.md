# Le immagini allegate in chat uccidevano il turno sul motore harness

Un utente allega una foto alla chat e il turno muore con «pi: only text
user-message parts are supported; got 'image'». Il percorso: la chat gira
sull'harness pi (live.ts → startHarnessTurn → HarnessAgent →
@ai-sdk/harness-pi), e l'adattatore pi 1.0.89, dentro `extractUserText`,
scartava OGNI parte non-testo del messaggio utente con
`HarnessCapabilityUnsupportedError`. Il catch del bridge lo scriveva in chat
come «Errore del turno». Nemmeno l'ultima versione a monte (1.0.93) passa le
immagini: l'adattatore accetta solo stringhe mentre pi stesso le supporta
da sempre (`session.prompt(text, { images })`, `ImageContent` base64).

Due decisioni del proprietario: (1) NIENTE scambio di modello — il metodo
vecchio (`vision: true` in `resolveChatModel`, che rimpiazzava un pick
solo-testo con Luna sul turno) è RIMOSSO: l'LLM di chat è e deve restare
vision-native, e un tier scelto a mano resta quello che è. (2) Le immagini
devono arrivare all'LLM per il canale nativo, non per sostituzione. La
strada alternativa — appiattire le parti immagine in righe di testo
`[image: url]` al confine del kit — è stata scartata: il modello riceve un
URL che non può aprire, ed è il modo in cui nasce la risposta inventata su
un'immagine mai vista.

Fix in tre pezzi. Sul motore classico: via `visionFallback`, via l'opzione
`vision` e i suoi call sites (turn-prep, chat/+server, il campo morto
`vision` in RunKitTurnInput). Sul motore harness: patch a
`@ai-sdk/harness-pi` (patches/@ai-sdk+harness-pi+1.0.89.patch, applicata da
`postinstall` con patch-package) — `extractUserText` non lancia più sulle
parti immagine, una nuova `extractUserImages` converte le parti immagine del
messaggio utente in `ImageContent` pi (data URL, URL remoto scaricato, byte
grezzi; un'immagine irraggiungibile si scarta invece di uccidere il turno) e
`doPromptTurn` le passa a `session.prompt(text, { images })`, il canale
nativo di pi-coding-agent. E il manifest: `ensureKieAgentDir` scriveva i
modelli come `{ id }`, quindi pi assumeva `input: ["text"]` e ometteva i
pixel a monte della chiamata («image omitted: model does not support
images») — ora ogni modello servito dal bridge dichiara
`input: ["text", "image"]`. Il limite del patch-package (pinnato a 1.0.89,
un bump della dipendenza lo invalida) è il costo noto: il postinstall lo
riapplica a ogni install.

Le funzioni patchate sono esportate dal bundle perché il contratto sia
testabile: `harness-pi-images.test.ts` le copre (5 casi, incluso il limite
di 8 immagini). Suite unit completa verde (5786); verificato nel browser
sullo stack locale: immagine allegata descritta dal modello (testo e colori
letti dal pixel), turno solo-immagine, doppio invio, reload a metà
conversazione e viewport mobile. Durante la verifica sono emersi difetti
dello stack locale che silenziavano gli upload (niente `USAGE ON SCHEMA
storage` per i ruoli, membership mancanti per `supabase_storage_admin`,
volume file senza xattr): riparati nell'ambiente, candidati per un
seed-repair self-host — non fanno parte di questa voce. Resta noto che la
nota `[N image(s) attached]` compare nel testo del messaggio utente: il
cleanup è su branch separato.
