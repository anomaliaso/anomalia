# Gli eval di durabilità, e la documentazione che mentiva

CLAUDE.md dice *«un eval che mente è peggio di un agente che promette e non consegna»*. In questa
sessione a mentire era la documentazione: descriveva `npm run eval`, i flag `--only`/`--all`/
`--budget`/`--compare`, il costo letto da `ai_calls` e un `docs/EVAL_PLAN.md`. **Niente di tutto
questo esiste.** `package.json` aveva anche `test:durability → eval:durability`, con
`eval:durability` mai definito su nessun branch. L'unica cosa reale era `eval:ux`.

Il catalogo più ricco che il CHANGELOG archivia (`brand-nudo`, `conteggio-secco`, `pins`, `unrun`)
è stato progettato e mai mergiato. Lavoro di design perso, segnalato qui perché qualcuno decida.

## I tre scenari

Girano contro il database vero e contro il **plpgsql vero** — la presa del lease, il fence, la
chiusura recintata. È precisamente ciò che un finto client non può verificare, ed è da lì che in
questa sessione sono passati due difetti: una firma di funzione cambiata sotto al codice
deployato, e un reaper il cui contratto era cambiato sotto ai propri test.

- **`turno-ucciso-si-riprende`** — la riga resta riprendibile, viene riaccodata col suo id, e in
  chat non compare nessun mezzo messaggio.
- **`finiti-i-tentativi-il-lavoro-non-sparisce`** — alla resa il parziale diventa un messaggio col
  testo davvero prodotto. È il difetto che in una settimana ha perso 25 turni veri: 73 run
  abortiti con lavoro dentro, solo 48 recuperati.
- **`lo-zombie-non-deposita-un-doppione`** — il fence cresce, il worker sfrattato chiude a vuoto,
  chi tiene il lease chiude, e in chat resta **un** messaggio.

`--only=<scenario>` c'è. E il campo `unrun` è reale: se la migration 0229 non è applicata su quel
database gli scenari escono `UNRUN` col motivo, **prima** del giro, e l'uscita è rossa. Un eval
che non gira non è verde.

## Il brand di prova non veniva distrutto

Scoperto costruendo questo: `deleteEvalUser` non basta, perché il brand pende
dall'organizzazione. In produzione ci sono 4 brand `eval-mt*` lasciati da `eval:ux` fra il 24 e il
26 agosto — uno per giro. Il `finally` ora cancella l'organizzazione per prima; e la creazione
fallita a metà (utente già creato, nessun fixture da distruggere) ripulisce da sola prima di
rilanciare. Gli avanzi di `eval:ux` restano lì: non sono di questo lavoro e li decide chi lo
possiede.

## Il reaper si può recintare a un brand

`reapDeadKitRuns` mieteva tutto ciò che trovava — giusto per il cron, inaccettabile per un eval
che gira su un database condiviso, dove significherebbe toccare il lavoro vero di altre persone.
Ora accetta un `brandId` che recinta la passata.

## Cosa NON è coperto

**La ricarica a metà stream** — il caso "chiudo il portatile mentre l'agente scrive" — richiede il
motore col browser e la rete strozzata, che non esiste. Non lo fingo con un test che ricarica dopo
la fine del turno: proverebbe un'altra cosa. Resta scoperto, e dichiarato.
