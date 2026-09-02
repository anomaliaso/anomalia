# Il thread privato fra due agenti si chiamava Anomalia

Dal chip «1 messaggio con Content Creator» si entra nel thread privato fra i due agenti, e in
testa c'era **Anomalia** — nome e faccia del generalista, che in quel thread non c'è. Le battute
avevano già l'etichetta di chi le ha scritte, ma l'avatar accanto era lo stesso neutro per tutti e
due.

La causa è che un DM non assomiglia a niente di quello che `threadIdentity` sapeva leggere: `agent`
e `custom_agent_id` sono null (li lascia così `getOrCreateDmThread`), `room_agents` porta un
OGGETTO invece dell'array delle stanze — apposta, così per il codice delle room «non è una
stanza» — e il thread è escluso dalla lista in sidebar, quindi non arriva nemmeno la riga con gli
avatar risolti dal server. Restava l'ultimo ripiego: Anomalia.

I due membri stanno nel marcatore, con i loro nomi: si leggono da lì. `threadIdentity` ha il suo
ramo DM (nome = i due, faccia = il primo), la testata mostra la pila di entrambi, e ogni battuta
prende il volto del membro che l'ha scritta. L'avatar di un membro DM ora si deriva in UN posto —
`dmMemberAvatar` — che è lo stesso che disegna la chip: la faccia che vedi nel chip e quella che
trovi entrando sono la stessa per costruzione, non per coincidenza. La chip aveva la sua copia
della derivazione, ed è stata tolta.

## L'intestazione che il modello si scriveva da solo

Nello stesso DM le risposte aprivano con «Allegato: risposta operativa ad Analyst.»: il modello si
etichettava la battuta perché niente altro diceva chi scriveva a chi. Ora lo dicono la firma di
ogni riga e la testata, e il brief del DM — l'unico posto che governa quel turno — chiude la porta
alla riga di intestazione invece di lasciarla all'iniziativa del modello.
