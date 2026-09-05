# Le due fail-open del billing adesso lo dicono

Il gating crediti è rimasto spento in produzione per circa una settimana e nessun log lo ha mai
detto. La causa immediata l'ha chiusa la PR #161 (`anomalia-provider.ts` era uno stub che lancia,
mai sostituito da nessuna fork privata); questa chiude la ragione per cui è passato inosservato:
il percorso che concede tutto lo faceva in silenzio.

Due punti, entrambi fail-open **di proposito** — un errore transitorio di Supabase non deve
bloccare un cliente pagante, e un fork self-hosted deve poter girare senza billing. Il
comportamento non cambia: cambia che adesso si sentono.

`src/lib/server/billing/index.ts` — il `catch` che ricade su `openBillingProvider` (quota
infinita, `gate()` che non nega mai) ora passa da `swallow()`, che è già il meccanismo del repo
per "errore inghiottito ma riportato": `console.error` più `Sentry.captureException`. Copre
entrambe le forme dell'assenza già distinte qui — il modulo che lancia in valutazione e il modulo
che non esporta niente (la seconda è quella che il bundle esbuild del worker produce dal secondo
giro in poi, vedi il changelog del 2026-09-02).

Riporta **una volta sola per processo**, con un flag di modulo. `billingProvider()` risponde ai 29
gate crediti e un provider assente resta assente per tutta la vita del processo: una riga è la
storia intera, ventinove per richiesta la seppelliscono.

`BILLING_PROVIDER=open` **non logga niente**. Chiederlo è una scelta legittima; caderci dentro è
un incidente. Distinguere i due casi è metà del valore di questa modifica: un allarme che suona
anche quando va tutto bene viene ignorato, e allora tanto valeva il silenzio.

`src/lib/server/credits.ts` — i `catch` dentro `gateCreditsCore` che concedono l'azione quando non
riesce a leggere il ledger ora riportano il `brandId` e l'errore. Qui **non** c'è il "una volta
sola": è per-brand e transitorio, e se Supabase è giù è esattamente il momento in cui il segnale
serve. Sentry raggruppa da sé per fingerprint.

Sono **due**, non uno: da quando il pool è dell'org (#210) `gateCreditsCore` prima risolve l'org
del brand e poi legge il ledger, in due `try` separati, entrambi fail-open. Rispondono alla stessa
domanda — riesco a valutare quanto è stato speso? — e chi cade nel primo non arriva mai al secondo,
quindi loggare solo quello sotto avrebbe lasciato metà dei casi muti come prima. Un solo
`reportFailOpen()` serve entrambi.

**Scartato: un logger nuovo.** `swallow()` esiste già, fa già console + Sentry, ed è già usato in
tutto `src/lib/server`. Un secondo meccanismo per la stessa cosa è la duplicazione che poi diverge.

**Scartato: trasformare le fail-open in fail-closed.** Sarebbe un cambio di comportamento
mascherato da fix di osservabilità: bloccherebbe clienti paganti su un errore di rete. Se un
giorno lo si vuole, è una decisione di prodotto a sé, con la sua discussione.

**Scartato: l'import dinamico di `swallow`** per paura del bundle esbuild del worker.
`@sentry/sveltekit` resta `external` in `scripts/build-worker.mjs` (viene dalle `dependencies`), e
il build del worker passa — verificato, non dedotto.
