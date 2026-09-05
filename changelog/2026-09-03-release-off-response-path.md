# La pulizia della sandbox esce dal percorso della risposta

## Il numero

Un render di grafica costava **~17.5s**, così divisi:

```
apertura sandbox + progetto   ~6.0s
`remotion still`               ~3.4s
lettura del PNG                ~0.2s
release + addebito             ~8.0s   ← qui il PNG esiste GIÀ
```

**Quasi metà del tempo scorre dopo che il lavoro è finito.** `release()` fa `rm -rf` della directory
di run e rilascia l'holder, un giro di rete verso la VM ciascuno, e mentre lo fa il chiamante
aspetta una pulizia che non lo riguarda.

Misurato dopo:

```
prima grafica   8925ms
seconda         4876ms
```

Da 17.5s a **8.9s**, e la seconda a **4.9s** — perché la macchina non viene più smontata sotto la
chiamata successiva, che quindi si attacca a una VM ancora calda.

## Perché non basta non attendere la Promise

In una funzione serverless l'istanza si congela appena la risposta parte: una Promise pendente può
non finire mai. Qui significherebbe una directory di run che resta e — peggio — **un holder mai
rilasciato**, cioè una VM che nessuno spegne e che continua a costare.

`waitUntil` di `@vercel/functions` è il modo di dire alla piattaforma «ho ancora questo da fare».
Dove non c'è — server lungo con `DEPLOY_TARGET=node`, i test — una Promise pendente è già corretta,
perché lì il processo non si congela. `runInBackground` copre entrambi i casi e non fallisce mai: un
errore nel fondo verrebbe altrimenti fuori come rifiuto non gestito e ucciderebbe il processo che
stava rispondendo, cioè l'esatto contrario di quello che questo modulo serve a fare.

## Cosa NON è stato toccato

Il render del motion e le altre chiamate alla sandbox: continuano ad attendere la release. Qui il
guadagno è certo perché il PNG è già in mano al chiamante quando la pulizia parte; altrove va
verificato caso per caso, e un cambio a tappeto sulla gestione delle VM non è una cosa da fare di
sponda.

## Cosa resta

**~4.5s di apertura**, che è `Sandbox.getOrCreate` più quattro o cinque giri di rete verso la VM —
lo script di `sandbox_browse` (che a un render di grafica non serve), un `mkdir`, il marcatore del
browser. Unirli in un comando solo vale forse 1–2s. I 4.5s di `getOrCreate` sono il pavimento di
quell'API.
