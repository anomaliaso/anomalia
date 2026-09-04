# Il rilascio della CLI non può più atterrare a metà

Il workflow `cli-release.yml` esisteva completo da mesi e non è mai partito: zero tag
`cli-v*`, `anomalia-cli` inesistente su npm. Prima di proporne il primo lancio abbiamo
fatto il pre-volo, e quattro cose lo avrebbero rotto.

**Il rilascio fantasma.** Nel repository non esiste nessun secret: né `NPM_TOKEN`, né
`TAP_TOKEN`. Il workflow pubblicava la GitHub Release *prima* di `npm publish`, e in mezzo
c'era uno step che spinge un commit direttamente su `main` — che è protetto da una required
review, e il `GITHUB_TOKEN` del bot non è admin. Esito: Release creata con 380 MB di binari,
push su `main` rifiutato, job rosso, npm mai raggiunto. Esattamente la versione fantasma che
l'antenato di questo workflow (nel vecchio repo `andreabuttarelli/anomalia-cli`) evitava con
una guardia che saltava in silenzio `npm publish` — guardia rimossa di proposito, perché un
rilascio che tace è peggio di uno che grida.

La motivazione resta valida, ma gridare *dopo* aver pubblicato non serve a niente. Ora un
solo step, `Verify release credentials`, gira prima di qualunque cosa irreversibile: verifica
che `NPM_TOKEN` esista **e** autentichi davvero (`npm whoami`, non solo non-vuoto) e che
`TAP_TOKEN` ci sia. Il rilascio fallisce mentre non è stato pubblicato ancora nulla. Lo step
che spingeva su `main` è stato tolto: non poteva funzionare, e il tap riceve comunque la
formula compilata. La stessa incoerenza stava nel tap, che si auto-saltava con
`env.TAP_TOKEN != ''`; ora è il preflight a deciderlo, in un posto solo.

**I tag si chiamano `cli-v0.1.0`, non `v0.1.0`.** Il monorepo prefissa i tag del CLI, ma sia
`install.sh --version X` sia i quattro URL della formula Homebrew puntavano a
`releases/download/v${X}/`. Un tag che non esisterà mai: `brew install anomalia` avrebbe dato
404 al primo utente, e lo script che riscrive la formula rimetteva `v#{version}` a ogni
release, annullando ogni correzione a mano.

**L'installer non verificava niente.** `SHA256SUMS.txt` viene pubblicato con la release e non
lo leggeva nessuno: l'unico controllo era «il file scaricato pesa più di 1000 byte». Per uno
script che chiediamo a degli sconosciuti di eseguire con `curl | bash` e `sudo`, non basta.
Ora scarica i checksum, confronta, e si rifiuta di installare se mancano, se non c'è la riga
della piattaforma, o se il digest non torna.

**Il `read` si mangiava lo script.** Sotto `curl | bash` lo script *è* stdin: `read -p` non
legge la risposta dell'utente, consuma le righe successive dell'installer, che quindi non
vengono mai eseguite. Verificato: in una shell non interattiva il prompt cadeva a vuoto e il
ramo «installa la skill nel progetto» partiva lo stesso, scrivendo `.claude/skills/`,
`.cursorrules` e `llms.txt` nella directory in cui l'utente si trovava per caso. Ora il prompt
apre `/dev/tty` esplicitamente, e senza terminale il blocco si salta con un suggerimento.

Un dettaglio in coda: `mktemp` crea a 0600 e `chmod +x` lasciava il binario installato a 0711,
root-owned e non leggibile. Ora è 755.

**`build.ts` mentiva.** Un target che falliva faceva `continue`: `build:all` usciva 0 con due
binari su quattro. Ora esce 1.

**La versione.** Il tag sincronizzava `package.json` e `cli.ts` ma non `mcp/server.ts`, che
avrebbe continuato ad annunciarsi `0.1.0` per sempre agli host MCP. Aggiunto alla sync.

`scripts/release-contract.test.ts` tiene insieme le tre copie del prefisso del tag, l'ordine
degli step e la sincronizzazione delle versioni: contro i file di prima falliva 7 test su 10.

Restano fuori dal codice e servono a mano: i due secret non esistono, il repository
`anomaliaso/homebrew-tap` non esiste, e il nome corto `anomalia` su npm è occupato da un
progetto `create-next-app` di terzi pubblicato nel 2024 — `anomalia-cli` è libero.
