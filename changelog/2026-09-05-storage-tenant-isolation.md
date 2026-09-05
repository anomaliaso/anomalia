# Lo storage torna a essere del suo tenant, e la deriva che l'aveva aperto

Un red team, con un account autoregistrato, ha scritto un file da 20 MB **dentro la cartella di un
altro utente** sul bucket `media`, e ha fatto servire un SVG con dentro `<script>` da un URL
pubblico. Non c'era nessun bug nel codice: la policy che lo permetteva non è in nessuna migration.

`Allow authenticated uploads to media bucket` — INSERT, `authenticated`, `with check (bucket_id =
'media')`, nessuna condizione sulla cartella — è stata creata a mano dalla dashboard. Le policy
permissive si sommano in OR, quindi quella riga rendeva decorativa `media insert own folder` (0004),
che c'era dal primo giorno e non ha mai difeso niente: una policy permissiva può solo aggiungere
accesso, mai toglierlo. Stessa storia per il bucket `email-assets`, che esiste in produzione e in
nessun file: `npm run db:migrate` su un database pulito non ha mai prodotto lo schema che gira
davvero.

## Il censimento prima della policy, perché la cartella non è sempre l'utente

La tentazione era `(storage.foldername(name))[1] = auth.uid()::text` e via. Sarebbe stata
un'interruzione, non una fix: **due prefissi sono legittimi**, e ognuno è dimostrato due volte, dagli
oggetti in produzione e dal codice che li scrive.

- `${userId}/…` — upload della chat, cover e immagini inline del blog, avatar, logo di onboarding,
  still generati, thumbnail YouTube, clip di riferimento. 2 018 oggetti.
- `${brandId}/…` — motion video, voiceover, musica. 1 010 oggetti. E **non** è un cron: le rotte
  `app/[brand]/motion-video/+server.ts` e `.../render/+server.ts` passano `locals.supabase` dentro
  `render-tools.ts` e `gemini-audio.ts`, quindi la policy le vede. Una policy sul solo `auth.uid()`
  avrebbe spento il motion video il giorno stesso.

Un terzo caso — `${brandId}/onboarding/`, 920 oggetti, ancora scritti oggi — nasce da
`uploadPostImage(admin, brand.id, …)`: `scheduler.ts` e `articles.ts` passano un brand id nel
parametro che si chiama `userId`. Gira solo con la chiave di servizio, quindi la RLS non lo vede,
ma il nome mente e vale la pena saperlo.

La policy nuova chiede la seconda domanda con `auth_brand_ids()`, che è la funzione che il resto
dello schema usa già per «i brand su cui questo chiamante può agire» (`brand-knowledge read
shared`, 0090). Una domanda sola, scritta in un posto solo.

## I numeri sono misurati, non scelti

`media`: 3 089 oggetti, p50 647 kB, p99 8.4 MB, **max 44 MB** (un mp4 generato). I 12 MB di `wall`
avrebbero rifiutato i video: il limite è 64 MB, sopra l'oggetto più grande che esiste davvero.
`email-assets`: 864 oggetti, max 1.9 MB, e l'unico scrittore già rifiuta sopra i 2 MB — 5 MB è
margine, non un obiettivo.

## SVG: allowlist sul bucket, e il tipo lo decidiamo noi

Due strade. **Normalizzare il content-type in scrittura** avrebbe voluto dire toccare quindici punti
di upload e sperare che il sedicesimo si ricordasse: una regola sparsa in quindici file diverge al
primo cambiamento. **L'allowlist sul bucket** è invece un posto solo, la vede ogni scrittore —
compresi il browser che carica in diretta e i signed upload — e vale anche per la chiave di
servizio. Su `media` non c'è **nessun** SVG in produzione, quindi non si spegne niente di
legittimo; su `email-assets` ce n'è esattamente uno, ed è il bug: `trends/….jpg`, servito come
`image/svg+xml`, `owner_id` nullo — cioè raccolto da un sito esterno dal recap settimanale.

Storage non ha una denylist, quindi le immagini sono elencate una per una e video e audio restano
wildcard: così ogni contenitore che un telefono può produrre continua a passare senza doverlo
nominare.

Le due cose insieme non bastavano però, perché l'allowlist confronta **l'header intero**:
`image/png` in lista non ammette `image/png;charset=UTF-8`, e in produzione un oggetto così c'è. Da
qui la seconda metà: `weekly-recap.ts` non inoltra più il content-type del server remoto, lo
**nomina lui** a partire da una tabella di formati che sappiamo riservire. È anche la fix di
radice — il tipo di un file nostro non lo decide un sito che non controlliamo — e ha tolto due
ternari e una `startsWith` invece di aggiungere codice.

## Tassonomia del blog: quattro policy che nessuno leggeva

`blog_categories`, `blog_tags`, `blog_authors` e `brand_article_tags` avevano una `*_public_read`
con `USING (true)`: un client anonimo leggeva il `brand_id` di ogni brand che avesse mai creato un
tag, cioè l'elenco dei tenant. In cambio di niente, perché il blog pubblico non le usa: `blog-site.ts`
legge ogni pagina pubblica con la chiave di servizio, e lo dice nella sua prima riga. `brand_articles`
non è mai stato pubblico, quindi la tassonomia pendeva da righe che anon non poteva vedere comunque.

Scartata la restrizione a livello di colonna (lasciare `name`/`slug` e togliere `brand_id`): più
fragile, e risolve un problema che dopo il drop non esiste più. Le policy owner sono `FOR ALL` e
tengono i membri.

## `/a/<code>`: revoca sì, scadenza no

Qui il report chiedeva di legare il link alla membership. **Non l'ho fatto**, e vale la pena dirlo:
l'accesso pubblico di `/a/<code>` è una decisione presa il giorno prima e scritta in
`20260905090000_brand_media_short_code.sql` — «Andrea ha scelto l'accesso PUBBLICO». Ribaltarla di
nascosto dentro una PR di sicurezza sarebbe stato peggio del buco.

Quello che mancava davvero è ciò che `shared_views` ha e questo non aveva: **un modo di spegnere un
link senza distruggere l'asset**. Oggi l'unica revoca è cancellare il file, che lo toglie anche a
chi doveva tenerlo. `link_revoked_at` è la stessa risposta di `shared_views` — una riga che si
revoca, riletta a ogni richiesta invece che creduta una volta sola — meno la scadenza, che
romperebbe il motivo per cui il codice corto esiste.

Resta aperto: la revoca non ha ancora una superficie (niente UI, niente CLI), e togliere un membro
da un brand non revoca i link che ha già in mano.

## Il test che poteva fallire

La suite mocka Supabase: un insert finto accetta qualunque cosa e non vede una policy, un limite di
dimensione o una allowlist, perché nessuna delle tre vive nel nostro codice.
`scripts/storage-policy-harness.mjs` alza un Postgres vero, gotrue e **storage-api vero**, applica
tutte le migration, **ricrea a mano la deriva della dashboard** — senza quel passo misurerebbe un
database che la produzione non ha mai avuto — e poi rigioca le mosse del red team via HTTP.

Con `--skip-fix` fallisce in otto punti, e sono esattamente quelli del report. Ha anche trovato un
mio errore: il primo controllo «il proprietario legge ancora la sua tassonomia» passava grazie alla
policy che stavo togliendo, perché il seed non scriveva in `org_members`. Un test che passa per il
motivo sbagliato è il difetto che questo repository ha già pagato cinque volte.
