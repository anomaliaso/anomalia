# Un link "Sign in" separato dal CTA in homepage

La nav della landing aveva un solo link (`Get started`, verso `/app`): un utente
già registrato doveva passare dal CTA di onboarding per arrivare al login, e
niente in pagina distingueva "ho un account" da "voglio iniziare".

Aggiunto `header.nav a.nav-login` (`/login`), accanto al CTA esistente. Serviva
anche al flusso E2E di onboarding (`scripts/eval/ux/walk.ts`), che verifica
login e signup su un link dedicato invece di dedurli dal CTA — il cui `href`
dipende dal flag waitlist e non è un punto di ingresso stabile per il login.

`tests/e2e/landing.spec.ts` copre la struttura (un link `/login`, un `.nav-cta`
separato); l'assegnazione dell'href del CTA resta verificata contro lo stack
reale in `walk.ts`, non nella suite db-free.
