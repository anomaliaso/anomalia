# Le tre funzioni che scaricano un URL remoto passano dalla stessa guardia

`storeBrandLogoFromUrl`, `archiveImageToBucket` e `archiveMarketMedia` scaricavano un URL e lo
depositavano ciascuna a modo suo. Tutte e tre con lo stesso identico difetto in tre punti, e la
prima raggiungibile davvero: **l'URL del logo lo sceglie un modello** (`set_brand_logo`), quindi
un contenuto ostile che il modello legge — una pagina, un documento, un post — può dettarlo. Non
è un difetto teorico in attesa di un attaccante: la superficie è già collegata all'ingresso.

## I tre buchi, che erano lo stesso buco

1. **Il nome invece dell'indirizzo.** `isUrlSafe` confronta *pattern di hostname*. Un nome
   pubblico il cui record DNS punta su `127.0.0.1` o su `169.254.169.254` lo supera senza storie,
   perché la stringa è innocua: è la risposta del resolver a non esserlo.
2. **Il redirect non ricontrollato.** `fetch` seguiva i redirect da solo. Un URL pubblico che
   risponde `302 Location:` arriva dove vuole — una rete privata, il metadata service — e la
   guardia aveva già detto sì all'unico URL che ha guardato. Il metadata service non si raggiunge
   digitandolo: si raggiunge facendosi rispondere da qualcosa che sembra innocuo.
3. **Il corpo bufferizzato prima di essere misurato.** `await res.arrayBuffer()` porta in memoria
   *tutto*, poi si controlla la dimensione. Il tetto c'era e non serviva a niente: la memoria è
   già finita quando lo si applica. Il test che lo dimostra conta i pezzi che il lettore tira —
   prima ne chiedeva 400 (100MB) su un tetto di 5MB.

Nessuna guardia nuova è stata scritta. `tool-guard.ts` aveva già `safeFetchBytes`, con
resolve-then-check su **ogni** hop e il tetto applicato *mentre* il corpo arriva, con rifiuto e
non troncamento. Il lavoro è stato portarci sopra i tre chiamanti, non riscriverlo: due copie di
una guardia SSRF sono due guardie che divergono, e la seconda diverge in silenzio.

## Lo schema è un parametro, non un `if` nel chiamante

`media-import` pretendeva https su ogni hop e se lo implementava in casa (`assertImportableHop`),
passato alla guardia come `gate`. Un gate iniettabile è un buco travestito da estensibilità: il
prossimo chiamante ne scrive un altro leggermente diverso. Ora la latitudine dello schema è un
argomento — `scheme: 'https-only' | 'http-or-https'` — che la guardia applica **dentro** il ciclo
dei redirect, dove serve: un chiamante che pretende https e controlla solo l'URL che gli hanno
dato consegna comunque il file in chiaro al primo `302` che scende a http.

## Cosa è stato deciso di NON stringere, e perché

I tre chiamanti migrati **continuano ad accettare http**. È una scelta, non una dimenticanza:

- il logo di onboarding arriva dal sito del brand, e `packages/site-analysis` accetta
  esplicitamente `http://` — rifiutarlo qui romperebbe l'onboarding dei brand ancora in chiaro;
- le CDN delle piattaforme servono ancora link in chiaro, e un archivio che smette di funzionare
  non fallisce: restituisce `null` e tiene l'URL che marcisce, cioè non lo scopre nessuno.

Il buco si chiude comunque, perché a chiuderlo è la risoluzione dell'indirizzo, non lo schema.
`media-import` resta `https-only`: lì l'ingresso è un agente esterno e non c'è niente di
preesistente da rompere.

## Comportamento che cambia davvero

- **`archiveMarketMedia`** ha una ragione di fallimento in più, `blocked_host`, distinta da
  `bad_url`: "l'URL era malformato" e "l'URL puntava dove non andiamo" chiedono correzioni
  diverse, e la ragione finisce nel log del run.
- **Tutti e tre** ora rifiutano un host che non risolve, un redirect oltre i 4 hop, e un corpo
  oltre il tetto *durante* la lettura invece che dopo.
- Lo **User-Agent** degli archiviatori (`Mozilla/5.0 (compatible; AnomaliaArchive/1.0)`) è
  passato alla guardia come parametro invece di essere sostituito con quello dei tool. Una CDN
  che non riconosce chi chiede risponde 403, e un 403 qui è indistinguibile dal link scaduto che
  questo archivio esiste per battere.

## `isUrlSafe` resta, e non è una svista

Ha una trentina di chiamanti (`design-render`, `create-content-tools`, `youtube-thumbnail`,
`prepublish-check`, `demo-account`, `website-capture`, …) e vive in `packages/site-analysis`.
Cancellarlo qui sarebbe stato un secondo PR travestito da pulizia. Molti di quei punti passano
l'URL a un renderer di terze parti invece di scaricarlo loro, che è un rischio diverso; alcuni
però scaricano davvero, e restano da portare sulla guardia — in particolare
`catalog-tools.ts:516`, che passa ad `archiveImageToBucket` un URL scelto da un modello e ora è
coperto solo perché la funzione a valle è stata migrata.

## Due fixture che raccontavano una risposta impossibile

`brand-studio-tools.test.ts` sostituiva `fetch` con un oggetto a mano il cui `headers.get()`
rispondeva `'image/png'` a **qualsiasi** header — `location` e `content-length` compresi — e che
non aveva corpo a stream. Con la guardia vera quel finto diventa una risposta che nessun server
manderebbe mai. Sostituito con una `Response` vera. Il suo URL di prova, `https://cdn.example`,
non esiste: con la risoluzione dell'indirizzo il rifiuto sarebbe arrivato dal DNS invece che dalla
proprietà sotto esame, quindi ora è un indirizzo scritto per esteso — `dns.lookup` lo restituisce
senza interrogare nessuno.
