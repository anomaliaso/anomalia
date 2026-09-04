# La fabbrica dei modelli di resa esce da `$lib/agent`

`craft-model.ts` decide su cosa gira una resa: un motion video e una clip UGC, due cose che
**sopravvivono** alla cancellazione del framework. Per farlo chiedeva il modello di ripiego a
`harnessSdkModel()`, che vive in `$lib/agent/bridge/adapters.ts`.

Quella funzione è lunga **cinque righe** e usa solo il centralino (`llmApiKey`,
`llmModelForPicker`, `llmLanguageModel`). Il file che la ospita ne è lungo 514 e importa la
chat (`chat/agent-files`), il sandbox di Vercel e kie. Cioè: la scelta del modello per due
capacità generative che restano dipendeva, per cinque righe, da un file che deve sparire.

Adesso quelle cinque righe stanno in `craft-model.ts`, con un nome che dice cosa fanno
(`routedModel`) e quattro prove che tengono la scaletta: la scappatoia del mestiere vince su
tutto, senza scappatoia decide il centralino, senza chiave resta il default dichiarato, e una
scappatoia fatta di soli spazi non conta come scelta. `craft-model.ts` non importa più
`$lib/agent`.

`harnessSdkModel` resta dov'è, con il suo test: serve ancora alla chat, e sparisce con lei.

## Cosa non cambia

Nessuna differenza osservabile: stessa scaletta, stesso modello scelto in tutti e tre i casi.
Nessun changelog pubblico.
