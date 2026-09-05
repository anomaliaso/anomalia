# La pagina per pagare torna a esistere

`/app/[brand]/activate` e `/app/[brand]/upgrade` non erano state cancellate: non
sono **mai state importate**. Il commit fondativo di questo repository è la build
aperta già esportata, e `scripts/export-oss.mjs` elenca entrambe le cartelle fra
le esclusioni commerciali. Da allora ventisei file non-test ci puntano — nove
`throw redirect(303, …)` lato server, nove navigazioni client, i prompt degli
agenti — e ognuno di quei percorsi finiva in un 404.

I due peggiori erano `billingPortal` e `upgrade` in `settings-actions.ts`, sui
rami `no_customer` / `no_subscription`: esattamente chi non ha mai pagato.
L'altro era il bottone «Choose a plan» di `/app/billing`, l'unica offerta per
un'organizzazione senza abbonamento.

## Cosa è tornato, e cosa no

L'originale sta in `andreabuttarelli/021-app`. Non è un copia-incolla: il
repository è cambiato molto in otto giorni, e metà di quel file era già morto
prima di uscire di scena.

**Il ramo di setup non è tornato.** Nell'originale `load` restituiva
`setup: false` scritto a mano, quindi il blocco `{#if setup}` della pagina non si
apriva mai e nessuna form puntava a `syncAccounts`, `confirmPosts`,
`autoSchedule`, `skipSetup`, `setTimezone`. Con loro se ne vanno
`config.maxDuration = 1800`, la chiamata sincrona a `renderVideo`,
`publishApprovedPost`, `addUsage`, `ensureBrandProfile` / `syncBrandAccounts`. La
domanda «quella firma è ancora quella?» non si pone: quel codice non veniva
eseguito. Restano `load` e l'azione `checkout`.

**`meta-capi.ts` non è tornato.** È attribuzione pubblicitaria, non pagamento, e
la sua unica chiamata sulla strada dei soldi (`metaCapiPurchase`, attesa prima
del redirect post-checkout, più due letture Stripe per ricavare l'importo) è
proprio quella che non voglio lì: un `fetch` verso Meta senza timeout che ritarda
l'atterraggio di chi ha appena pagato. Il pixel del browser è ancora acceso
(`loadMetaPixel` nel layout radice) e la pagina continua a mandare
`CompleteRegistration` con lo stesso `eventID` di prima, quindi la metà server si
riaggiunge dopo senza toccare nient'altro. Purchase non era comunque mai stato
tracciato dal browser: questa PR non toglie un segnale che c'era.

**`upgrade/+server.ts` è stato riscritto, non riportato.** L'originale apriva una
sessione del portale Stripe **su GET**, con un price id esplicito. Questo
repository ha deciso il contrario due settimane fa — `workbench-paths.ts` lo
scrive: «un click in sidebar è navigazione, non consenso a pagare» — e ha spostato
i cambi di piano dentro il portale ospitato, dove i prezzi li configura Stripe.
La rotta ora instrada e basta: `/activate?plan=…` per un'organizzazione senza
abbonamento, `/app/billing` per una che già paga. Nessuna chiamata a Stripe.

## I price id tornano, e solo per il primo abbonamento

`createBillingPortalSession` prometteva che «l'app non nomina mai un price id».
Per i cambi di piano resta vero; per il **primo** abbonamento non può esserlo, il
portale cambia una sottoscrizione e non ne esiste ancora una. Quindi `PRICES`,
`priceFor`, `geoCouponFor`, `ensureBrandCustomer` e `createCheckoutSession`
tornano in `stripe.ts` — e il commento sopra al portale ora dice la verità.

`currencyForCountry` **non** è tornata: l'originale la duplicava «per tenere il
modulo server autosufficiente», e la stessa funzione sta già in `$lib/plans`, che
è pure quella che la pagina usa per mostrare i prezzi. Due copie della stessa
soglia eurozona divergono al primo cambio.

## Il test

`src/lib/billing/paywall-routes.test.ts` legge i sorgenti, raccoglie ogni
destinazione `/app/…/activate` e `/app/…/upgrade`, e pretende che la rotta esista
su disco. Su `origin/dev` falliva elencando i diciannove file che puntavano a
`activate` e i due che puntavano a `upgrade`. Una terza asserzione impedisce che
passi a vuoto: se la scansione si rompe e non trova più nessun riferimento, è
quella a fallire.

## Quello che resta aperto

- **La riconciliazione della fatturazione non c'è.** `billing-reconcile.ts` e il
  suo tick giornaliero sono un'altra esclusione mai importata. L'attivazione
  funziona lo stesso — la fa il trigger della migration 0007 su
  `stripe.subscriptions`, che è qui — ma nessuno verifica più il trigger, ed è
  proprio il buco che quel job era stato scritto per chiudere: un brand `starter`
  attivo con l'abbonamento cancellato da due mesi, scoperto a mano.
- **`igniteBrandTeam` non ha chiamanti.** Il suo commento nomina questo file
  («da chiamare da activate/+page.server.ts dopo la conferma del pagamento — UNA
  riga»). Aggiungerla è una riga, ma è un comportamento nuovo su un percorso che
  oggi nessuno percorre: merita di essere guardata da sola, non dentro la PR che
  ripara un 404.
- **I dodici price id non sono verificabili da qui.** L'account Stripe collegato a
  questa sessione (`leads.anomalia`) non è quello che li possiede. Vanno
  riconfermati sull'account giusto prima del merge.
