# Il primo post nasce prima del login

Su ~100 iscrizioni esterne solo 7 hanno pubblicato qualcosa, e l'86% non è mai tornato dopo il
giorno dell'iscrizione. Il visitatore doveva registrarsi per vedere se il prodotto sa fare il suo
mestiere: pagava tutto il prezzo (email, password, fiducia) prima di ricevere qualunque prova.

Adesso l'artefatto arriva **prima** del login. Dal solo indirizzo del sito, `/start` produce **un**
post — didascalia e immagine — e lo mette davanti al visitatore. Il login serve a salvarlo e a
vederne altri, non a scoprire se ne vale la pena.

## Uno, non tre

Tre post moltiplicano per tre la probabilità che uno sia brutto, e un post brutto conferma il
pregiudizio «AI slop» che il visitatore ha già. Se ne genera **uno**, e si spende su quello.

## Niente nel percorso critico

Nessuna fase torna nel wizard: `people`, `strategy` e `plan` restano fuori (erano già fuori dal
3 agosto — nessun brand ha `onboarding_completed_at` da allora, e il piano editoriale lo produce
il team dalla dashboard: 7 brand su 12 nella settimana del 24 agosto). Lo studio di mercato e il
piano continuano a nascere in chat, dove già nascono. Qui si sposta **prima** del login un
artefatto che prima non esisteva affatto.

## Perché non è il percorso durevole dei job

`plan_posts` e `preview_images` girano su `onboarding_step_jobs`, che ha `user_id` NOT NULL ed è
drenato da un cron. Un visitatore anonimo non ha `user_id`, e un cron nuovo era escluso in
partenza. Quindi il percorso ospite è **una sola richiesta in streaming** — lo stesso schema NDJSON
con keepalive che `analyze/+server.ts` usa già — dentro il `maxDuration: 300` della piattaforma.
Nessuna tabella nuova, nessun worker, nessun cron.

## Adozione, non rigenerazione

Chi si registra ritrova **esattamente** il post che ha visto: l'immagine è già su Storage sotto un
prefisso `guest/<uuid>/`, e `guestPostRow` la adotta come riga `posts` del brand vero
(`source: 'guest_preview'`, `status: 'pending_user'`). Non si rigenera niente: un secondo giro
darebbe un post diverso da quello che ha convinto la persona a iscriversi, che è il modo più
sicuro di sprecare la conversione appena ottenuta.

## I limiti, che qui sono la parte seria

Un endpoint pubblico che fa `runBrandAnalysis` su un URL qualunque è, senza guardie, un
fetch-anything-as-a-service che spende soldi veri per chiunque lo chiami. Tre difese, tutte da
codice che esisteva già:

- **Rate limit per IP**: `guardTool('guest-preview', ip)` — la stessa guardia dei tool pubblici
  `/api/tools`, con la tabella `tool_usage` e la RPC `bump_tool_usage` già in produzione dalla
  migration 0125. Nessuna migration nuova. Cap `{ perIp: 3, globalPerDay: 200, costPerRun: 0.08 }`:
  il tetto di spesa giornaliero è `globalPerDay × costPerRun`, ~$16.
- **SSRF**: `isUrlSafe` di `brand-analysis.ts` (già usata dentro `fetchPage`) richiamata **al
  confine pubblico**, così la guardia è visibile nel percorso che la rende necessaria.
- **Interruttore**: `isGuestPreviewEnabled()` — `FEATURE_GUEST_PREVIEW=false` spegne tutto senza un
  deploy di codice. Default acceso, convenzione kill-switch del file.

Il modello immagine è forzato al più economico disponibile (`NANO_BANANA_2_LITE`) attraverso una
nuova opzione `imageModel` di `RenderPreviewOpts`: il percorso ospite lo passa, tutti gli altri
chiamanti restano identici. Serviva plumbing perché `renderPreviewImages` sceglieva il modello da
sé, e riusarla intera (ancoraggio al brand, logo, palette, critico QC) è ciò che tiene il post
lontano dall'essere brutto — che è il punto.

Nota sui crediti: `renderPostImage` passa da `gateCredits(getBrandContext())`, e un ospite non ha
brand context, quindi **nessun gate crediti lo ferma**. È esattamente per questo che il cap per IP
non è opzionale.

## Cosa si è deciso di non fare

- **Socials espliciti pre-login**: tolti da `/start`, che ora mostra il post. Non sono persi —
  l'analisi del sito li rileva da sola e il brief di setup (passo 2) li fa cercare, salvare e
  confermare in chat. Uno step post-login esplicito e opzionale non è in questa PR: tocca la metà
  morta del wizard, la cui rimozione il proprietario ha deciso di trattare a parte.
- **Pulizia delle immagini orfane**: un visitatore che non si registra lascia un'immagine sotto
  `guest/`. Ripulirle vorrebbe dire un cron, che era escluso. Il rate limit è ciò che tiene il
  volume basso; il costo è dichiarato, non nascosto.
