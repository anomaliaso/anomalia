# Le quattro famiglie di scrittura additiva, pesate una per una: ne collassa una

`docs/mcp-tools.md` §3 sconsigliava di collassare le scritture e `changelog/2026-09-05-writes-stay-separate.md`
ritirava il piano. **Quel verdetto era giusto per il motivo sbagliato**, e la distinzione decide
tutto: l'argomento forte — `destructiveHint` è un'annotazione per tool, e il protocollo non sa dire
«distruttivo solo quando `action = delete`» — morde solo una famiglia che **contiene** un verbo che
distrugge. Su 71 scritture le distruttive sono 13. Quattro famiglie non ne hanno nessuna, e lì il
primo argomento non dice niente.

Resta il secondo, che è vero e che qui si paga per intero: un modello sceglie dal **nome** e legge
l'enum solo **dopo** aver aperto il tool. Quindi il lavoro non era «collassare», era **pesare**: si
paga dove rende, non dove capita.

## I tre criteri, e la misura invece dell'intuizione

Una famiglia passa solo se supera tutti e tre:

1. **I fratelli tornano forme abbastanza simili da stare in un tipo solo?** Due scritture che
   tornano oggetti diversi non sono una famiglia: sono due tool con un prefisso in comune.
2. **Il nome di famiglia dice già cosa fa?** Se il nome unificato è più vago di quelli che
   sostituisce, il collasso costa e non rende.
3. **Un membro può fallire in un modo che gli altri non conoscono?** Allora non è un membro: chi
   chiama non può prevedere la risposta dal tool che ha aperto. È il criterio che tiene fuori
   `set_bio`, ed è quello che ha deciso tre famiglie su quattro.

Misurato sul registro, non supposto:

| famiglia | tool | forme di risposta diverse | fallimenti comuni a tutti | esito |
|---|---|---|---|---|
| identità | 5 | 4/5 | 0 | **collassata a 2** |
| media | 7 | 6/7 | 0 | separata, −1 doppione |
| impostazioni | 5 | 5/5 | 0 | separata |
| post | 7 | 7/7 | 0 | separata |

## L'identità del brand: quattro porte sulle stesse due righe

`update_brand_kit`, `update_voice`, `set_colors` e `set_appearance` scrivevano `brand_kit` e
`brands.content_prefs` — due righe, quattro tool. Le loro risposte sono `{ok}`, `{ok}`,
`{ok, colors}` e `{ok, appearance}`: lo stesso tipo più un'eco, che si fondono senza perdere
niente. Il nome unificato, `update_brand_identity`, non è più vago di `update_brand_kit` — che è
opaco: un «kit» cos'è? Nessuno dei quattro spende, chiama un modello o distrugge.

**E la divisione confondeva davvero, con una prova già scritta**: chi cercava «cambia i colori del
brand» apriva il tool che si chiama `set_appearance` e **non trovava nessun campo colore**, perché
la palette era in `set_colors`. Il 2026-09-05 la toppa era stata un rimando nella descrizione. Qui
il difetto non si rimanda: sparisce, perché non ci sono più due porte.

Cercando la stessa forma altrove ne è saltata fuori un'altra: i post passati che il generatore
imita sono `voice_examples`, e stanno su `set_brand_settings`, non su `update_voice`. Quella non si
ripara unendo — spezzerebbe `set_brand_settings` in due — quindi si ripara col rimando, che è
esattamente il trattamento che meritava.

**`set_bio` resta fuori**, ed è il criterio 3 al lavoro: scrive `social_accounts`, non il brand, e
risponde `No active social account` quando nessun account è collegato. Un fallimento che nessun
altro membro può produrre non appartiene alla famiglia.

## Media: si separano, ma la porta vecchia esce

`generate_image`, `generate_video`, `generate_carousel` e `refine_media` erano stati tenuti
separati con motivi misurati, e reggono: `generate_image` è l'**unico** che lavora senza brand
(`pathWithoutBrand`, e torna `id: null`, `storage_path`, `organization`, `cost_usd`);
`generate_video` non torna nemmeno un asset ma un `job_id`, e ha la finestra di durata per modello
con `duration_out_of_range` invece di un arrotondamento muto, perché una clip si paga al secondo;
`generate_carousel` pianifica la serie e torna i `continuity_tokens` che la tengono insieme.
`import_media_url` **non spende niente** mentre gli altri cinque spendono, e il segnale di costo
vive nel nome. Sei forme di risposta su sette, e ogni membro con un vocabolario di errori che
nessun altro conosce: `brand_style_needs_a_brand`, `no_refine_model`, `video_budget_exhausted`,
`not_https`. Un tipo solo qui vuol dire togliere a ognuno la promessa che mantiene.

Quello che invece esce è **`generate_media`**: la sua stessa descrizione diceva *«prefer
`generate_image` or `generate_video` … this one stays and keeps working, forwarding to those
two»*. Non collassa una famiglia in un enum — è il contrario, è una porta che si toglie da davanti
a due nomi migliori. Ogni suo campo (`prompt`, `count`, `aspect_ratio`, `model`, `title`) resta
raggiungibile, e un test lo verifica campo per campo. La rotta REST resta, dichiarata in
`REST_ONLY`.

## Impostazioni: cinque `set_*`, e i nomi SONO il discriminante

Cinque forme di risposta su cinque, e cinque vocabolari di errore disgiunti: `plan_required`,
`model_not_for_slot`, `unknown_locale`, `unknown_timezone`, `toggle_failed`. Ma la ragione dura è
un'altra, e si vede solo aprendo gli schemi: **`enabled` compare tre volte con tre significati
diversi** — accendere un lavoro ricorrente, accendere una piattaforma del Radar, mettere online il
blog pubblico. E il primo dei tre non è una preferenza: da quel momento il lavoro gira **da solo**
sulla sua cadenza e ogni giro spende i crediti del brand, con nessuno che guarda. Un modello che
sbaglia campo in un tool unico accende una spesa autonoma credendo di pubblicare un blog.

In più il nome unificato collide con un membro: `set_brand_settings` esiste già.

## Post: il collasso che sembrava ovvio nasconde un cambio di stato

Sette forme di risposta su sette, `reorder_slides` gratuito accanto a quattro che pagano un render,
e `regenerate_post_media` che **sostituisce** l'immagine che c'era.

Ma il fatto che chiude il discorso l'ha trovato la lettura dell'handler, non lo schema:
**`reschedule_post` non sposta soltanto l'ora.** `POST /posts/:id/reschedule` scrive
`status: 'approved'`, azzera `external_post_id` e `published_url` e richiama
`publishApprovedPost`. Rischedulare un post in `pending_user` lo **approva** e lo manda al
publisher. La sua descrizione dice *«It does not publish and does not approve»*, e `edit_post`
dice la stessa cosa — vera per lui. Fondere i due, che era il collasso più ovvio dei quattro (e
riparerebbe la trappola vera di `edit_post`: `slot` è il giorno di calendario, `scheduled_for`
l'istante di uscita), metterebbe un'approvazione dentro un tool che promette di non approvare.

**Il difetto non è stato corretto qui**: è un cambiamento di comportamento sulla pubblicazione, non
una correzione di contratto, e va deciso per conto suo. Sta scritto perché il prossimo che apre la
famiglia lo trovi già trovato.

## Come è costruita: una famiglia è un CAMPO che sceglie, non un verbo in un parametro

`packages/api-contracts/src/families.ts` è una tabella, e la differenza con un `*_action` è tutta
lì: nessun enum di verbi, quindi `destructiveHint` resta capace di dire la verità, e nessuna
capacità sparisce dentro un parametro. Il registrar chiama **solo** le rotte di cui il chiamante ha
nominato almeno un campo, in fila e non in parallelo — scrivono la stessa riga, e `set_appearance`
la rilegge per non perdere il font che non gli hai mandato. Le risposte si fondono; senza nessun
campo non tocca niente e lo dice.

`OWN_TOOL_ENDPOINTS` — il registro meno chi è in una famiglia — sta scritto in un posto solo,
perché lo leggono il registrar e i quattro test che confrontano `tools/list` col registro. Una
sottrazione ripetuta in cinque posti diverge al primo che qualcuno dimentica.

**Le rotte REST restano tutte**: qui esce il tool MCP, non l'endpoint. La CLI e WebMCP continuano a
leggere `BRAND_ENDPOINTS` e non cambiano.

## Il flag additivo, verificato invece che creduto

`docs/mcp-tool-review.md` §10 dice che 13 tool sostituiscono contenuto dichiarando
`destructive: false`, e `set_colors` è nella lista. Aperti gli handler: sostituisce la palette, che
è il campo che il chiamante ha nominato — non i campi che ha taciuto, che era il difetto di
`update_brand_kit` corretto in #387 (`KIT_COLUMNS.filter((c) => c in body)`, verificato). Additiva
per campo, tutte e quattro.

Un effetto che nessuna descrizione dichiarava: `update_voice` scrive `voiceMode = 'manual'` senza
che nessuno lo chieda. È il senso del tool — una modifica a mano spegne la voce automatica — ma
taceva. Ora lo dice la descrizione.

## Il conto, misurato sul transport

Da **88 tool / 94.215 caratteri** a **84 / 91.053**: −4 tool, −3.162 caratteri, e nessuna capacità
persa. Il tetto in `tool-surface-cost.test.ts` scende da 97.000 a 93.000, o smette di essere una
guardia. `MCP_INSTRUCTIONS` non è stato toccato: non nominava nessuno dei nomi ritirati, e il suo
budget di 1.700 caratteri si paga a ogni sessione.
