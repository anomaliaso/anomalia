# Un agente esterno può riusare i media del brand

Seconda slice verticale della Fase 1 del piano [external agent](../docs/external-agent-plan.md),
dopo la creazione text-only. `create_post` accetta `media_ids`, e `list_media` dice quali id
esistono.

## Cosa sbloccava

Senza media, `create_post` rifiutava `instagram` e `tiktok` in blocco — le due piattaforme dove
un post di solo testo non esiste — e `youtube` sempre. Un agente esterno poteva scrivere solo
per LinkedIn e X.

## Il downgrade silenzioso

`resolveMediaUrls` saltava in silenzio ogni media che non riusciva a risolvere:

```ts
if ('publicUrl' in copied && copied.publicUrl) urls.push(copied.publicUrl);
```

Un id di un altro brand, o una copia fallita, non erano un errore: erano un post **senza
immagine**. Su LinkedIn nasceva una bozza text-only che nessuno aveva chiesto; su Instagram
usciva `need_media`, che sembrava colpa di chi aveva chiamato mentre il media c'era ed era stato
scartato da noi. È esattamente il «silent downgrade to text-only» che il piano vieta.

Ora la regola è una sola e sta in un posto solo: **un media che il chiamante ha indicato e che non
si risolve ferma la creazione**. Vale per gli id di libreria e per i percorsi di upload, perché
sono lo stesso caso — un identificativo che il chiamante ha dato e noi non onoriamo.

Questo cambia anche la UI di manual posting: un percorso fuori dagli upload dell'utente ora è un
errore invece di un post muto. Non dovrebbe capitare in uso normale (i percorsi li produce
l'upload stesso), e quando capita è meglio dirlo.

## La proprietà, chiesta all'adapter

`findBrandMediaByIds` risponde quali id sono davvero di quel brand. Il servizio confronta con
quelli chiesti: chi manca è di un altro brand o non esiste, e **la differenza fra i due non viene
detta** — distinguerle sarebbe un modo per sondare gli id altrui.

Il `kind` della riga decide anche come si pubblica: un video di libreria adesso soddisfa
`youtube`, che prima nessun percorso esterno poteva raggiungere.

## Il registry alla prova

`list_media` è il primo endpoint aggiunto *dopo* il registry, ed è servito a misurarlo: una riga
in `BRAND_ENDPOINTS` più la route, e il metodo del client e il tool MCP sono comparsi da soli.
Nessun blocco `registerTool` scritto a mano, nessun tipo ricopiato in `cli/lib/api.ts`.

Il tetto di 8 media resta un taglio silenzioso: la UI non limita i file selezionati, quindi
trasformarlo in errore romperebbe a distanza chi ne carica nove. Resta com'era.

> **Correzione — vedi `2026-09-03-media-failure-is-ours.md`.** La frase sopra vale solo per il
> manual posting dalla UI, dove `resolveMediaUrls` taglia a 8 in silenzio. Sul contratto esterno
> non c'è nessun taglio: `media_ids` porta `.max(8)` in zod, quindi il nono id fa fallire tutta
> la richiesta con `invalid_input` prima ancora di arrivare al servizio. Due percorsi, due
> comportamenti: uno tronca, l'altro rifiuta.

## Fuori da questo giro

`import_media_url` — la slice 4 — ha una superficie di sicurezza sua (reti private, redirect,
MIME, dimensione) e merita una PR che la si possa leggere da sola.
