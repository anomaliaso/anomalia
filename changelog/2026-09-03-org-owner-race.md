# Quale org risponde a `ensureOrgForUser`, quando l'utente ne possiede più di una

`ensureOrgForUser()` (`src/lib/server/org.ts`) sceglieva l'org dell'utente con
`.eq('owner_id', …).limit(1).maybeSingle()`, **senza `order by`**. Con più righe per lo stesso
owner, quale riga risponde non è definito: Postgres restituisce quello che gli conviene, e può
cambiare tra una richiesta e l'altra. Un brand nuovo finiva quindi in un'org a caso tra quelle
dell'utente — e con la fatturazione che si sposta a livello org (mappa #183), "a caso" diventa
la differenza tra un'org che paga e una che non paga.

Non è un caso teorico: in produzione ci sono **94 org su 89 owner distinti**, e **due owner
possiedono più org** — uno ne ha cinque, quattro delle quali con un brand dentro.

`ensureOrgForUser` ora sceglie sempre la **più vecchia** (`created_at`, con `id` come
spareggio su timestamp identici), e sulla via della creazione rilegge con lo stesso criterio:
due chiamate concorrenti che inseriscono ciascuna la propria riga convergono comunque sullo
stesso id, invece di andarsene con due org diverse.

**Scartato: il vincolo unico su `organizations.owner_id`.** Era la prima versione di questa
patch, ed era sbagliata due volte. Sarebbe fallita in applicazione (i duplicati in produzione
esistono già), ma soprattutto avrebbe deciso una regola di prodotto — «un utente possiede al
massimo un'organizzazione» — nascondendola dentro un fix di concorrenza. Il multi-org resta
supportato, per scelta esplicita.

**Scartato: la prevenzione della race con advisory lock in una funzione Postgres.** Impedirebbe
la riga duplicata, ma la riga duplicata non fa danno: è un'org vuota che, con la scelta
deterministica, nessuno userà mai. Costerebbe una migration, una funzione SQL e un nuovo modo
di fallire (contesa sul lock) per un sintomo già neutralizzato.

I due owner con org duplicate in produzione restano come sono: nessun dedupe, che significherebbe
ri-puntare `brands.org_id` di brand veri. Ora però il comportamento è stabile.

Test: `src/lib/server/org.test.ts`, osservati rossi prima del fix (la selezione rispondeva con
l'org sbagliata, e due chiamate concorrenti tornavano due id diversi).
