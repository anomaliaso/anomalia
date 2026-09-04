# L'image agent esce dal framework, quarto dei dodici

Quarto giro, stessa ricetta. Questo era già mezzo pronto senza che nessuno lo avesse
pensato apposta: `image-agent.test.ts` guida il giro con un finto `generateText` dall'inizio,
cioè aggancia già il confine giusto. Quei quattordici test valgono su entrambe le
implementazioni senza una riga di differenza, e sono stati la metà del lavoro.

## Cosa mancava alla rete

I test che c'erano guardano i contatori — il budget dei rendering, l'accumulo del costo per
step, lo stallo a tre impronte, la toppa al system. Nessuno guardava il *tavolo*: quali
strumenti il modello riceve davvero, che forma ha il messaggio, cosa risponde un tool
quando il tetto è finito (invece di cosa risponde il contatore), cosa esce quando il giro
non conclude niente, e cosa finisce in `agent_sessions`. Dieci test in più, e la
caratterizzazione è completa.

## Cosa nascondeva `harnessGenerateText`

Le solite cinque aggiunte, le solite tre vive su `batch`. Qui il guardiano serve a una cosa
precisa e cara: due `render_image` che tornano vuoti di fila e il renderer esce dal tavolo,
invece di lasciare il modello a chiedere un'immagine a un generatore rotto per i suoi
cinquanta step. Un rendering costa davvero, quindi non è contabilità.

## Il `finally` che aveva già ragione

`persistHarnessSession` si mette accanto al `logAiCall` che stava già lì, e per lo stesso
motivo scritto nel commento sopra: una corsa che muore ha comunque pagato i rendering che
aveva già lanciato, e tutt'e due le righe devono dirlo. Prima la traccia la salvava il
`finally` del framework; adesso la salva questo, che è lo stesso posto.

## L'arco che spariva

Prima: `image-agent.ts → harness/index → harness/run → chat/model` e `→ chat/controller`.
Adesso non più. Con questo se ne va anche l'ultimo arco che restava a `director.ts`, che ci
arrivava per `content-preview → articles → image-agent`.

## Cosa non cambia

Il cliente non osserva niente: stesse immagini, stessi tetti, stesse righe. Nessun
changelog pubblico.
