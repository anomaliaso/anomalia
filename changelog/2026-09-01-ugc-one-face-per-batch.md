# Un batch UGC, una faccia sola

Con un talent o una persona del brand selezionati l'identità reggeva già: `distributeSlots`
assegna le stesse foto a ogni slot, e quelle foto entrano come reference in ogni frame e in ogni
resa video. Senza nessuno selezionato — il caso normale di chi chiede «fammi 6 clip» — ogni clip
faceva un casting per conto suo: `runOneUgcClip` rendeva un ritratto AI nuovo, senza seed né
reference condivisa, e il planner riceveva slot per slot l'istruzione di *inventare* un aspetto.
Sei clip, sei persone diverse. Non era un bug nel passaggio delle reference (cover, volto, scene e
prodotto arrivavano già a Kie/Seedance): era rotto per costruzione, un livello più in su.

Il ritratto ora si rende **una volta per batch**, subito dopo il piano, e finisce nel piano stesso
(`UgcClipPlan.castPortraitUrl`). Da lì ogni clip lo tratta esattamente come tratterebbe le foto di
un talent: `castParts` per i frame, `castUrls` per le reference del video. Il blocco che generava
il ritratto dentro la clip è sparito — non c'è un secondo percorso da tenere allineato.

**Perché nel piano e non nel run.** Un batch lungo non finisce in una sola slice: alla scadenza
`onTruncated` serializza i piani rimasti nei parametri del job e una continuazione li riprende.
Un'identità ancorata al run avrebbe dato una persona per slice — due facce su un batch da venti.
Nel piano viaggia con le clip e sopravvive alla ripresa, che è anche ciò che il secondo test
verifica.

**Scartato:** fingere un `UgcModelRef` sintetico per riusare la strada dei talent. Funzionava, ma
quel ref ha un `name` che finisce nel brief («the person from the reference frame (…)»), nella
label della clip in UI e nell'output del tool: avremmo battezzato una persona che non esiste per
non aggiungere un campo. Scartata anche la memoizzazione di una promise dentro il contesto del
run: stesso numero di righe, ma cieca alla continuazione.

Il planner, di conseguenza, non riceve più «invent a concrete speaker look» per slot ma una riga
sola che dice che il parlante è lo stesso in tutte le clip.
