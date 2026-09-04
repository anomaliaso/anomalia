# I due agenti in streaming escono dal framework — e la superficie era una bugia

Ultimi due dei dodici: `media-generator/agent.ts` e `motion-video/agent.ts`. Erano gli unici
a dichiarare `surface: 'chat'`, che accendeva i due rami che su tutti gli altri erano spenti
per definizione — il controllore in ombra e lo strumento forzato al primo step. Prima di
toglierli sono stati **misurati**, non dedotti.

## La misura

Lo strumento forzato passa da tre porte in fila: `surface === 'chat'`, poi
`acceptsForcedToolChoice(model)` che vuole un id con dentro `grok`, poi
`isHeavyProductionAsk(ultimo testo utente)`.

La seconda porta è chiusa. Questi due risolvono il modello dal centralino:
`IMAGE_AGENT_MODEL()` per il media generator, `craftAgentModel({envModel: MOTION_VIDEO_MODEL})`
per il motion. Con la configurazione di oggi tutti e due danno `google/gemini-3.8-flash`.
Grok, in questo repository, arriva dal provider **kie** (`createOpenAI` su
`api.kie.ai/grok/v1`, provider `'kie'`) — che è la strada del Director e del produce, non
questa.

Su dodici richieste tipiche («fammi un video…», «genera 3 immagini…», «più contrasto»,
«togli il logo», «ciao»…):

- con gli id veri: **0/12** — il ramo non scatta mai;
- con un id grok: **5/12** — la regex discrimina benissimo, ma non ci si arriva.

Il controllore in ombra vuole `CHAT_CONTROLLER=shadow`, che non è impostato da nessuna parte
e compare solo dentro `chat/controller.ts`.

## E se ci si fosse arrivati, sarebbe stato peggio

`FORCED_STEP_EXCLUDE` toglie `ask_user_questions` dallo step forzato, perché in chat quello
strumento chiuderebbe il turno. Motion video ce l'ha. Forzare uno strumento mentre gli si
toglie l'unico modo di fare una domanda chiarificatrice non è una protezione: è il difetto
con un'altra faccia, su un agente che non è un turno di chat e il cui giro finisce comunque
su `finish`.

Quindi `surface: 'batch'`, che è anche la verità: nessuno dei due è un turno di chat, sono
generatori invocati da codice con una richiesta già decisa.

## Cosa resta acceso

Le tre aggiunte vere — traccia di sessione, guardiano, toppa al system — sono scritte al
punto di chiamata come negli altri nove. In più, per lo streaming, ci sono le tre cose che
`harnessStreamText` faceva e che qui si vedono: lo **scatto prima dello stream** (un turno
ucciso lascia comunque system e messaggi), e `onError` / `onAbort` che chiudono la sessione
come `failed` o `aborted` invece di lasciarla `running` per sempre.

## Conseguenze, misurate

- `isHeavyProductionAsk` non ha più nessun chiamante fuori da `harness/run.ts`.
- `harness/run.ts` e `harness/index.ts` non hanno più nessun chiamante fuori dalle **due
  rotte chat** (`routes/api/v1/chat/respond/run/+server.ts`,
  `routes/app/[brand]/chat/+server.ts`). Se ne vanno con la chat, e con loro la regex.
- I quattro moduli foglia (`harness/session`, `persist`, `pipeline`, `steward`) **restano**:
  sono la traccia che la pagina Usage legge, e undici orchestratori ci si appoggiano.

## Cosa non cambia

Il cliente non osserva niente: stesse immagini, stessi video, stesse righe. Nessun changelog
pubblico.
