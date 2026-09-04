# Le patch non erano scadute: era l'install a essere sbagliato

La #268 ha rimosso tutte e tre le patch sostenendo che non applicavano più. Per due su tre
era falso, e la prova stava nel lockfile che la CI usa davvero:

```
node_modules/@ai-sdk/harness    -> 1.0.87
node_modules/@ai-sdk/harness-pi -> 1.0.89
```

Esattamente le versioni che le patch prendono di mira. Con `npm ci` applicavano entrambe, pulite.

Il `Installed version: 1.0.101` che appariva nell'errore veniva da **bun**, che risolveva versioni
più nuove perché `bun.lock` — non tracciato — è divergente da `package-lock.json`. Una diagnosi
fatta su un install locale e generalizzata a tutti: il sintomo era vero sulla macchina di chi
guardava, la conclusione no.

## Cosa si era perso

- `@ai-sdk/harness` manda in una sola volta le scritture di `writeSkills`: quattordici file a
  ~450ms l'uno erano 6,9 secondi prima che l'agente potesse rispondere.
- `@ai-sdk/harness-pi` conserva le parti immagine attraverso l'adattatore pi. Senza, un `URL`
  attraversa `Object.entries` come oggetto vuoto e viene scartato in silenzio: **il modello
  riceve solo il testo `[attached: url]`**, e le immagini spariscono senza un errore.

La seconda è la peggiore delle due, perché non fallisce: degrada.

## Nemmeno la terza era morta

`@earendil-works+pi-ai+0.74.2.patch` sembrava orfana: `patch-package` diceva *«Patch file found
for package pi-ai which is not present»*, cioè il pacchetto non c'è. Non c'era **in
quell'albero**. Dopo un `npm install` pulito `@earendil-works/pi-ai` è al suo posto, la patch
applica, e i tre test di `pi-stream.test.ts` che senza di essa leggono `error` invece di `stop`
tornano verdi.

Tre errori diversi nello stesso blocco di output, tutti e tre prodotti dallo stesso
`node_modules` rotto. Li ho letti come tre conferme indipendenti della stessa conclusione, e
invece erano tre sintomi di un'unica causa che non c'entrava niente con le patch.

## La lezione

Quando `patch-package` si lamenta, la domanda non è «la patch è scaduta?» ma **«quale install me
lo sta dicendo?»**. In un repo con due lockfile, uno tracciato e uno no, la risposta cambia la
conclusione — e più errori nello stesso blocco possono avere una causa sola, a monte di tutti.
