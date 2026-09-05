# Guardie che non potevano fallire, e commenti che descrivevano meccanismi smontati

Il grafo degli import trova il codice che nessuno chiama. Non trova il codice che
mente: un commento al presente su una cosa finita, un test che sostituisce un
modulo cancellato, un guardiano che davanti a una directory rinominata tace
invece di rompersi. Questa passata cerca solo quella seconda metà.

## Le tre guardie

Ognuna verificata rompendo la cosa sorvegliata e guardando il test restare verde.
È la sola prova che conta: un test che non è mai fallito non dimostra niente.

**`blog-analytics-boundary`** teneva un confine di sicurezza — i tracker di terze
parti possono girare sul dominio del brand, mai sulla nostra origine, dove vive
la sessione di chi è loggato. Ritagliava il corpo di `brandProfile` con due
`indexOf`. Un marcatore rinominato torna `-1`, `slice(-1, n)` esce vuota, e la
stringa vuota non contiene mai "analytics". Provato: con `const analytics = 1`
dentro `brandProfile` il test falliva; rinominando la funzione in
`loadBrandProfile` e lasciando la violazione, tornava verde. Adesso i due
marcatori si asseriscono prima del ritaglio.

**`no-vite-globals`** protegge il worker: `import.meta.env` non esiste fuori da
Vite e uccide il turno prima di cominciare (due job persi in dieci ore, il 26/8).
Il suo commento promette di guardare «la CLASSE, non quella riga» — ma la
directory mancante veniva ingoiata da un `catch { continue }`. Provato: con
`import.meta.env.MODE` in `swallow.ts` falliva; spostando `src/lib/server` e
lasciando la violazione, passava leggendo zero file. Adesso i file si contano
prima (>100) e una directory che non c'è è un errore, non un silenzio.

**`calendar/page.server.delete`** faceva `vi.mock('$lib/server/video-review-store')`
su un modulo cancellato il 29/8 (`5df714e7`). `vi.mock` con una factory non
verifica che il percorso esista: quel mock sostituiva niente. La prova che era
inerte è che toglierlo non cambia l'esito dei due test.

Due guardie del repo — `packages/no-app-imports` e `cron-outliers.guard` — hanno
già il loro denominatore esplicito («il test non passa vuoto per errore»), e
`home-redirect` ha un controllo negativo che dimostra che lo scanner sa anche
dire di no. Il modello c'era: mancava in questi due.

## I commenti

Tutti trovati confrontando i nomi di file e di simbolo citati fra backtick con
quello che esiste davvero su disco. Nessuno cambia una riga di comportamento.

Il giudizio video è stato tolto il **29/8/2026** e ha lasciato dietro di sé sei
punti che ne parlano al presente: `qc.ts` che «scrive i punteggi» in
`motion-video/agent.ts`, il tetto di 4 render al giorno giustificato da «due giri
di QC» in `output-tools.ts`, `craft-review.ts` e la QC nell'intestazione del
ricettario delle transizioni, `detectWowMechanisms` elencato in `storyboard.ts`
fra i controlli che girano (quel file ne importa due, non tre),
`market-video-analysis.ts` in `wall-digest.ts`, `video-review.ts` in
`hook-tactics.ts`. La regola sotto ognuno è ancora buona: è stata riscritta senza
il riferimento morto, non cancellata.

Due file citati non sono mai esistiti: `onboarding-generate.ts` in
`content-preview/creation.ts` (la CALLER RULE annunciava due persist site, ce n'è
uno) e `meta-capi.ts` in `analytics.ts`. Il secondo è il caso peggiore della
serie: `metaPixelTrack` dice di passare lo stesso `eventID` del «matching
server-side `metaCapiEvent`», e in questo repo non esiste né quel simbolo né una
Conversions API lato server. Un'istruzione che indica un pezzo inesistente.

Il resto è deriva di nomi: `plugins/team.ts` (il kit ha perso i plugin in
`98b18453`), `live.test.ts`, `video-review-agent.ts`, `REMOTION_CRAFT_BLOCK` — il
ricettario non sta più nel prompt ma nel file `how/MAKE-MOTION-VIDEO.md` —,
`guardrailsInstruction` per `GUARDRAILS_INSTRUCTION`, `runSubagent` per
`runSubagentRun`, gli emulatori dati per «accanto» a `agent-kit/interfaces.ts`
mentre vivono in `agent-adapters`, e le due card che `HomeChatMockup` dichiarava
di ricalcare da componenti che non ci sono più.

## Quello che NON è stato toccato

`detectWowMechanisms` non ha più chiamanti di produzione da quando il giudice è
sparito, ed è tenuto in vita solo dai suoi test. Con lui, tre skill in
`default-skills.ts` dichiarano al modello un `gate` che non esiste — «QC reads
the TSX and fails a 4+ beat composition», `qc_review`, «stagger step checked by
`detectWowMechanisms`» — e `default-skills.test.ts` verifica la coppia
skill↔gate chiamando l'euristica **direttamente**, non il percorso di produzione:
per questo il test non si è mai accorto di niente. Quel testo è prompt: correggerlo
cambia cosa leggono gli agenti, e rimettere il cancello è una decisione di
prodotto. Elencato, non toccato.

Le migration (`0195`, `0187`) nominano `qc.ts` e `market-video-analysis.ts`: sono
storia applicata, non si riscrivono.

`content-quality.ts`, `design-judge.ts` e `market-trends.ts` hanno le stesse
bugie e sono già corrette sul branch `chore/video-review-residue`, non ancora
unito: lasciate a lui per non aprire un conflitto.
