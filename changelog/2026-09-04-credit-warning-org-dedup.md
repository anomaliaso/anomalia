# Il test dell'avviso 80% seminava ancora la tabella vecchia

`dev` è rimasto rosso dal merge di #210: `credit-warning.test.ts` falliva su
`expect(notifyBrandContacts).not.toHaveBeenCalled()`, e con lui il CI di ogni PR aperta.

#210 ha spostato la deduplica dell'avviso all'80% da `brand_usage` a `org_usage` — chiave
`(org_id, month)` invece di `(brand_id, month)`, perché un'org con cinque brand deve ricevere
una mail sola quando il pool condiviso supera la soglia, non cinque identiche. Il codice è
coerente: `maybeSendCreditWarning` legge `org_usage` filtrando su `org_id`, e
`claimCreditWarning` inserisce e aggiorna la stessa tabella con la stessa chiave.

Il test no. Il suo database finto seminava una riga `{ brand_id: 'brand-1', … }` e simulava il
vincolo unico su `brand_id`: la lettura per `org_id` non trovava nulla, la prenotazione non
collideva con niente, e la mail ripartiva. Difetto del test, non del codice — verificato
leggendo entrambi i lati prima di toccare qualcosa, perché "è solo il test da aggiornare" è
esattamente la conclusione comoda che nasconde un difetto vero quando lo è.

Corretti la riga seminata e la simulazione del vincolo. Aggiornato anche il commento di
`maybeSendCreditWarning`, che nominava ancora `brand_usage`: un commento scaduto costa più di
nessun commento, e questo avrebbe mandato il prossimo lettore sulla tabella sbagliata.

**Che il test morda davvero**, verificato per mutazione e non per colore: ri-chiavando la
deduplica sul brand (`.eq('org_id', brand.id)` e `claimCreditWarning(…, brand.id, …)`, cioè la
regressione esatta che questo test esiste per prendere) il caso "non rimanda nello stesso
periodo" fallisce.

**Da guardare in review, e non è farina di questo diff:** il primo caso ("due poll simultanei
mandano una mail sola") passa anche disabilitando *entrambe* le guardie anti-spam — il return
in lettura e il valore di ritorno di `claimCreditWarning`. Nessun errore viene loggato, quindi
non è un'eccezione ingoiata; non sono riuscito a spiegarne la ragione. È così anche prima di
questo cambiamento, e non c'entra col rosso del CI, ma quel caso oggi non dimostra ciò che il
suo nome promette.
