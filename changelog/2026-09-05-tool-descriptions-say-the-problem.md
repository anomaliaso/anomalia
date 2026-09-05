# Le descrizioni dei tool dicono il problema, non il nostro flusso

Tre sessioni vere sono fallite con lo strumento giusto nella lista.

«Puoi generare la img di un gatto?» → «non ho uno strumento di generazione immagini generico in
questa chat». Insistendo, l'agente ha ricontrollato e riconfermato; alla terza domanda ha ammesso
che si poteva, chiamandolo «sprecare una generazione». La descrizione diceva: *«Draw a NEW image
into the brand media library from a prompt, then pass the id it returns as media_ids on
create_post … BILLS A RENDER PER IMAGE (about 8 credits each…)»*. Tre àncore in tre frasi —
libreria di un brand, serve a fare un post, costa — e l'agente ha letto correttamente quello che
avevamo scritto.

Poi: un'immagine in libreria da rendere rossa, e l'agente ne ha disegnata una nuova con
`refine_image` nella stessa lista. E «puoi animarlo con un video di 5s?» → «l'animazione è esposta
solo per la copertina di un post», e ha rinunciato.

**La diagnosi è l'ordine, non il contenuto.** Ogni descrizione apriva sul contesto (dove atterra
l'asset, a cosa serve dopo, quanto costa) e seppelliva il verbo. Un agente cerca il *proprio*
problema nella lista, con le parole di chi gliel'ha chiesto.

## Le regole applicate qui

1. **Prima frase: il problema, con le parole dell'utente.** «To change a photo you already have —
   "make it red"» prima di `refine_image`.
2. **Non ancorare a un flusso che il tool non richiede.** «into the brand media library», «then
   pass to create_post» descrivono *un* uso e lo fanno sembrare *l'unico*. Restano, subordinati.
3. **Via le tariffe scritte a mano.** «about 8 credits each» è la frase che ha prodotto la parola
   *spreco*, ed era pure imprecisa. Si dice **che** costa, non **quanto**: il quanto lo misura la
   risposta (`renders`), non lo stima la descrizione. E si dice cosa **non** costa — un agente
   prudente evita ciò di cui non conosce il prezzo.
4. **Il tool fratello è nominato.** `refine_image` ↔ `generate_image`, `generate_video` ↔
   `make_video`. Due volte su tre l'agente si è arreso avendo la soluzione nella stessa lista.
5. **Cosa il tool NON fa**, quando è ciò che toglie la paura di provare: «creates nothing in the
   calendar», «publishes nothing», «needs NO post».

## `make_video` è descritto per quello che è

Genera *e* attacca: anima la copertina di un post che esiste già. È la ragione per cui l'agente
credeva che animare fosse lavoro da post. Ora lo dice, e manda a `generate_video` tutto il resto.
La sua rimozione resta una decisione separata, da prendere quando ci sarà un percorso senza post e
si vedrà se qualcuno lo chiama ancora.

## Il controllo che rende questo verificabile

`cli/skills/findability.test.ts` è una tabella: la richiesta arrivata in chat, il tool che doveva
risponderle, le parole che la descrizione deve contenere. Se non le contiene, l'agente non lo
trova — e il test è rosso. Rosso osservato prima della riscrittura: `refine_image` senza «photo»
né «red», `make_video` senza «post», e la tariffa di `refine_image`.

**Sta in `cli/skills/` e non nel pacchetto dei contratti perché controlla DUE superfici.** La
skill si legge prima dei contratti, quindi non sono «il lavoro e il suo allineamento»: sono due
prompt in concorrenza, e vince quello che l'agente incontra per primo. Il terzo fallimento lo
dimostra — `generate_video` conteneva già «animate», «photo» e «video», passava il test delle
parole prima che lo toccassi, e l'agente si è arreso lo stesso perché la skill diceva che
`make_video` «attaches a clip to an existing post». Riscrivere i soli contratti non avrebbe
corretto niente.

Estendendo il test alla skill sono usciti due buchi veri: la skill non conteneva la parola
«sound» (quindi «come deve suonare questo brand?» non portava a `get_voice`) né «ChatGPT» (quindi
«ci nominano gli assistenti?» non portava a `geo_action`). Due workflow in più in `SKILL.md`.

Altre due regole nella stessa tabella, e valgono su tutto il registry invece che su una lista:

- **niente tariffe scritte a mano** (`/\d+\s*credits?/`) — con UNA esenzione dichiarata,
  `generate_image`, la cui descrizione viaggia su un altro branch. L'esenzione si verifica da
  sola: il test pretende che la tariffa sia ancora lì, così quando quel branch atterra diventa
  rosso e chiede di cancellare la riga, invece di sopravvivere al motivo che la giustificava;
- **chi può restare senza crediti lo dice**, con le stesse parole (`spends credits`), ricavato da
  `credits_exhausted` fra i suoi rifiuti e non da un elenco a mano.

Il divieto vale sulle descrizioni e sulla prosa della skill — le superfici che un agente legge per
decidere — e **non** nel codice né nella storia: `content-cost.ts` documenta mediane misurate e i
changelog citano cifre perché quelle cifre SONO l'argomento di una decisione presa.

## Le descrizioni duplicate nei test sono sparite

`read-tools.test.ts` e `migrated-writes.test.ts` tenevano una copia testuale di ogni descrizione,
per provare che la migrazione al registry non aveva cambiato niente all'esterno. Quella prova
esiste già poco più sotto, automatica: `ogni endpoint del registry esiste in tools/list come lo
dichiara` legge la descrizione DAL registry, quindi non può invecchiare. La copia a mano invece
rendeva ogni riscrittura una modifica in due posti — e la prosa scritta in due posti diverge alla
prima riscrittura. Tolta la copia, resta la forma: titolo, campi, obbligatori, annotazioni.

Stesso motivo per due asserzioni che citavano una frase alla lettera (`Bills a render`, `no model
call, no credits`): ora chiedono il concetto, non la formulazione.

## Il perimetro effettivo

I ~114 tool del registry più gli 11 registrati a mano in `cli/mcp/tools/`. Non tutti riscritti da
zero: la regola applicata è quella del coordinatore — *una frase resta se toglie un errore
osservato, esce se sta lì per completezza*. I tool già scritti bene (`create_post`,
`set_automation`, `get_knowledge_status`, i due link Stripe, `query`) sono rimasti come erano. Le
riscritture vere sono le ~45 che erano etichette di categoria e non problemi: «Approve the
proposed editorial plan», «Run GEO citation audit or generate fix artifacts», «Delete a
competitor by UUID».

Via anche il nostro vocabolario: «studio», «kit», «autopilot», «rubric», «the operator», e
«Zernio» — il nome di un fornitore, che per chi legge non vuol dire niente.

## Coordinamento

`generate_image` non è qui: la sua descrizione va insieme al lavoro che rende `slug` opzionale
(altrimenti nasce un parametro opzionale che nessun agente sa quando lasciare vuoto), ed è tenuta
da quel branch. Il testo concordato gli è stato passato.

## Tool mal disegnati, non solo mal descritti

Elencati e non toccati, perché una descrizione migliore nasconderebbe il difetto:

1. **`make_video` genera e attacca.** È la ragione per cui un agente crede che animare sia lavoro
   da post. Ora lo dichiara e manda a `generate_video`; la rimozione è una decisione separata, da
   prendere quando esisterà un percorso senza post.
2. **`regenerate_post_media` e `refine_image` fanno la stessa cosa con esiti opposti** — la prima
   sostituisce l'immagine del post, la seconda deposita un asset nuovo e lascia intatto
   l'originale. Due nomi che non dicono quale distrugge cosa. Oggi si distinguono a parole, cioè
   nel posto più fragile.
3. **`ads_action` prende `action` come stringa libera**, non un enum, e non dichiara
   `credits_exhausted` fra i rifiuti pur avendo un `propose` che chiama il modello. O la rotta non
   passa dal cancello dei crediti, o il contratto mente su cosa può rifiutare.
4. **`generate_media` esiste solo per inoltrare** a `generate_image` e `generate_video`. Finché
   c'è, è un terzo nome per due lavori.

## La causa a monte: `instructions`, la terza superficie

Sopra le descrizioni e sopra la skill c'è `cli/mcp/server.ts`, il campo `instructions` del server:
il client lo mostra da solo al handshake di `initialize`, **una volta per sessione, prima di
tutto il resto**. Se una riga lì contraddice una descrizione, vince lei.

Conteneva questo:

> *«Always start with `list_brands` (or `whoami`) to learn brand slugs.»*

È un ordine, ed è stato eseguito alla lettera: l'agente chiamava `list_brands` per qualunque cosa
e poi sceglieva un brand a caso — crediti di un'organizzazione vera, libreria di un cliente vero.
Per un gatto. Le descrizioni che ho riscritto peggioravano una cosa che partiva già storta da qui.

Le vecchie istruzioni erano quattro dettagli di autenticazione e quell'ordine. Ora sono **la
mappa**, che è il mestiere di quel campo: come è organizzato il server, quando serve un brand e
quando no, cosa si legge con `query` quando nessun `get_*` risponde, cosa costa e cosa no. E la
regola in negativo, la stessa delle descrizioni: *ASK the person. Never call `list_brands` to pick
one yourself.* Restano corte — si pagano a ogni sessione, come `tools/list`, e il test tiene il
tetto a 1200 caratteri.

Andrea aveva chiesto se serve un tool «how to use»: non serve, questo campo è quello.

La stessa frase stava anche nella regola 1 della skill (*«Start with `list_brands` to learn
slugs»*) ed è corretta lì nello stesso commit — o l'agente legge due versioni e vince quella che
incontra per prima.

`findability.test.ts` copre ora tutte e tre le superfici. Il rosso osservato prima della
riscrittura è esattamente quello indicato: `/always[^.]*list_brands/i` trovava la frase. E
`http-app.test.ts` verifica che la mappa arrivi davvero dentro la risposta di `initialize`: una
costante giusta che il handshake non spedisce non la legge nessuno.

## Materiale per una decisione che non è mia: 45 letture accanto a `query`

Supabase espone 6-7 tool perché espone **un linguaggio** — `execute_sql` copre la coda infinita
delle letture. Noi ne esponiamo 125, di cui **45 sono letture** (34 `get_*` / `list_*`, più
`search_knowledge`, `check_media_job`, i due `diagnose_*`), accanto a `query`, che le tabelle le
legge già tutte.

Passandoci sopra una per una, ecco quali sarebbero esprimibili come una `query` e quali no. Non
tocco niente: è materiale, non una proposta.

**Esprimibili come `query` oggi** — una tabella, un filtro, niente che il modello non possa
scrivere: `list_posts`, `list_products`, `list_articles`, `list_ideas`, `list_shares`,
`list_web_audits`, `list_web_fixes`, `list_audit_citations`, `get_audit_findings`, `get_article`,
`get_calendar`, `get_bio`, `get_voice`, `get_gtm`, `get_plan`, `get_weekly_plan`, `get_keywords`,
`get_ranks`, `get_goals`, `get_market_field`, `get_memory`, `check_media_job`. **Ventidue.**

**Non esprimibili, e il motivo per ciascun gruppo:**

- **Coniano qualcosa che `query` non può coniare.** `list_media`, `get_post`, `get_appearance`:
  restituiscono un `signed_url` per uno storage privato (`brand-media.ts`, quattro
  `createSignedUrl`). `query` restituirebbe uno `storage_path`, che nessuno può aprire.
- **Escono in rete.** `get_gsc` (quattro `fetch` in `gsc.ts`, Google Search Console),
  `diagnose_radar` (interroga ogni sorgente dal vivo), `get_ads` e `list_social_accounts`
  (riconciliano con il provider — quest'ultimo da verificare, non l'ho confermato).
- **Calcolano, non leggono.** `search_knowledge` (recupero ibrido più un embedding),
  `get_knowledge_status` (conteggi di pipeline e aritmetica sui chunk), `get_analytics`,
  `get_dashboard` (compone sei letture), `get_creation_kit` (selezione e taglio su molte fonti),
  `diagnose_brand` (valuta i cancelli ciclo per ciclo), `get_seo` e `get_geo` (risolvono l'ultimo
  audit).
- **Leggono qualcosa che non è una tabella.** `get_writing_skills` (file su disco più righe del
  brand), `get_media_models` (catalogo del provider più la scelta del brand).
- **Applicano una regola che la riga nuda non porta.** `get_radar`, `get_blog_settings`,
  `get_brand_settings`, `get_automations`: tetti di piano, vocabolari ammessi, quali generi di
  sorgente il piano consente. La riga non lo dice; il tool sì.

Ventidue su quarantacinque, e nessuna delle ventidue restituisce oggi qualcosa che `query` non
possa. Che sia una buona idea toglierle è un'altra domanda — un `get_*` è una domanda che il
modello non deve saper formulare — ma il conto adesso c'è.
