# Il Director esce dal framework, terzo dei dodici

Terzo giro con la stessa ricetta. È il primo dei tre a discostarsi in due punti, ed è per
questo che valeva la pena prenderlo presto: se la forma regge su un orchestratore che
manda immagini e che riprova su un altro provider, regge.

## Cosa fa il giro

Il Director è l'ultimo cancello prima della coda di approvazione: guarda il batch finito
tutto insieme — didascalie e immagini renderizzate nello stesso messaggio — e ha quattro
strumenti chiusi (verificare un'affermazione sul web, riscrivere una didascalia,
rirenderizzare un'immagine con una nota da art director, segnalare un post) più `finish`.
Otto step al massimo, un tetto per strumento (2 ricerche, 3 riscritture, 2 rirender), e
non può pubblicare niente.

## Le due differenze rispetto ai primi due

**Parla per `messages`, non per `prompt`.** Le immagini stanno in un solo messaggio utente,
ognuna dopo la propria etichetta. `captureRequest` prende i messaggi invece del prompt — è
lo stesso metodo, con l'altro ramo.

**Rifà la review per intero quando kie muore.** Perdere il Director perché kie è a corto di
crediti è peggio che farlo girare su Gemini, quindi un fallimento riprova una volta,
azzerando il log parziale. Ogni tentativo è una sessione sua, quindi due righe in
`agent_sessions` — che è già quello che la pagina Usage mostrava, ma prima lo faceva il
framework e non lo diceva nessuno. Adesso è scritto dove succede.

## Il guardiano, e perché resta

`director` non è fra gli agenti a cui il guardiano impone di leggere il brand prima di
pagare una ricerca. Qui fa una cosa sola, e utile: `search_web` ha un tetto di due, e dalla
terza chiamata torna un errore; dopo due errori di fila lo strumento esce dal tavolo,
invece di lasciare il modello a bussare a una porta chiusa per i suoi otto step. Un test lo
tiene.

## L'arco che spariva

Prima: `director.ts → harness/index → harness/run → chat/model` e `→ chat/controller`.
Adesso non più da qui. Restano archi che passano da `content-preview → image-agent →
harness/index` — cioè `image-agent.ts`, un altro dei dodici — e da `content-preview →
credits → scheduler → agent-turns → chat/queue`, che è infrastruttura.

## Il guardiano dell'import sta nel test dell'orchestratore

Sul week planner e sullo strategy agent è finito in `nested-agents.test.ts`. Qui no: dodici
PR in parallelo che modificano lo stesso file di guardia si accodano sulla stessa riga per
niente. Il vincolo — «non tornare a `harness/index`» — vale per questo file, quindi vive
nel test di questo file.

## Cosa non cambia

Il cliente non osserva niente: stesse revisioni, stessi tetti, stesse righe. Nessun
changelog pubblico.
