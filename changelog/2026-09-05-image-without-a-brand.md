# generate_image senza un brand, e la descrizione che lo dice

Andrea ha collegato l'MCP a Claude e ha chiesto «puoi generare la img di un
gatto?». L'agente ha risposto di non avere uno strumento di generazione
immagini. Insistendo ha ricontrollato e ha confermato. Alla terza domanda ha
ammesso che tecnicamente si può, «solo che la salva nella libreria media di un
brand specifico e consuma crediti», e ha chiamato quel gatto uno **spreco**.

L'agente non ha sbagliato: ha letto quello che avevamo scritto.

> Draw a NEW image **into the brand media library** from a prompt, then pass the
> id it returns as media_ids on **create_post** … **BILLS A RENDER PER IMAGE
> (about 8 credits each…)**

Tre àncore in tre frasi — la libreria di un brand, il post da fare, il costo — e
un generatore perfettamente funzionante descritto in modo che nessun agente lo
usi per generare un'immagine.

## Due difetti, e il secondo non si risolve col primo

`slug` era obbligatorio per costruzione: ogni endpoint del registro vive sotto
`/api/v1/brands/:slug/…`, e `BRAND_ENDPOINTS` lo inietta a tutti. Ma renderlo
opzionale non basta. Un parametro opzionale che la descrizione non spiega viene
riempito lo stesso — e Andrea ha osservato agenti chiamare `list_brands` e poi
**scegliere un brand a caso**, cioè spendere i crediti di un'organizzazione vera
e sporcare la libreria di un cliente vero. Nella sua sessione un gatto poteva
finire addebitato a qualcuno.

Quindi le due cose insieme, o la prima non si vede.

## I due buchi nei pagamenti che la modifica ingenua avrebbe aperto

**Il cancello dei crediti.** `renderPostImage` è il chokepoint: le immagini sono
~66% della spesa AI e la quota si applica lì perché un loop qualunque si fermi
invece di bruciare per giorni. Leggeva `getBrandContext()`, e il commento
accanto lo diceva: *«Senza brand context non c'è gate.»* Togliere lo slug alla
lettera significava lasciare il punto più caro del prodotto senza controllo.

**La somma dell'organizzazione.** `sum_org_ai_cost_usd` faceva
`join brands on b.id = c.brand_id`: una riga con `brand_id` nullo contribuiva
**zero** alla spesa di ogni organizzazione. Il cancello sarebbe passato per
sempre, le generazioni senza brand sarebbero state gratis in permanenza, e la
suite sarebbe rimasta verde — il database finto non somma niente.

Il primo si vede da TypeScript, il secondo no. Il secondo lo chiude la migration
`20260905100000_ai_calls_org_id` (colonna `org_id`, left join, coalesce), che va
applicata **prima** di questo codice: qui i deploy non eseguono le migration.

## Le tre decisioni

**Chi paga**: l'organizzazione risolta da `ensureOrgForUser` — pagante prima,
poi la più vecchia. È la stessa regola deterministica che decide dove atterra un
brand nuovo, quindi un utente con più organizzazioni ottiene sempre la stessa. E
la risposta la **nomina**: rifiutare quando l'utente ne possiede più d'una
sarebbe stato più cauto sulla carta, ma è la risposta che nomina
l'organizzazione a rendere impossibile il silenzio.

**Dove finisce l'asset**: da nessuna parte. Nessuna riga in `brand_media`, e non
per prudenza: tutte e quattro le policy di quella tabella (`0149`) dicono
`brand_id in (select auth_brand_ids())`, e `NULL in (…)` vale `NULL`, non
`true` — una riga senza brand sarebbe **invisibile a tutti** e nemmeno
inseribile. I byte vanno in storage sotto lo user, dove le policy guardano solo
il **primo** segmento del percorso, e tornano `id: null`, il percorso e una firma
che scade in due ore.

**La migration prima, non insieme.** Vedi sopra.

## Il costo, detto dopo invece che stimato prima

«about 8 credits each» era una tariffa scritta a mano: invecchia, e intanto
produce la parola *spreco*. `billedUsdInScope` (PR #352) permette a una rotta di
leggere la propria fattura, ma il deposito stava in `takeLlmCost`, che la
**ritira** — e ritirarla non dice che una riga la porti: su `ok: false`
`computeCostUsd` scarta il flat cost, quindi un turno fallito lasciava leggibile
un costo che `ai_calls` non ha mai scritto. Il deposito si è spostato in
`logAiCall`, l'unico chiamante di `takeLlmCost` e l'unico posto che conosce il
prezzo vero della riga; e ora registra anche un flat cost che non viene dal
gateway, cioè il render di un'immagine, fatturato dal fornitore e loggato sotto
`openrouter`. Da lì `cost_usd` nella risposta.

## Cosa si è scartato

**Rendere `brand_media.brand_id` nullable**: la trappola RLS sopra.

**Un secondo registro di endpoint senza brand**: `pathWithoutBrand` è un campo
opzionale sullo stesso contratto, non una famiglia parallela. Un endpoint che
non lo dichiara rifiuta una chiamata senza slug invece di costruire in silenzio
`/brands//…` e scoprirlo con un 404 illeggibile molto più tardi.

**Un gate che salta il billing provider**: `gateOrgCredits` passa dallo stesso
provider di `gateCredits`, o un fork self-hosted — che di fatturazione non ne ha
— si troverebbe contato proprio sulla strada nuova. E condivide la cache del
cancello, già chiavata sull'organizzazione: una generazione con brand e una
senza leggono lo stesso saldo invece di pagarsi due copie degli stessi numeri.

**Lasciare passare una chiave API ristretta a certi brand**: dove nessun brand si
nomina non c'è niente da confrontare, e lasciarla passare allargherebbe in
silenzio una restrizione che l'utente ha scelto. `brand_scoped_key`, 403.

## Quello che non è cambiato, ed è metà del test

Con lo `slug`, tutto come prima: `imageModelFor(content_prefs)` governa ancora il
modello, `withBrandContext(brand.id)` avvolge ancora il render, l'asset entra
ancora in libreria con un id da passare a `create_post`, e uno slug che esiste ma
non è dell'utente resta **404** — `loadBrandForUser` risponde così apposta,
perché una chiave non deve poter sondare quali slug esistono. Rendere opzionale
un parametro è il modo classico di far sparire in silenzio quello che quel
parametro portava, quindi quei quattro fatti hanno un test ciascuno.

## Una cosa che il codice non fa, e che nessuna descrizione deve promettere

`runImageJob` passa solo `{model, refineModel, baseImage, aspectRatio}`: niente
`visualStyle`, `brandLook`, `visualPlaybook`, `logoImage`. **Il look del brand
non raggiunge `generate_image`**, né con slug né senza. La descrizione lo dice in
negativo — «nothing about a brand's look reaches the model, so name the style you
want» — invece di lasciarlo intendere.
