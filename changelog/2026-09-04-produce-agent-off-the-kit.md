# Il produce agent esce dal framework, quinto dei dodici

Primo file della serie con **due** giri dentro: lo scrittore (`produce`) e il giudice
(`produce_reviewer`), che si passano il batch fino a quattro volte — scrivi, renderizza,
fai guardare, e se il giudice dice di no si ricomincia con il suo feedback in coda alla
stessa conversazione.

Due giri vogliono due sessioni, due `logAiCall`, due tavoli di strumenti. Il framework li
teneva insieme per conto suo; adesso lo dice il file.

## Cosa nascondeva `harnessGenerateText`

Le solite cinque aggiunte, le solite tre vive su `batch`. Qui il guardiano fa una cosa che
sul week planner non poteva fare e sullo strategy agent faceva: `produce` è fra gli agenti
che devono ancorarsi al brand prima di pagare una ricerca, quindi `search_web` non parte
finché `read_brand_studio` non è tornato. Il giudice invece non è in quell'elenco, e la sua
ricerca parte subito — ed è giusto, perché non ha un tavolo di letture del brand da
chiamare prima. Due comportamenti diversi nello stesso file, tutti e due tenuti da un test.

Il giudice non passava nessun `prepareStep`: era interamente del framework. Adesso sono
quattro righe, scritte dove serve.

## Il ripiego che resta per round

Se kie muore, **quel round** si rifà su Gemini — non l'intero ciclo. Quindi un round
fallito lascia due righe in `agent_sessions` (una `failed` su kie, una `finished` su llm) e
il ciclo prosegue da lì. Era già così; adesso si vede.

## L'arco che spariva

Prima: `produce-agent.ts → harness/index → harness/run → chat/model` e `→ chat/controller`.
Adesso non più da qui. Ne resta uno per `content-preview → articles → image-agent →
harness/index`, che sparisce con l'image agent (PR #237).

## Cosa non cambia

Il cliente non osserva niente: stesse didascalie, stessi round, stesse righe. Nessun
changelog pubblico.
