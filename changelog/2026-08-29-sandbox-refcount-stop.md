# La macchina si spegne quando il lavoro finisce, non quando scade l'affitto

## Perché esiste

Vercel Sandbox fattura la memoria a orologio fino alla scadenza del lease, idle incluso: un
turno di chat che usa la VM per 40 secondi pagava fino a 15 minuti (`SANDBOX_MAX_LEASE_MS`),
perché l'unica cosa che spegneva la macchina era il timeout. Il commento su `release()` in
`sandbox.ts` lo sapeva e lo documentava come limite accettato: senza un refcount fuori processo,
uno `stop()` diretto spegne la VM sotto i piedi di un altro turno in un altro processo.

## Cosa c'era prima

`release()` rimuoveva solo la directory della run; la macchina correva fino al lease. Le docs
Vercel raccomandano da sempre lo stop esplicito («Call sandbox.stop() when done rather than
waiting for timeout»), e il resume da snapshot è automatico nell'SDK: il vincolo era solo
nostro, non della piattaforma.

## La decisione

Contatore di holder per nome macchina in Postgres (`sandbox_holders`, una riga per holder con
`expires_at`). Le scelte che contano:

- **Righe che scadono**, non contatori puri: un processo serverless morto a metà turno non
  lascia holder fantasma che bloccano lo stop per sempre. L'alternativa (contatore con
  decremento solo esplicito) richiedeva heartbeat affidabili per ogni chiamante.
- **Chiave `(sandbox_name, holder_key)`**: upsert, non insert. Chi ripassa di qui — il poll del
  pannello desktop ogni 2.5s — rinfresca la propria riga invece di accumularne. Per il desktop
  l'upsert È l'heartbeat: nessuna release, perché il ciclo di vita lo conosce solo il browser.
- **Lo stop sta in `releaseHolder`, non in `sandbox.ts`**: la release cancella la riga e, se era
  l'ultima, chiama `stop()`. Lo `stop()` inline nel modulo sandbox resta vietato (test
  guardiano): spegnere è una decisione di contabilità, non di chi finisce per primo.
- **`KEEP_LAST_SNAPSHOTS` 2 → 1**: raccomandazione docs ("keeps snapshot storage flat"); il
  drift allinea le VM esistenti al prossimo giro, senza bump di generazione.

Scartato: il cron reaper (più lento di stop-at-zero, e con una code di minuti per brand), il
short-lease per uso (dopo lo stop sicuro il cricchetto perde il morso: ogni sessione fredda
riparte col lease giusto, e il render resta a 15 minuti).

## Cosa guarda il test guardiano

`sandbox.test.ts` non vietava più lo stop — vietava lo stop SENZA refcount. Ora vieta uno
`.stop()` diretto in `sandbox.ts`: spegnere passa da `releaseHolder`, sempre.
