# L'onboarding non muore più quando l'id del brand è già preso

## Il sintomo, e quanto è costato

In produzione l'onboarding si fermava su `duplicate key value violates unique
constraint "brands_pkey"`, registrato su PostHog allo step `early_create` (ultimo caso
il 25 agosto 2026). L'utente arrivava fino alla creazione del brand e lì restava: niente
brand, niente chat di setup, niente post.

Nelle sei settimane dal 27 luglio 2026: **59 onboarding avviati, 0 completati**. L'ultimo
`onboarding_preview_generated` è del 7 agosto, l'ultimo `onboarding_completed` del 15
luglio. Per i brand già dentro il prodotto continuava a funzionare tutto — 145 post
prodotti negli ultimi 30 giorni — quindi il difetto era invisibile a chi guardava la
produzione e mortale per chi arrivava nuovo.

## Perché succedeva

L'uuid del brand lo conia **il browser**: il wizard lo mette nel draft perché deve marcare
le chiamate AI su quel brand prima che il primo salvataggio risponda. Comodo, ma non è una
garanzia che l'id sia libero.

`resolveBrandId()` restituiva quell'id senza verificarlo. Il recupero di un tentativo
precedente era `.from('brands').select().eq('id', brandId).maybeSingle()`, cioè **una
lettura sotto RLS**: se la riga con quell'id esiste ma appartiene a un altro org, la
lettura torna `null`, il codice tira dritto e inserisce, e Postgres rifiuta.

`insertBrandWithSlug()` sapeva ritentare solo sui conflitti di slug — `slugConflict()`
cercava la stringa letterale `brands_slug_key` — quindi l'errore sulla chiave primaria
usciva grezzo fino alla UI. Stesso esito per la seconda strada: due submit concorrenti
leggono entrambi `prior = null`, inseriscono entrambi, il secondo sbatte sul pkey.

Attorno alla stessa domanda — «questo brand esiste già?» — c'erano tre reti di sicurezza
diverse (per sito, per id, per slug), ognuna con un buco suo: il registro di casi che
`CLAUDE.md` dice di scrivere una volta sola.

## Cosa si è deciso

**Il conflitto sulla chiave primaria si gestisce dove passano tutti i chiamanti**, accanto
a quello sullo slug che era già lì. Quando l'id arriva dal client e collide, se ne conia
uno nuovo lato server e si ritenta.

**La riga che occupa l'id non si riprende MAI.** È la decisione che conta, e va contro
l'istinto: sembrerebbe più gentile «recuperare» quella riga, e per lo slug è proprio quello
che si fa. Ma un id proposto dal client è un valore non fidato: adottare la riga che lo
occupa significherebbe consegnare il brand di qualcun altro a chi ne ha indovinato l'uuid.
Prima il difetto falliva brutto ma sicuro; un recupero più generoso avrebbe fallito bene
nel senso peggiore. Per questo la policy è esplicita nel tipo, `BrandIdSource`, invece che
implicita: chi chiama dichiara se dell'id ci si può fidare, l'helper implementa il
meccanismo.

**Scartato**: verificare l'id prima dell'insert. Non copre la corsa fra due submit
concorrenti, che invece il vincolo del database copre per costruzione.

**Rimandato**: togliere del tutto al client il conio della chiave primaria, usando l'id del
draft come chiave di idempotenza. È il difetto strutturale vero e cancellerebbe le tre reti
di sicurezza invece di insegnarne una in più a quella giusta, ma tocca lo schema e va fatto
con calma.

## Un test che diceva il contrario

`brand-create.test.ts` aveva `surfaces non-slug errors without retrying`, che asseriva
proprio il passaggio grezzo di `brands_pkey`. Non era sbagliato quando è stato scritto — un
errore inatteso deve emergere — ma `brands_pkey` su un id coniato dal browser non è
inatteso, è prevedibile. Il test ora usa un vincolo davvero imprevisto (`org_id` not-null) e
resta a guardia della regola originale.

## Verificato

Test unitari rossi prima, verdi dopo (9), suite completa verde. End-to-end sullo stack
locale con browser vero: piazzato un brand posseduto da un org estraneo sull'uuid che il
client propone, il codice precedente risponde `500 duplicate key ... "brands_pkey"` — lo
stesso identico messaggio della telemetria — e il codice nuovo risponde `303` verso la chat
di setup, con il brand creato sotto un id nuovo e il brand altrui intatto.

## Cosa NON è stato toccato

Il secondo sospetto era il vicolo cieco su `Could not fetch URL` quando lo scraper non
legge il sito dell'utente. Guardando il codice, `EntryInput.svelte` **degrada già**: se
l'analisi fallisce ma l'utente ha scritto un nome, si prosegue. Il vicolo cieco resta solo
quando non c'è né profilo né nome, e lì tornare all'input è difendibile. Meritava una
verifica, non una patch.
