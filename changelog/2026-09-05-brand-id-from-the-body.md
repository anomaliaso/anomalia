# Il brand lo sceglieva chi chiamava, e il conto lo pagava un altro

La stessa classe delle due scritture chiuse poco fa, presa dall'altro capo. Lì c'era un id da
scopare in un `WHERE`; qui **non c'è nessun `WHERE`: il tenant È il valore che arriva dal corpo.**

Sei rotte di onboarding leggono `brandId` da `await request.json()` e lo usano senza chiedersi di
chi sia. Quattro lo passano a `startOnboardingStepJob`, che lo scrive come `brand_id` di una riga
inserita col client service role; due aprono direttamente `withBrandContext(brandId)`. Da lì in
poi ogni chiamata AI di quel lavoro viene registrata in `ai_calls` con quel `brand_id` — e
`credits.ts` somma esattamente quelle righe come consumo del brand.

**Quindi non attraversa il dato: attraversa il conto.** Un utente qualsiasi nomina il brand di un
altro cliente e gli fa pagare il proprio consumo. `/preview` genera sei immagini per richiesta,
quindi il costo per chiamata non è simbolico.

## Perché nessuno se n'era accorto

Perché in cima a tutte e sei c'è un `403`, e sembra un confine:

```ts
if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });
```

`canEnter` è il flag della beta chiusa, e la sua stessa fonte lo dice:
*«questa è una porta commerciale, non un confine di sicurezza»*. Chi leggeva la route vedeva un
cancello e smetteva di cercarne un altro. Il commento diceva la verità e veniva letto al
contrario.

## La verifica: la domanda si gira al database

`ownsBrand` in `access.ts`. Non c'è niente da dedurre dal valore — arriva da fuori — quindi la
risposta la danno le policy: la SELECT su `brands` restituisce solo i brand di cui sei
proprietario dell'org o membro (`brands via org` + `brands member select`), che è **la stessa
regola** che `loadBrandForUser` riapplica a mano sul percorso a chiave API. Una regola sola, in un
posto solo.

Un client non marchiato `markRlsScoped` riceve `false` senza nemmeno interrogare: un client che
scavalca la RLS risponderebbe di sì per il brand di chiunque, e il default deve essere il rifiuto
— così un percorso nuovo che si dimentica di marchiarsi resta chiuso invece di aprirsi da solo.

Nelle sei rotte la riga sta subito sotto quella di `canEnter`, che è dove un lettore la cerca:

```ts
if (brandId && !(await ownsBrand(supabase, brandId))) return new Response('Forbidden', { status: 403 });
```

`brandId &&` non è difensivo: in due rotte (`plan/posts`, `preview/images`) il brand può
legittimamente non esistere ancora — è onboarding, la bozza precede il brand — e un `brand_id`
nullo non attraversa niente.

## La terza regola della guardia

`src/no-cross-tenant-writes.test.ts` aveva due regole, entrambe cieche a questa forma: guardano
l'id nel `WHERE`, e qui il `WHERE` non c'è. La terza guarda il legame che manca: **un valore che
nomina un tenant** (`brandId`, `orgId`, `userId`, …) **assegnato da qualcosa che viene dal corpo,
in un file dove nessuno chiama `ownsBrand`.**

Provata sul sorgente prima della correzione trova sei occorrenze, esattamente le sei rotte, e zero
falsi positivi su tutto `src/`. Dopo, zero. Quattro sonde a fixture la ancorano — segnala il
`brandId` non verificato, accetta quello verificato, e non confonde né un id che viene da un brand
già caricato né un campo del corpo che non nomina un tenant.

Nessuna allowlist, per lo stesso motivo di prima: un'allowlist da sei voci diventa un timbro alla
settima.

## E l'ultimo `200` disonesto

`updateMemoryEntry` e `deleteMemory` rispondevano `200 {"ok":true}` anche quando non toccavano
niente. Nessun dato attraversava — il `WHERE` regge — ma è **la stessa disonestà che rendeva
sfruttabile il difetto dei tag**: un update che non tocca nulla e non lo dice fa proseguire il
codice che gli sta dietro. Adesso passano da `updateBrandRow`/`deleteBrandRow`, che contano le
righe, e i tre endpoint della memoria rispondono `404` invece di mentire.

`expression-memory-tools.ts` e le azioni di `knowledge/+page.server.ts` ignorano ancora il valore
di ritorno: nessuna scrittura le segue, quindi il silenzio lì non apre niente. Restano da
raccogliere quando qualcuno passa di lì.

## Cosa NON è stato toccato

Il `load` di `site/edit/[id]` legge `brand?.id` da una riga che seleziona solo `website`, quindi
`undefined`, quindi categorie, tag e autori sono sempre interrogati con brand id vuoto e il
selettore dei tag non si è mai visto. È una funzione rotta, non un problema di sicurezza, e
ripararla dentro una PR di sicurezza significa farle revertire insieme.
