# `ai_calls.org_id`: la spesa senza brand entra nel conto

Fino a qui ogni chiamata AI misurata portava un brand, e la spesa di un'organizzazione era la
somma di quella dei suoi brand: `sum_org_ai_cost_usd` fa `join brands on b.id = c.brand_id`.

Sta per esistere un render che un brand non ce l'ha — la generazione estemporanea, senza slug.
Quella riga logga `brand_id` nullo, la `join` la scarta, e la sua spesa vale zero per qualunque
organizzazione. Non è un buco di misurazione: `gateCredits` decide sul totale che quella funzione
restituisce, quindi il cancello dei crediti lascerebbe passare per sempre chi genera senza brand.

La colonna è la seconda strada verso lo stesso pool. La `join` diventa `left join` e la
condizione `coalesce(b.org_id, c.org_id) = p_org_id`: chi ha un brand risponde attraverso il
brand, chi non ce l'ha risponde da sé.

`org_id` resta nullo sulle righe che hanno un brand, di proposito. Scriverlo su entrambe darebbe
due risposte alla stessa domanda, e prima o poi divergerebbero — la `join` sui brand è già
l'unica risposta per loro.

Solo schema, come `20260903190000_org_billing_schema.sql`: nessun codice scrive `org_id` ancora.
Arriva col PR dei generatori brand-free, che deve andare **dopo** questa migrazione applicata a
mano — qui i deploy non eseguono le migrazioni, e il codice che scrive una colonna inesistente
rompe ogni logging AI, non solo il percorso nuovo.
