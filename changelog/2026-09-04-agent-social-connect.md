# Un agente esterno può dire cosa manca per pubblicare, e consegnare la porta

Un agente esterno poteva scrivere un post per Instagram e non poteva fare niente perché
Instagram fosse collegato. Nessuno dei 63 endpoint del registry nominava account o piattaforme
social: il post veniva prodotto, restava fermo, e l'agente non aveva modo né di accorgersene né
di dire alla persona cosa fare. Era il buco che rompeva il ciclo principale del prodotto.

Due tool, non uno e non quattro.

`list_social_accounts` (`GET /social/accounts`) risponde alla domanda che oggi non aveva
risposta: **su cosa questo brand pubblica davvero**. Una riga per account — piattaforma, handle,
stato — più `connected_platforms` (almeno un account attivo), `broken_platforms` (la riga c'è ma
nessuna è viva: scaduta, revocata, scollegata), `can_connect`, `slots` e `manage_url`.
`broken_platforms` è la cosa che nessun'altra superficie mostra, ed è quasi sempre la risposta a
«perché questo post non è uscito».

`create_social_connect_link` (`POST /social/connect`) conia l'URL che **una persona** apre per
autorizzare una piattaforma, e si ferma lì.

## La forma, che è quella del billing

L'agente conia il link, l'umano lo attraversa. Nessun agente esegue un OAuth, tiene un token o
scollega un account. Il consenso a una piattaforma terza lo dà una persona.

L'URL coniato è la nostra `/app/<slug>/settings/connect/<platform>`, **non** l'URL OAuth di
Zernio. Scartato quest'ultimo per tre motivi, ognuno sufficiente da solo: coniarlo richiede di
creare il profilo Zernio del brand (una scrittura verso un terzo, innescata da una chiave API);
scade e si usa una volta sola, quindi un umano che clicca dieci minuti dopo trova un errore; e
porta un token nell'indirizzo, che è esattamente ciò che non deve attraversare questo confine.
Con la pagina nostra il consenso lo dà qualcuno già dentro con la propria login, e qui non
transita nessun segreto — il che rende il link, a differenza di quello di billing, **non** una
credenziale.

## Quello che non abbiamo esposto

**Non c'è un tool per scollegare, di proposito.** È la stessa azione al contrario e per un agente
è peggio: togliere un account ferma le pubblicazioni programmate senza che nessuno se ne accorga
finché non manca un post. Non serviva nemmeno aggiungere un link: `manage_url` è già nella
risposta di entrambi i tool, ed è la porta dove una persona scollega. Esposto come URL da
attraversare, costo zero, nessuna nuova superficie.

## Non due risposte alla stessa domanda

`get_brand_settings` (PR #277) restituiva già `connected_platforms`, con una `connectedPlatforms()`
privata dentro la sua rotta. Due letture separate della stessa cosa divergono al primo
cambiamento, e un agente che sente due risposte diverse non sa a quale credere: la lettura è stata
estratta in `$lib/server/social-connections.ts` e **entrambe le rotte la usano**. `settings/brand`
non ha cambiato di una virgola quello che risponde — i suoi 17 test lo tengono — ma adesso il suo
`connected_platforms` e quello di `list_social_accounts` vengono letteralmente dalla stessa
lettura. La differenza fra i due tool resta reale e dichiarata: uno è il riassunto per
piattaforma dentro le impostazioni, l'altro è la verità per account, e l'unico posto dove un
collegamento rotto si vede.

## Scelte minori, che però hanno una ragione

- **Il vocabolario delle piattaforme è `TARGET_PLATFORMS`**, quello che già esisteva in
  `packages/api-contracts/src/brand-settings.ts`. Non riscritto: importato. `twitter` resta fuori,
  perché è l'alias storico di `x` e due nomi per la stessa piattaforma insegnano quello sbagliato.
- **Due rifiuti separati, non uno generico.** `plan_cannot_connect` (piano che non collega
  account) e `account_limit` (posti finiti) sono due problemi con due rimedi diversi: il primo
  porta `activate_url`, il secondo `manage_url`. Un solo errore li avrebbe confusi.
- **Il tetto blocca una piattaforma nuova, non una riautorizzazione.** Se l'account è già suo il
  posto è già occupato, e rifiutare avrebbe lasciato un account scaduto senza modo di tornare vivo.
- **Nessun `zernio_account_id` nella risposta.** Non serve a niente che un agente possa fare, e un
  identificatore esposto invita a credere che ci si possa agire sopra.
- **Nessun comando CLI**, come per i link di billing: sono tool MCP e basta.

## Come è verificato

I test che contano sono i negativi, e sono stati scritti prima: una chiave di sola lettura non
conia link; nessun campo che somigli a una credenziale attraversa il confine, né nel contratto né
nella risposta reale di una rotta a cui si passano righe con `access_token` e `zernio_account_id`;
una piattaforma non supportata viene rifiutata con l'elenco di quelle ammesse. `tools/list`
catturato prima e dopo attraverso `handleMcpFetch`: 99 → 101, due aggiunti, nessuno rimosso e
nessuno dei 99 esistenti diverso di un campo.
