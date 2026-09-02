# Il prodotto si apre dopo una call

Anomalia era self-serve: chi si registrava atterrava in dashboard. Da adesso l'accesso
si accende dopo una call di prodotto. Gli iscritti che c'erano prima entrano come sempre —
la chiusura vale dai nuovi.

## Perché non un gate nuovo

`can_enter()` esisteva già dal 0009 (`waitlist`), ed era già cablata in ~40 punti: ogni
endpoint di onboarding e di contenuto, `login`, `auth/callback`, `oauth/authorize`,
`reset-password`, il layout del brand, gli upload. Costruire una seconda porta accanto a
quella avrebbe significato tenerne allineate due, e dimenticare la nuova alla prossima
rotta. È cambiato **cosa significa** `can_enter()`, non dove sta.

## Perché un flag nuovo e non `waitlist`

Sembra la scorciatoia, ed è una trappola. `waitlist` non chiude solo l'app: `start-href.ts`
dirotta la CTA della landing su `/waitlist`, e `+layout.server.ts` riscrive le copy del
marketing in quattro lingue. Accenderlo avrebbe chiuso anche il funnel pubblico, che invece
deve restare aperto — è quello che porta gente alla call. `closed_beta` è un interruttore
diverso perché significa una cosa diversa: *waitlist* = non entra nessuno, *closed_beta* =
entra chi è approvato.

## Il predicato è uno solo, con due porte

`is_approved()` legge la sessione, `is_approved(uuid)` risponde per id. Serve entrambe:
la CLI e l'MCP arrivano con una chiave API su un client **service-role**, dove `auth.uid()`
è nullo — `can_enter()` così com'è li avrebbe bloccati sempre, e riscrivere la regola in
TypeScript accanto a quella in plpgsql l'avrebbe fatta divergere al primo cambio. La
versione per id è concessa al solo `service_role`: a `authenticated` permetterebbe di
chiedere se un'altra email è stata approvata.

## Tre buchi che non erano nel gate

1. **L'API era aperta.** `cli-auth.authenticate()` non chiamava `canEnter`: chiudere il
   browser e lasciare passare CLI e MCP non è chiudere il prodotto. La guardia sta ora
   all'unico passaggio che entrambe attraversano, non in sessanta rotte. Il 403 porta con
   sé il link alla call, perché la CLI stampa il corpo della risposta.
2. **Gli inviti si rompevano in silenzio.** `/app` controlla `can_enter` PRIMA di leggere
   gli inviti pendenti: un membro invitato da un cliente approvato è un utente nuovo, quindi
   non approvato, quindi sbattuto sulla pagina della call senza poter accettare niente.
   `is_approved()` riconosce l'invito pendente — con la stessa finestra di sette giorni di
   `accept_brand_invite`, o un invito scaduto lascerebbe un limbo permanente — e
   `accept_brand_invite` scrive `approved_at` all'accettazione: garantito da un cliente
   approvato, l'accesso non dipende più dalla riga che l'accettazione consuma.
3. **Chi aspettava non riceveva niente.** Il drip di lifecycle pende dai **brand**, e chi
   non è approvato non ne ha uno: si registrava, vedeva un calendario, non prenotava, e
   nessuno gli scriveva mai. Il sollecito vive dentro il tick che gira già ogni 10 minuti —
   nessun cron nuovo da pagare — e si deduplica su `waitlist.nudged_at`, che è già il
   registro di chi aspetta.

## Il fallback sta dalla parte meno cara

`flagEnabled(admin, 'closed_beta', false)`: una lettura del flag che fallisce lascia
entrare, non chiude fuori. È una porta commerciale, non un confine di sicurezza, e il costo
dei due lati non è lo stesso — chiudere fuori ogni cliente che paga per un RPC andato storto
è il guasto peggiore dei due.

## L'ordine del rollout non è negoziabile

1. migrazione applicata (colonna + backfill) — flag spento, niente cambia
2. codice in produzione — flag spento, niente cambia
3. verifica che gli esistenti abbiano `approved_at`
4. `closed_beta` → true

Invertire 1 e 2 chiude fuori ogni cliente attuale per la durata del deploy. Il flag vive in
`app_flags`: si riapre in SQL senza redeploy.

## Scartato

Un webhook Calendly che approva da solo alla prenotazione: approvare al `invitee.created`
chiude il prodotto dietro un click, non dietro una call. Se un giorno si automatizza, il
segnale giusto è `invitee.meeting_ended`.

Rinominare la rotta `/waitlist` in `/book`: quaranta redirect più le chiavi i18n in quattro
lingue, per un URL che l'utente vede una volta sola.
