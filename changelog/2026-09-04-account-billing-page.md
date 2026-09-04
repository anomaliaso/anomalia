# La fatturazione lascia il brand e diventa una pagina dell'account

Un abbonamento copre l'intera organizzazione (mappa #183), ma la pagina che lo mostrava viveva
sotto `/app/<brand>/settings/billing`: un brand qualsiasi dei suoi, scelto dall'URL, raccontava il
piano e il credito di tutti gli altri. Con il pool condiviso quella pagina risponde alla domanda
sbagliata — «quanto ha questo brand» invece di «quanto ha l'account, e chi lo sta spendendo».

`/app/billing` è la pagina vera: piano dell'org, pool con il periodo, e una tabella per brand con i
crediti consumati nel periodo dell'org. Sta sotto `/app` accanto a `/app/api-keys`, l'unico
precedente di pagina d'account già presente, e non in un nuovo albero `/account` che avrebbe
richiesto layout e auth propri. La vecchia rotta resta e fa `redirect(308)`: i link salvati, la voce
nella nav delle impostazioni, `UpgradeLink` e l'`upgradeUrl` del provider continuano a funzionare
senza toccarne nessuno.

**Le action stanno sulla pagina nuova, non su quella vecchia.** Il primo tentativo le lasciava dove
erano, sfruttando il fatto che un POST raggiunge una action anche se il GET della stessa rotta
redirige. Funziona per il caso felice e rompe l'unico che conta: quando `billingPortal` o `upgrade`
tornano `fail()`, SvelteKit ri-esegue il `load` della rotta a cui hai postato — che redirige — e il
messaggio d'errore sparisce per strada. Ora `/app/billing` ha le proprie action, che sono le stesse
funzioni di `settings-actions.ts` invocate con `params.brand` sostituito dallo slug del brand che
porta la subscription: nessuna logica di billing duplicata, e l'errore resta visibile.

Quale brand: quello con `stripe_subscription_id` **e** un piano pagante, altrimenti il primo. La
stessa regola che usa `resolveOrgBilling` in `credits.ts`, e per la stessa ragione — durante il
rollout org-per-org l'org non migrata non ha ancora le proprie colonne, mentre il suo brand pagante
sì. Prendere `brands[0]` avrebbe agito sul fratello free.

**Scartato:** riusare `resolveOrgBilling` per risolvere anche lo slug. Restituisce quota e periodo,
non gli id Stripe né lo slug, e allargarlo qui avrebbe fatto pagare a un helper di crediti una
domanda di routing. Le due letture andranno unite quando #212 (`org-billing.ts`) sarà in `dev`.

**Scartato:** cancellare la rotta vecchia. Il redirect costa nove righe e tiene in piedi quattro
punti che linkano ancora lì, incluso `anomalia-provider.upgradeUrl`, che il ticket #187 aveva
deciso di lasciare invariato proprio in attesa di questa pagina.

Il `+page.svelte` del brand resta come stub: SvelteKit vuole un file di pagina perché la rotta
esista, ma non viene mai reso.

**Non verificato nel browser.** Il gate del CLAUDE.md chiede stack locale e login reale: i
container ci sono, ma le credenziali del kong locale non stanno nel repo (`.env` punta al Supabase
hosted, `.env.local` ha solo un token Vercel, `infra/compose/.env` non esiste) e la pagina legge
`organizations.plan`, che arriva con la migration di #202 e in locale non è applicata. Puntare
l'app all'istanza hosted sarebbe stata la scorciatoia che il gate vieta. Restano i cinque test del
`load` e delle action, tre dei quali confermati per mutazione.
