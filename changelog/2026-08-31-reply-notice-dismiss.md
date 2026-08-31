# Gli avvisi delle altre chat si tolgono di mezzo

L'avviso di una risposta restava finché il thread non veniva aperto: con cinque
thread non letti la pila copriva il composer e mezza pagina, e l'unico modo per
liberarla era leggerli tutti.

Ora ogni avviso sparisce da solo dopo sei secondi, e prima si può togliere con la
X o con uno swipe orizzontale. Togliere l'avviso non è leggere il thread: il
segnalibro sul server non si muove e il pallino nella sidebar resta acceso. Lo
stato di quel che è stato scacciato è `threadId → conteggio non letti` al momento
del gesto, quindi una risposta nuova alza il conteggio e l'avviso ritorna da
solo — un thread scacciato non diventa invisibile per sempre.

Tre cose costate in fase di verifica, tutte invisibili nei test unitari:

- **`transition:` blocca la rimozione dal DOM.** Con `transition:fly` (o `fade`)
  sulla card, `notices` scendeva a 4 e i nodi restavano 5: l'outro non arrivava
  mai a termine e Svelte non staccava l'elemento. Via la direttiva: la rimozione
  è immediata, il movimento durante lo swipe lo fa una transizione CSS.
- **`setPointerCapture` si mangia il click.** Con la cattura attiva sul div, il
  click compat finisce sull'elemento che cattura e non sull'`<a>` dentro: la
  notifica non apriva più la chat. Lo swipe non ne ha bisogno finché il puntatore
  resta sulla card, e `pointerleave` chiude il gesto quando esce.
- **Un timer per avviso, non un array per render.** Il primo giro rifaceva tutti
  i timeout a ogni cambio di `notices`: chiudendone uno, gli altri ripartivano da
  sei secondi. Ora la mappa `threadId → timeout` non ritocca i timer già in
  corsa, e `dismiss()` è l'unico punto che spegne il timer e segna lo scaccio —
  X, swipe e scadenza passano tutti di lì.

Scartato: la pausa del countdown al passaggio del mouse. Sei secondi bastano, e
la mossa vera per non perdere l'avviso è la sidebar, che continua a segnare il
non letto.
