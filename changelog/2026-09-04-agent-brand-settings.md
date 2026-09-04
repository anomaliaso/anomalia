# Come lavora il brand si cambia da fuori, con le conseguenze scritte

Secondo giro sulle impostazioni headless, dopo i modelli media. Quattro pagine di Settings che
erano quattro form separati diventano una coppia di tool: `get_brand_settings` e
`set_brand_settings`, su `GET`/`PUT /api/v1/brands/:slug/settings/brand`.

`tools/list` passa da **97 a 99**, additivo: `new: [get_brand_settings, set_brand_settings]`,
`gone: []`, `changed: []` sul confronto oggetto per oggetto.

## Un tool solo con quattro campi, non quattro tool

Fuso, piattaforme, hashtag ed esempi di voce vivono tutti sul brand e si cambiano spesso insieme.
Un `PUT` che tocca solo i campi nominati è la forma che `update_product` e `update_brand_kit` già
usano qui, e risparmia tre giri di rete a un agente che sistema il brand in una volta.

`destructive: false` per tutti e quattro, e non è una svista: nessuno di questi campi cancella
niente. Il punto è verificato sotto — un post già programmato non si sposta e non si annulla.

Fuori dalla scrittura la **lingua** dei post (`content_prefs.language`): la scrive già
`update_brand_kit`, e due scrittori per lo stesso campo sono una divergenza in attesa.

## Le due conseguenze, misurate e messe nella descrizione

Sono la ragione per cui questa PR ha richiesto di leggere il percorso di pubblicazione prima di
scrivere una riga.

**Il fuso non sposta i post che hanno già un orario.** `posts.scheduled_for` è un `timestamptz`
(`0004_content_plans_posts.sql`), cioè un istante assoluto. La conversione da orario locale a UTC
avviene **una volta sola**, alla scrittura della riga (`wallClockToUtc` / `nextOccurrence` in
`src/lib/server/schedule.ts`), e nessuno la ricalcola dopo — `setTimezone` fa un `update` su
`brands` e invalida la cache della nav, e basta. Cambiare fuso non muove niente in assoluto: muove
l'ora locale con cui quell'istante si legge. 18:00 a Roma = 16:00 UTC = 12:00 a New York.

**Togliere una piattaforma non annulla i post già programmati su di essa.**
`brands.target_platforms` è un ingresso di produzione — lo leggono `planner-inputs.ts` e
`scheduler.ts` per decidere per cosa scrivere i post NUOVI. `publish.ts` non lo legge affatto:
costruisce i bersagli da `post.platforms ?? [post.platform]` e l'unico cancello è un
`social_accounts` attivo.

Entrambe stanno nella `description` del tool, non solo nella doc. È l'unica cosa che un agente
legge prima di chiamare, e un agente che sposta il calendario di un cliente senza saperlo è
peggio di un tool che non esiste.

## La trappola che la lettura rende visibile

`target_platforms` **non** è validata contro gli account collegati — né dal form, né dal tool
della chat, né dall'onboarding. Si può bersagliare una piattaforma dove non c'è dove pubblicare: i
post vengono prodotti e restano in `approved` con `noAccount`, e nessuno lo dice.

Quindi `get_brand_settings` porta `connected_platforms` e la scrittura risponde con
`without_account`. Non è decorazione: è la differenza fra una configurazione sbagliata che si
scopre subito e una che si scopre quando manca un post.

Non ho aggiunto una validazione che RIFIUTA la piattaforma senza account: bersagliarla prima di
collegarla è un ordine di lavoro legittimo (l'onboarding fa esattamente così), e rifiutarlo
romperebbe il flusso normale. Dire che succede è la cosa giusta; impedirlo no.

## Il fuso ora si valida, e per tutti e due i chiamanti

`setTimezone` accettava **qualunque stringa non vuota**. Dal browser non poteva sbagliare — il
`<select>` offre quindici zone — ma la colonna decide l'ora locale di ogni slot futuro, e una
stringa che non è un fuso non fallisce al salvataggio: fallisce dopo, quando qualcosa prova a
calcolare un orario.

`isKnownTimezone` sta in `$lib/brand-fields.ts`, che esiste letteralmente per questo («chi scrive
uno di questi campi passa da qui, o sta introducendo la seconda versione della stessa regola»), e
la chiamano sia la rotta sia il form. Chiede a `Intl` invece di tenere un elenco: così gli alias
storici (`Asia/Calcutta`) restano validi e nessuno deve aggiornare una lista quando IANA ne
aggiunge una.

## I due elenchi di piattaforme

Stessa forma dei model slot: il contratto non può importare `$lib`, quindi `TARGET_PLATFORMS` vive
anche lì, e un test in `src/lib/platforms.test.ts` — il file che è già la legge del vocabolario
delle piattaforme — lo confronta con `PLATFORM_KEYS`. Visto fallire aggiungendo `myspace` al
contratto.

`twitter` non è nell'elenco di proposito: è un alias storico di `x`, e un tool che offre due nomi
per la stessa piattaforma insegna quello sbagliato.

## Una cosa che lo schema non poteva fare

`input` deve restare un `ZodObject` puro: la registrazione MCP ci aggiunge `slug` con `.extend`, e
un `.refine` (per "almeno un campo") lo trasformerebbe in qualcosa che `.extend` non ha — cioè un
crash a runtime su `tools/list`, non un errore di compilazione. Quindi il conteggio dei campi lo
fa la rotta, con `no_fields` dichiarato nel contratto. C'è un test che tiene ferma la proprietà.

## Cosa è stato visto rosso

- il contratto, prima che il file esistesse;
- `isKnownTimezone`, prima che esistesse (`ReferenceError`);
- la rotta: tolte la validazione del fuso, la guardia `no_fields`, la normalizzazione degli
  hashtag, la deduplica delle piattaforme e il calcolo di `without_account`, **cadono esattamente
  5 test su 17** e 12 restano verdi;
- il guardiano dei due elenchi di piattaforme, con `myspace` aggiunto al contratto.
