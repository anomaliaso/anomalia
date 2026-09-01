# Gli agenti custom al Kit, di nuovo — la #52 non era mai atterrata

Questo lavoro esiste già: è la PR #52 («Run custom-agent turns on the Agent Kit»), che GitHub
mostra `MERGED` dal 29 agosto e che il task su Notion dava «In production». Non c'era. Era aperta
contro `feat/kit-private-threads`, non contro `dev`, e quel branch intermedio in `dev` non è mai
entrato: il merge commit `346b600` non è antenato né di `origin/dev` né di `origin/main`. Per una
settimana il gate del drain su `dev` è rimasto `!personaId`, cioè gli agenti custom hanno
continuato a girare sul runner classico mentre il ticket risultava chiuso.

La verifica che lo dice in due comandi sta in `LESSONS.md`: `gh pr view <n> --json baseRefName` e
`git merge-base --is-ancestor <merge-commit> origin/dev`. Vale per ogni PR impilata: mergiarla
nella sua pila non la mette in produzione, e se la pila si abbandona la PR resta verde e morta.

## Cosa torna

Il contenuto è quello della #52, cherry-pickata (il merge commit è uno squash, quindi ha un solo
genitore e si riapplica intera), non riscritta:

- il gate del drain diventa `(params.scheduled !== true || !personaId)`: un agente custom VIVO
  gira sul kit, il suo turno SCHEDULATO resta classico (ticket #63);
- la persona entra nel turno kit come overlay `{ id, memoryKey, systemBlock }` — nessun
  `AgentSpec` nuovo, il pacchetto dei contratti non impara niente;
- `kitPersonaOverlay` è l'unico posto dove l'overlay si monta: coda e percorso interattivo lo
  importano, così non possono divergere;
- il percorso interattivo smette di buttare via il persona che `buildTurnContext` aveva già
  caricato;
- `resolveDmTarget` / `resolveDmInitiator` leggono l'identità da `custom_agents` invece che da
  `custom_agent_schedules`, e accettano il NOME oltre all'id.

## Conflitti trovati nel riportarla

Uno solo, in `src/lib/agent/bridge/live.ts`: `dev` nel frattempo ha aggiunto `approval` e
`approvalResponse` a `RunKitTurnInput`, la #52 ci aggiungeva `persona`. Campi indipendenti sullo
stesso punto dell'interfaccia — tenuti entrambi, nessun compromesso da dichiarare.

`queue.ts` e `+server.ts` si sono fusi da soli, ma valgono una verifica esplicita perché `dev` si
è mosso sotto: `buildTurnContext` restituisce ancora `persona`, `turnModelFamily` prende ancora la
preferenza dell'agente come secondo argomento, `listCustomAgents`/`getCustomAgent` esistono
ancora. Tutte e tre reggono, e il diff finale contro `origin/dev` ha esattamente le stesse
14 file / 570 aggiunte / 52 rimozioni della PR originale: nessuna riga di `dev` persa per strada.

## I test

Quelli della #52 girano qui senza una modifica e passano. Non basta che siano verdi — un test che
non può fallire non è una guardia: entrambe le guardie sono state rimesse rosse a mano prima di
chiudere. Rimettendo il gate a `!personaId`, `queue-kit-custom-agent.test` cade su 3 test su 4;
togliendo `persona: kitPersona` dal ramo interattivo, il pin di parità in `kit-parity.test` cade.
Nessun test è stato cancellato o riscritto: nessun comportamento su `dev` li ha resi obsoleti.

## Il changelog pubblico, ridatato

Le due entry pubbliche che la #52 portava con sé erano datate `2026-08-29` e non sono mai uscite.
Il loader ordina dal più recente: lasciate lì sarebbero finite sotto le sette entry già pubblicate
fra il 31 agosto e oggi, cioè annunciate nel passato e invisibili a chi apre la pagina. Il testo
resta identico; cambia solo la data, che per un changelog pubblico è la data di USCITA, non quella
in cui il codice è stato scritto. I file interni restano al 29 agosto: lì la data giusta è quando
il lavoro è stato fatto, ed è proprio quel disallineamento che questa pagina racconta.
