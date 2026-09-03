# ensureOrgForUser() poteva creare due org per lo stesso owner

`ensureOrgForUser()` (`src/lib/server/org.ts`) era check-then-insert senza nessun vincolo
DB su `organizations.owner_id`: due richieste concorrenti di creazione del primo brand per
lo stesso utente nuovo (doppio submit, due tab) potevano entrambe superare il check e
inserire una riga ciascuna. `organizations.owner_id` aveva solo un indice non-unique
(`organizations_owner_id_idx`, migration 0164, per performance RLS), niente che impedisse
il duplicato.

Aggiunto il vincolo unico `organizations_owner_id_key` (droppando l'indice non-unique
ridondante, la stessa colonna). `ensureOrgForUser` ora tenta l'insert e, se perde la race
(violazione del vincolo), ri-seleziona la riga del vincitore invece di tornare `null` — lo
stesso pattern già in uso in `insertBrandWithSlug` (`brand-create.ts`) per la stessa classe
di problema su `brands.slug`.

**Scartato:** un lock applicativo (advisory lock o `SELECT ... FOR UPDATE`). Il vincolo
unico più il retry-by-reselect è più corto, non tiene una connessione bloccata in attesa,
e ricalca un pattern già presente e testato nel repo invece di introdurne uno nuovo.

Test: `src/lib/server/org.test.ts`, osservato rosso (la chiamata che perde la race tornava
`null` invece dell'org condivisa) prima del fix.
