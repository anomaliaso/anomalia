# Il thread di un agente custom nasce già col suo nome

Aprendo una chat nuova con un agente custom dal composer, per tutto il primo turno
l'intestazione e la riga in sidebar mostravano lo **specialista sottostante** («Content
Creator») invece dell'agente scelto. Dopo un reload il nome giusto compariva.

Il perché: il thread nasceva senza legame. `POST /chat/threads` non guardava
`custom_agent_id`; il composer creava il thread e poi mandava una PATCH per legarlo.
La riga ottimistica nello store arrivava dalla risposta della POST — `custom_agent_id`
valorizzato dopo la PATCH, `agents` vuoto — e `threadIdentity`, non trovando l'agente
in `agents`, ricadeva sull'avatar fisso dello specialista.

`agents` si popolava solo dai **run**: `listThreadAgentAvatars` leggeva
`custom_agent_thread_runs`, e la riga di run nasce quando il turno parte
(`touchThreadAgentRun`). Da qui il reload che «aggiusta»: a turno avviato il run c'è.

**Il fix sta dove il server sa già la risposta.** La POST accetta `custom_agent_id`,
lega il thread subito e restituisce la riga con `custom_agent_id` **e** `agents` già
risolti: sidebar, topbar e composer leggono tutti quella riga dallo store, quindi si
sistemano insieme invece di uno alla volta. La PATCH successiva dal composer sparisce
(un giro in meno).

E `listThreadAgentAvatars` non è più «chi ha girato qui»: è **chi identifica il thread**
— l'agente legato per primo, poi i run. Una query in più non c'è: gli id legati entrano
nella stessa `getCustomAgentsByIds`. Questo copre anche il fratello mai segnalato: un
thread già esistente a cui si cambia agente custom dalla PATCH non ha ancora un run col
nuovo agente, e dopo un reload mostrava il **vecchio**.

**Il guardrail in `threadIdentity`.** La regola vive in un posto solo, e ora dice che un
thread con `custom_agent_id` valorizzato non può essere nominato da nessun altro: se
l'agente legato non è in `agents`, non si ripiega né su `agents[0]` né sull'etichetta
dello specialista — resta «Anomalia» neutro. Meglio generico che sbagliato: il nome di
un altro agente è indistinguibile da un difetto di routing.

**Scartato:** far aggiornare `agents` al client dentro `setThreadCustomAgent` dello
store. Il composer ha nome, faccia e colore dell'agente scelto e sarebbe stato più
corto, ma avrebbe scritto la regola dell'identità in un secondo posto — e la seconda
copia diverge alla prima modifica.
