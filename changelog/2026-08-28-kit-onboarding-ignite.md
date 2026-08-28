# Il team contatta il nuovo utente anche sul motore kit

## Perché esiste

PR #32 ("Team contacts the new user") seminava il primo contatto degli specialisti
dopo il turno di setup dell'onboarding. Ma il blocco che la eseguiva era stato
scritto **solo nel percorso classico** del queue worker: con `AGENT_KIT=on`
(default del `.env`, quindi anche in produzione) il turno di setup gira sul ramo
kit di `queue.ts`, che chiude il job e fa `return` prima di arrivare al blocco
`igniteOnboardingTeam` del percorso classico. Risultato misurato dall'audit della
task #39 (3 onboarding completi su stack locale): setup `done`, DM fra agenti
creati, **zero thread `surface='team'`** — nessun collega contattava mai
l'utente. La funzione era sana (invocazione diretta funzionava, idempotenza
garantita da `teamThreadContacted`): era solo il percorso che non la raggiungeva.

## Cosa cambia

L'ignite è estratto in `igniteTeamAfterSetupTurn` e chiamato dal **punto di
completamento condiviso** da entrambi i motori: il ramo kit lo esegue dopo aver
chiuso il job (e solo se il job è davvero stato eseguito — un 409 `kit_busy`
torna pending senza seminare nulla), il percorso classico lo esegue come prima.
Una sola copia della regola.

## Decisioni

- **Percorso condiviso, non duplicazione**: la quarta regola del design semplice.
  L'alternativa (copiare il blocco nel ramo kit prima del return) lasciava due
  copie della regola che divergono alla prima modifica.
- **Nessuna nuova blindatura**: il try/catch con log `[onboarding-team] contact
  failed` esiste già dentro `igniteOnboardingTeam` — il ramo kit non ne ha
  bisogno di uno proprio.
- **Test guardian**: `queue-kit-onboarding-ignite.test.ts` riproduce il difetto
  (job kit su thread `surface='onboarding'` → thread `surface='team'` di
  `teamContactsForPlan(plan)` devono esistere); scritto prima del fix, visto
  fallire, poi verde.
- **Guardia eval**: `eval:ux` ora decide il motore nel run, non ereditandolo
  dal `.env` del momento (`AGENT_KIT=on npm run eval:ux` misura il ramo kit);
  il report registra `agentKit` in meta e il runId distingue la variante
  (`ux-kit-*`). Senza questo, la guardia non copriva il ramo che in produzione
  gira davvero.
