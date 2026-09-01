# Il motion non ha più cinque beat per default

`MOTION_CRAFT_SPECS` apriva la sezione STORYLINE con l'arco scritto come una lista
di cinque: «hook → tension → demonstration → proof → resolution. Not five statements
in a row». L'ultima frase vietava le cinque frasi in fila, non i cinque beat — e
l'agente leggeva l'elenco come il conto: su un 8s e su un 45s costruiva comunque
cinque scene, e si giustificava con «5 beats is the established pattern».

Ora l'arco è dichiarato come MESTIERI e non come conto: un beat può portarne due,
un mestiere che il brief non chiede si toglie, uno che vale dieci secondi diventa
tre beat. Il numero segue durata, copione e reference.

Restano invariati i vincoli che non sono un conto: 2.5–4s per beat (leggibilità) e
il cancello QC sui 4+ beat, che riguarda i meccanismi di transizione, non quante
scene ci sono.

Il test in `craft.test.ts` guarda le due frasi nuove e vieta il ritorno di «Not five
statements»: la regola vecchia non rientra da sola.
