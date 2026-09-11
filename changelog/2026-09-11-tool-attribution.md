# Chi ha chiamato quale tool, su quale brand, e quanto è costato

`mcp_logs` aveva zero righe in produzione, per due motivi distinti. Il secondo — una variabile
d'ambiente mancante al progetto Vercel dell'MCP — l'ha messa Andrea a mano, e dopo il deploy la
tabella è passata da zero a 162 righe. Solo che quelle righe raccontano il **transport** e non cosa
succede dentro:

```
09:00   11 richieste   11 non autorizzate    0 ok
10:00   58 richieste   15 non autorizzate   40 ok
```

Alle nove non passava nessuno — un client configurato male che non completava l'OAuth. Alle dieci,
quaranta risposte a buon fine. Quello che manca è **chi**, **quale tool**, **su quale brand**: tre
colonne che `observability.ts` scrive già fra le sue quindici e che arrivavano sempre `null`,
perché nessuno in `cli/mcp/` le passava. `grep -rn toolName cli/mcp/` fuori da `observability.ts`
non trovava niente, e lo stesso valeva per `userId` e `brandSlug`.

Ventisei richieste su sessantanove finiscono 401. Con `user_id` quel numero si separa in «un
cliente non riesce a collegarsi» e «qualcuno sta sperimentando», che vogliono risposte opposte. Con
`brand_slug` un errore diventa attribuibile al brand, che è l'unità su cui questo prodotto ragiona.
Con `tool_name` si risponde a «questo tool vale quello che costa».

## Una riga per chiamata, e non è il tool a scriverla

`recordToolCalls` decora `registerTool` una volta sola, prima che i quattro moduli registrino —
lo stesso punto e la stessa tecnica di `trimListedTools`, che già stava lì. Le tre colonne si
riempiono dove il tool viene eseguito, che è un posto solo: un lavoro solo, non tre. E un tool
nuovo è strumentato per il fatto di esistere, non perché qualcuno si ricorda di scrivere la riga.
La riga porta nome del tool, brand, utente, durata, ed è `warn` quando il tool torna un errore: un
tool che fallisce è quello che più di tutti si vuole nei log, e prima non lasciava niente.

**`user_id` è l'identificatore, e si ferma lì.** L'identità arriva a questo punto con l'email
accanto — `getRequestAuth()` la porta entrambe — e il percorso comodo la infilerebbe nella riga
senza che nessuno se ne accorga. La tabella la leggerà chi non ha motivo di vedere l'indirizzo di
un cliente, quindi un test verifica che nella riga non compaia nemmeno una chiocciola.

**E niente di tutto questo può rovesciare la chiamata che sta descrivendo.** Gira dentro il server
MCP, adesso su *ogni* tool: `mcpLog` faceva `void mcpLogAsync(entry)`, e una promise respinta
lasciata così è una unhandled rejection — in Node abbatte il processo, cioè la richiesta di un
cliente, per non essere riuscita a descriverla. Ora il rifiuto finisce in un `console.error`, come
tutto il resto di quel file. Il test lo riproduce con un `context` circolare, che fa fallire il
`JSON.stringify` prima di qualunque rete.

Il test guarda la riga che arriva a PostgREST — un server HTTP vero, alzato dal test — e non la
funzione che la chiama. `mcpLog` invocato coi campi giusti ma senza destinazione non prova niente,
ed era esattamente il caso che ci ha portati fin qui.

## E il collegamento con la spesa, che è la parte che serviva davvero

`ai_calls` registra la chiamata al modello, non chi l'ha causata, e le sue etichette
(`planStrategy`, `seoAgent`, `reviewCaptions`) sono condivise fra l'autopilot, la chat in-app e gli
agenti esterni: il totale di un'etichetta è un tetto, non un'attribuzione. Il nome del tool viaggia
ora fino alla riga:

```
tool MCP ──asTool()──> cli/lib/api.ts ──x-anomalia-tool──> hooks.server.ts
    ──withToolContext()──> logAiCall ──> ai_calls.context = "tool:plan_week"
```

Tre decisioni che vale la pena spiegare:

- **`context` e non una colonna nuova.** I deploy di questo repo non eseguono le migration: una
  `insert` che nomina una colonna non ancora applicata viene rifiutata **intera**, e il rifiuto è
  un `console.warn` — cioè si spegnerebbe in silenzio l'unica misura di quanto costa il prodotto.
  `context` è già una colonna di etichette prefissate (`music:pro:30s`, `sandbox:render:12s`), e
  «quanto è costato ogni tool» si chiede con `context like 'tool:%'`.
- **Il call site vince.** Dove `context` è già scritto resta com'è: quella riga sa di sé più di
  quanto sappiamo noi. Le etichette care di cui si discuteva — `planStrategy`, `reviewSeeds`,
  `reviewCaptions` — non lo scrivono, quindi sono proprio quelle che il tool riempie.
- **Il nome si convalida nel hook.** Arriva dalla rete: chiunque può spedire quell'intestazione, e
  una riga attribuita a un tool inventato è peggio di una riga senza nessun tool. `toolFromHeader`
  accetta solo la forma che un tool ha davvero, e un test lo confronta con tutti e ottanta.
- **Uno scope suo, non un campo di `BrandLogContext`.** Una rotta che rientra in
  `withBrandContext` per conto proprio ricomincia quel contesto da capo e si porterebbe via il
  nome del tool senza che niente lo dica.

## Cosa questo NON copre

- **La chat in-app.** I suoi tool non passano da `cli/lib/api.ts`: chiamano le funzioni server
  direttamente, quindi le loro righe restano senza `tool:`. Metà della domanda «questo tool vale
  quello che costa» riguarda proprio quella superficie. Il pezzo che manca è un `withToolContext`
  attorno all'esecuzione dei tool della chat — stesso scope, stessa colonna, altro diff.
- **Una riga con `context` già scritto** non porta il tool. Vale per i job kie, le immagini
  openrouter, la musica e la sandbox: lì il tool si perde. Servirebbe la colonna dedicata, e
  quella una migration applicata **prima** del deploy.
- **`SUPABASE_SERVICE_ROLE_KEY` sul progetto Vercel dell'MCP.** Non è codice: finché manca,
  `mcp_logs` resta vuota. Adesso però lo dice — una riga all'avvio, una volta sola.
