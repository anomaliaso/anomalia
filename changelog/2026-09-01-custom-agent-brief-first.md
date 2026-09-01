# La consegna del custom agent apre il prompt, non lo chiude

Su `dev` dopo la #118 un agente custom con un brief molto caratterizzato — «Scriba Fischietto, un
notaio teatrale» — a volte si presentava come «Content Creator»: l'identità dello specialista
sottostante invece della propria. Non sistematico: un turno con la voce giusta, il successivo no.

Un agente custom non ha un `AgentSpec` suo. È il mestiere del thread con la consegna dell'utente
sopra — e «sopra» va preso alla lettera, perché `customAgentSystemBlock` non aggiunge un compito:
dichiara *chi è* l'agente. In `runKitTurn` quella dichiarazione stava **in coda** a tutto il
prompt dello specialista, che si apre con `You are Content Creator (…), an Anomalia agent.` e
prosegue con le sue istruzioni, la memoria (fino a 32 KB) e l'indice dei file del brand. Fra la
prima identità e la seconda ci passano decine di migliaia di caratteri: quale delle due vinca il
turno diventa una questione di fortuna.

La stessa trappola era già stata pagata dal DM fra agenti, tre righe più su, e il commento che la
racconta è ancora lì: in coda il brief perdeva contro l'intero prompt di brand e il modello
salutava l'utente per nome. La persona è rimasta dov'era.

Ora la consegna sta in testa, subito **dopo** il brief del DM e prima di `buildSystemPrompt`.
L'ordine fra i due non è arbitrario: il brief del DM è la cornice della conversazione (con chi
stai parlando, e che non è una persona) e ha guadagnato la prima posizione con un incidente vero;
la consegna è l'identità di chi parla, e le basta precedere il mestiere che indossa — il pezzo
contro cui perdeva. Il resto dell'ordine — lingua, squadra, modalità, obiettivo — non si muove.

**Il limite, dichiarato.** Il test prova che il blocco arriva in testa, non che il modello smetta
di sbagliare identità: quello lo direbbe solo una eval, che non è stata eseguita. Il difetto è
intermittente, quindi nessun singolo turno andato bene vale come prova del contrario.

**Non toccato:** il motore classico ha la stessa forma in due punti (`chat/queue.ts`,
`chat/lib/turn-prep.ts`: `systemPrompt += customAgentSystemBlock(...)`). Il difetto segnalato sta
sul percorso kit e il fix resta lì; i due siti classici sono candidati alla stessa mossa, con la
loro eval.
