# I link dei media diventano corti e permanenti

Un'AI esterna ha generato un'immagine con `generate_image`, ha ricevuto il `signed_url` di
Supabase e l'ha passato all'utente. Il link ha risposto
`{"statusCode":"400","error":"InvalidJWT","message":"signature verification failed"}`.

Non era scaduto — un token scaduto dà un altro errore. Era **arrivato rotto**: quell'URL è lungo
~600 caratteri e si tronca dentro l'output di un agente. Sommati fanno tre modi di rompersi, tutti
già visti:

1. **scade** dopo 2 ore (`signKnowledgePaths`, TTL 7200s), anche se arriva intero;
2. **si tronca** in transito, ed è il caso sopra;
3. **non si sa cosa sia**: niente in quell'URL dice a un agente se sia consegnabile o no, quindi
   lo consegna comunque.

Ora esiste `GET /a/<code>`: cerca il media, firma la sua copia al momento e risponde 302. Il codice
è corto, non scade, e la sua sola presenza in una risposta significa "questo puoi darlo a qualcuno".

**Il codice è generato dal database, non da `insertBrandMedia`.** Sei punti inseriscono media, più
le righe nate fuori-banda prima che la tabella avesse un migration: un default più un trigger le
copre tutte senza toccare nessun chiamante, e il backfill delle righe esistenti è la stessa
espressione. Alfabeto di 32 simboli senza `0`/`O` e senza `1`/`I`/`L` — questi link vengono riletti
e ribattuti a mano — per 8 caratteri, cioè ~1.1e12 combinazioni. Dato che l'accesso è **pubblico
per chiunque abbia il link**, quella lunghezza *è* il confine di sicurezza, non un dettaglio
estetico: è ciò che separa uno scanner dall'asset di qualcun altro. Un test la blocca insieme
all'alfabeto, perché il generatore vive in SQL e il validatore in TypeScript e niente altro li
tiene d'accordo — è già successo con `shared_views.view_type`.

**Il redirect non è cacheabile (`no-store`), e non è pignoleria.** La destinazione muore in 2 ore,
il redirect no: un 302 cacheato sopravviverebbe al token che indica e servirebbe un link morto ore
dopo, sul browser di qualcun altro, senza niente nei nostri log.

**Cosa cambia e cosa no.** Il criterio non è "tutti i signed URL", è **cosa attraversa il confine
del sistema**: i tre contratti che un agente esterno, la CLI o l'API pubblica leggono
(`list_media`, `import_media_url`, `generate_media`/`generate_image`) restituiscono ora `url` al
posto di `signed_url`. Restano firmati i consumi interni — la pagina Media, il grounding dell'AI
dentro un turno, `agent-urls`, `ads-remix`, `manual-posting` — perché lì l'URL non transita da
nessuna parte e un salto in più sarebbe solo latenza.

Il campo è stato **rinominato**, non affiancato: lasciare `signed_url` accanto a `url` avrebbe
lasciato all'agente esattamente il link che non deve consegnare. Contratti e CLI cambiano nello
stesso commit, come vuole la convenzione del repo.

**Accettato anche `/a/<uuid>`.** I tool restituiscono da sempre `id`, quindi un agente può
comporre `/a/<id>` da sé; rifiutarlo romperebbe un link senza guadagnarci niente. Le due forme si
distinguono per forma, non con due route.

**Scartato:** lo streaming dei byte attraverso il nostro server. Nasconderebbe l'origine dello
storage e terrebbe l'URL finale stabile, ma ci farebbe pagare banda ed esecuzione su ogni immagine
per un problema che il redirect risolve.

**Fuori scope, ma da qui si vede:** `buildMonthlyReport` (`shared-views.ts:196-243`) congela dentro
`shared_views.snapshot` il `thumbnail_url` di `social_post_history`, che è un URL firmato del CDN
della piattaforma e scade in giorni. Lo snapshot invece è permanente per progetto: un cliente che
apre il link condiviso giorni dopo vede le miniature rotte. È di un'altra funzionalità, ma la cura
somiglia a questa.
