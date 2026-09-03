# Una sandbox per N grafiche

## Il rapporto che non regge

Misurato nella VM, per UNA grafica:

```
apertura sandbox + progetto   ~6.0s
`remotion still`               ~3.4s
lettura del PNG                ~0.2s
coda: release + addebito       ~8.0s
                              ─────
totale                        ~17.5s
```

**~14s di macchina per 3.5s di lavoro.** Per una grafica chiesta in chat è accettabile. Ripetuto
è il costo dominante, e si ripete: due chiamate consecutive pagano entrambe l'apertura per intero —
misurato 6075ms e 6022ms. Il nome della VM è stabile per brand e gli holder esistono, ma
`openBrandSandbox` non si attacca a una macchina viva: rifà il giro ogni volta.

## Il taglio

`renderGraphicStills` rende N grafiche su UNA apertura. Misurato, quattro grafiche:

```
22.9s in totale   ← contro ~67s facendole una per volta (−66%)
  6.1s apertura + progetto
  3.4s la prima
  1.9s / 1.8s / 1.8s le successive
  7.9s coda
```

Il marginale crolla da 17.5s a **~1.85s**. Un carosello da dieci slide passa da tre minuti a mezzo
minuto.

`renderGraphicStill` resta come forma comoda sopra il plurale, così i chiamanti di oggi non cambiano.

## L'isolamento, che è il motivo per cui non è un `Promise.all`

L'ordine dell'array è l'ordine dei risultati, e un fallimento su una grafica torna il suo errore
**al suo posto** invece di far cadere le altre. Perdere nove slide perché la decima non compila
significherebbe pagare un render intero per niente — e il lease si controlla prima di ogni grafica,
così una macchina che sta per spegnersi restituisce quelle fatte invece di perderle tutte.

## Onestà su cosa questo NON accende

**Oggi nessuno lo chiama col plurale.** Le slide di un carosello si compongono e si modificano una
alla volta (`design_graphic` con `slide_index`, `editCarouselSlide`), e `produce_week` genera foto
AI, non grafiche tipografiche. Quindi il −66% è una capacità pronta, non un risparmio già in corso:
si realizza quando un percorso carosello chiederà N slide in un colpo.

L'ho scritto lo stesso perché il numero che lo giustifica è misurato e perché il costo che evita —
dieci aperture di VM per un carosello — è quello che terrebbe il renderer Chromium spento anche
dopo che tutto il resto funziona.

## Il prossimo taglio, più grande e non speculativo

Gli **~8s di coda** valgono anche per una grafica sola: quando quel tempo scorre il PNG **esiste
già**. Aspettare `release()` prima di rispondere è far pagare all'utente una pulizia che non lo
riguarda. Spostarla fuori dal percorso della risposta vale ~8s su OGNI render, oggi, senza bisogno
di un chiamante nuovo.
