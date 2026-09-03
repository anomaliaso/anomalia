# La macchina resta viva fra una grafica e la successiva

## Il difetto che la pulizia in fondo aveva introdotto

Togliere `release()` dal percorso della risposta ha portato un render da 17.5s a 8.9s. Ma tre render
di fila davano questo:

```
13.5s   25.6s   4.4s
```

Il picco centrale non è rumore. `releaseHolder` chiama `stopWhenIdle`, che **spegne la VM** appena
non resta nessun holder valido: la pulizia della prima grafica spegneva la macchina mentre la
seconda la stava chiedendo, e quella pagava il risveglio da capo. Spostare la pulizia in background
l'aveva resa *invisibile*, non innocua — corre accanto al lavoro successivo invece che prima.

## La grazia

Il rilascio aspetta 25 secondi. Abbastanza da coprire due richieste dello stesso turno di chat,
abbastanza poco da non tenere una VM accesa per niente — e comunque non è un tetto di vita: il lease
della sandbox la spegne lo stesso.

```
prima:   13.5s   25.6s    4.4s
dopo:     9.6s    4.4s    4.5s
poi:      5.2s    4.8s    4.9s   (macchina già calda)
```

## Dove sono finiti i 17.5s iniziali

```
apertura      1.2s a caldo   (4.7s a freddo: 3.5s sono la VM che si sveglia alla prima scrittura)
render        ~2.5s
lettura       ~0.2s
pulizia       fuori dal percorso
             ─────
             ~4.8s per grafica, di fila
```

Da 17.5s a **~4.8s**: −73%. E l'apertura, che avevo dato per 4.5s incomprimibili, a caldo è **1.2s**
— i 3.5s che la gonfiavano erano la prima scrittura sulla VM addormentata, non il numero di giri.

## Cosa resta, e dove guarderei

Il pezzo grosso ora è il **render** (~2.5s): `npx remotion still` fa partire node, carica il bundle e
lancia Chromium a ogni invocazione. Riusare un browser vivo fra un render e l'altro chiede un
processo che resti in piedi dentro la VM — un piccolo server di render invece di un comando — e non
è un aggiustamento, è un pezzo nuovo.

L'apertura a freddo (~4.7s) non si comprime: 3.5s sono la VM che si sveglia, e quello lo paga la
prima richiesta di chiunque.
