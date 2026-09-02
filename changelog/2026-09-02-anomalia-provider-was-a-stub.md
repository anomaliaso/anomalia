# anomalia-provider.ts non chiamava più gateCreditsCore

`src/lib/server/billing/anomalia-provider.ts` era `throw new Error('not available in the
open build')` fin dal primo commit di questo repo (`5ae5049`, l'import della build
self-hostable). `billingProvider()` (`src/lib/server/billing/index.ts`) intercetta quel throw
in un `try/catch` muto e ricade su `openBillingProvider` — `gate()` che non lancia mai,
`quota()` sempre `Infinity`. `gateCredits()`, l'unico chokepoint chiamato dai 29 call site
(17 diretti + 12 via `gateAiAction`), delega interamente a `billingProvider().gate(...)`: senza
un provider `anomalia` reale, nessuno chiamava mai `gateCreditsCore` — la vera applicazione dei
limiti, rimasta intatta e inutilizzata in `credits.ts:269-294`.

Confermato non essere un meccanismo di sostituzione a build/deploy time: nessuna dipendenza
privata in `package.json`, nessun `.npmrc`, nessun alias Vite/SvelteKit, nessuno script che scrive
il file, un solo commit su tutta la storia git (`git log --all`). `anomaliaso/anomalia` è il repo
pubblico da cui Vercel deploya in produzione (confermato via `vercel env ls` + Vercel API); nessuna
fork privata che sostituisca questo file esiste oggi, in nessun posto verificabile.

`anomalia-provider.ts` ora esporta un `anomaliaBillingProvider` reale: `gate('credits', ...)`
chiama `gateCreditsCore`, `quota()` legge `creditQuota`/`postQuota` da `credits.ts`/`plans.ts`,
`plansAbove`/`isTopPlan` delegano a `plans.ts`, `upgradeUrl` punta a
`/app/<slug>/settings/billing`. Nessuna di queste funzioni è stata riscritta: erano già lì,
pubbliche, semplicemente non collegate a niente.

**Scartato:** aspettare l'estrazione fisica in un pacchetto npm privato ("split 2b", già
menzionato nel changelog di agosto sul billing-come-plugin) prima di ripristinare il gating. I
numeri reali (quote per piano, formula crediti) sono già pubblici in `credits.ts`/`plans.ts`: non
c'è una seconda fuga di dati a tenerli anche nel file di collante. Il buco nel gating è urgente,
l'estrazione in pacchetto privato no.

Test aggiunti prima del fix, osservati falliti (rosso) sullo stub esistente, poi verdi:
`src/lib/server/billing/anomalia-provider.test.ts` (nuovo), più un caso in
`src/lib/server/billing/index.test.ts` che prova che `billingProvider()` sceglie il provider
`anomalia` quando il modulo non lancia più.
