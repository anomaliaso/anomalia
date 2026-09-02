# Le date del changelog pubblico si scrivono come il nome del file

Il changelog pubblico ordina le entry con `Date.parse(entry.date)`, e il tipo diceva `date: string`.
Due formati convivevano: 61 voci in ISO (`'2026-09-01'`) e 14 in prosa (`'September 1, 2026'`).

Finché i due formati cadevano in giorni diversi non se ne accorgeva nessuno. Il 1° settembre 2026
sono atterrate dodici voci nello stesso giorno e una era in prosa: `Date.parse` legge la prosa come
mezzanotte **locale** e l'ISO come mezzanotte **UTC**, quindi la voce in prosa risultava due ore più
vecchia delle sue coetanee, l'ordinamento newest-first si rovesciava e il test diventava rosso —
su `dev`, per tutti, senza che nessuno avesse toccato il changelog.

Ora il nome del file è la verità e il tipo la impone: `ChangelogDate` accetta solo `YYYY-MM-DD`,
e un test verifica che ogni entry dichiari esattamente la data del proprio file. Le 13 voci
disallineate sono state normalizzate leggendo il loro stesso nome, non a mano.

Scartato: **correggere solo la voce che aveva rotto la build**. Avrebbe rimesso il verde lasciando
in piedi le altre tredici e il tipo che le permette: la prossima collisione era questione di
giorni, e sarebbe arrivata addosso a qualcun altro senza il contesto per riconoscerla.

Scartato: **ordinare per nome del file invece che per il campo `date`**. Toglie il sintomo e lascia
due fonti di verità che possono dire cose diverse; meglio che possano dirne una sola.
