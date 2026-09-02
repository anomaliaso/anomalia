# Il provider di billing che spariva dopo il primo giro

In produzione, sul worker di Render, ogni turno di chat accodato falliva con
`TypeError: Cannot read properties of undefined (reading 'gate')` dentro `gateCredits`. Solo lì:
su Vercel lo stesso codice funziona.

`billingProvider()` dichiara "provider anomalia assente" nel modo più naturale in ESM — il modulo
`anomalia-provider.ts` lancia in cima al corpo, il `try/catch` lo assorbe e si ricade su
`openBillingProvider`. In ESM standard un modulo che lancia in valutazione resta marcato in errore
e **rilancia lo stesso errore a ogni import successivo**, quindi il catch continua a funzionare
per sempre. Nel bundle esbuild del worker no: `__esm` esegue il corpo una volta sola e azzera il
suo flag *prima* di eseguirlo, quindi al secondo giro l'init non lancia più, torna il namespace
vuoto, e `anomaliaBillingProvider` è `undefined`. `provider.gate(...)` su `undefined` esplode.

Primo job dopo ogni restart: ok. Tutti gli altri: falliti. Repro fuori dal repo, tre giri:

```
0 provider = { kind: 'open', gate: [AsyncFunction: gate] }
1 provider = undefined
2 provider = undefined
```

Il fallback ora copre entrambe le forme dell'assenza — il modulo che lancia e il modulo che non
esporta niente — con `?? openBillingProvider`. Il test blocca la seconda, che è quella che il
`try/catch` non poteva vedere.

**Scartato:** memoizzare il provider risolto in una variabile di modulo. Nasconde lo stesso
sintomo (una sola risoluzione per processo) senza dire che l'assenza ha due forme, e lascia il
`return` sbagliato in piedi per il prossimo che tocca il file.

**Scartato:** togliere il `throw` da `anomalia-provider.ts` e lasciare il file esportare
`undefined`. È il file che una fork privata sostituisce: deve continuare a dichiararsi assente in
modo rumoroso quando qualcuno lo importa direttamente.
