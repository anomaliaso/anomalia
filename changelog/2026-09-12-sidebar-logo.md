# Il marchio in testa alla barra del brand

Togliendo «Panoramica» — che portava a `/app/<slug>`, cioè dove porta «Home» due righe sotto —
l'header della barra era rimasto vuoto. Teneva ancora il suo lavoro invisibile (l'altezza della top
bar delle pagine e il filo che ci si allinea), ma da fuori era una fascia di 56px senza niente.

Ci va il marchio, e porta a `/app`. Non è una destinazione inventata per riempire: è l'unico posto
che da dentro un brand non si raggiungeva più. Ed è la stessa riga che ha già la barra di `/app`
accanto — stesso `BrandMark`, stessa destinazione, stesso comportamento quando la barra si stringe
a icone. Due barre della stessa applicazione non devono avere due teste diverse.

Il marchio è allineato con le icone della nav (20px contro 18px: lo scarto è l'inset del disegno
dentro il suo riquadro), e in modalità icone si centra come loro.
