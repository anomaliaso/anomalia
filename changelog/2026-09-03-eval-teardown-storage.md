# La pulizia di un utente di eval guarda in ogni bucket, e a ogni profondità

`deleteEvalUser` cancellava lo Storage con una `list()` **piatta** su **un solo** bucket:

```ts
const { data: files } = await admin.storage.from('media').list(userId, { limit: 1000 });
const paths = files.map((f) => `${userId}/${f.name}`);
await admin.storage.from('media').remove(paths);
```

Sotto `media/<userId>/` non ci sono file: ci sono **cartelle**. Quella `list` restituisce
`library`, `chat`, `uploads` — e la `remove` che segue chiede a Supabase di cancellare
`<userId>/library`, che non è un oggetto e quindi non cancella niente. Non fallisce: risponde
`200` con una lista vuota. Ogni giro di eval che toccava un media lasciava i file in
**produzione**, e nessuno lo vedeva perché la pulizia non si lamentava mai.

Una verifica su produzione l'ha confermato dall'altro lato: un asset importato è rimasto a
`brand-knowledge/<userId>/<brandId>/media/import-<uuid>.png`, in un bucket che quella riga non
apriva nemmeno.

## Perché il test che c'era non poteva vederlo

Non c'era test. Ma il test facile da scrivere — «la pulizia è stata chiamata» — sarebbe passato
comunque: `remove()` viene invocata, con due percorsi, e risponde senza errori. L'unica
asserzione che vede il difetto è **quali percorsi** sono stati cancellati. Il rosso di questa PR
dice esattamente questo:

```
+   "media/<user>/chat"
+   "media/<user>/library"
-   "brand-knowledge/<user>/<brand>/artifacts/1-plan.md"
-   "brand-knowledge/<user>/<brand>/media/import-abc.png"
-   "media/<user>/chat/attachment.jpg"
-   "media/<user>/library/copy.png"
```

Due nomi di cartella al posto di quattro oggetti, e un bucket intero mai aperto.

## I bucket e le forme di percorso che un giro di eval può creare

I bucket del progetto sono sette. Solo due hanno il prefisso per utente, e non per convenzione:
è la policy di Storage a imporlo, `(storage.foldername(name))[1] = auth.uid()::text`
(`0004_content_plans_posts.sql` per `media`, `0021_brand_documents.sql` per `brand-knowledge`).

**`media/<userId>/…`** — `uploads/`, `library/`, `onboarding/`, `chat/`, `chat-refs/`,
`generated/`, `blog/`, `profile/`, `studio/`, `media-generator/`, `requests/`, `youtube-thumbs/`.

**`brand-knowledge/<userId>/<brandId>/…`** — `media/`, `mood/`, `people/`, `artifacts/`,
`onboarding/`, `chat-convert/`, `competitors/`, `competitors/ads/`, `market/`, `history/`, e
i documenti caricati dal browser direttamente sotto `<brandId>/`.

Gli altri cinque non sono per utente: `talent` (catalogo globale), `wall` (galleria pubblica,
chiave per piattaforma e post), `agent-docs` (`defaults/`, `overrides/`, `INDEX/` — globali),
`agent-homes` (`<brandId>/<timestamp>/`), `email-assets` (`trends/`).

## Quello che resta fuori, e si dice

Tre scritture su Storage sono indicizzate sul **brand**, non sull'utente, quindi nessuna pulizia
per prefisso utente può portarle via: `media/<brandId>/motion/*.mp4` (`motion-video/render-tools`),
`media/<brandId>/voiceover/*.wav` (`gemini-audio`) e `agent-homes/<brandId>/<ts>/`
(`checkpoint-storage`). Un eval che rendesse un video di motion o svegliasse un computer d'agente
le lascerebbe a terra. Sta a `destroyFixture`, che il brand ce l'ha — non a questa funzione, che
di proposito non sa cosa sia un brand.

## Perché non una lista di bucket scritta a mano

L'alternativa era `['media', 'brand-knowledge']`. È la stessa trappola un piano più in su: la
lista è giusta oggi e sbagliata al primo tipo di asset nuovo, in silenzio e senza che nessun test
possa accorgersene. `listBuckets()` toglie la lista: si guarda dentro **tutti** i bucket, sempre
sotto `<userId>/`, e un bucket che quel prefisso non ce l'ha costa una `list` vuota.

## La guardia, che è del codice e non della disciplina

Questa funzione cancella in produzione, quindi «cancella solo sotto il prefisso dell'utente» non
può restare una cosa da ricordare. `ownedBy(userId)` è l'unico punto da cui passa un percorso
prima della `remove`, e rifiuta tutto ciò che non ha `userId` come primo segmento o contiene un
`..`. Prima ancora, pretende che l'id sia un uuid: il caso che fa davvero danno è un id **vuoto**,
perché il prefisso diventa `/` e ogni oggetto del bucket lo soddisfa. Un test lo pinna — con id
vuoto non parte nemmeno una `list`.

## Rumorosa, non muta

La pulizia resta best effort: un eval non deve fallire perché è fallita la pulizia. Ma il
`.catch()` ora è `swallow(...)`, che scrive su stderr e manda a Sentry. Il silenzio è il motivo
per cui questi file si sono accumulati per mesi.

## Verifica

Statica e unit, di proposito: nessun eval è stato girato contro produzione: costa denaro vero e
crea righe vere. `scripts/eval/user.test.ts` è l'unica cosa che serve, perché quello che era
rotto è l'attraversamento, non la rete.
