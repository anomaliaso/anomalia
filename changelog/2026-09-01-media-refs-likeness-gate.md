# Il consenso vale anche dalla porta del workbench

La #117 ha chiuso la **scrittura** del consenso: da API e CLI non si crea più una persona reale
senza attestare, e le righe importate dall'onboarding nascono `consent_source =
'import_unattested'`. Restava aperta la **lettura**.

`GET /app/:brand/media-refs` selezionava `id, name, role, images` — `consent` non c'era proprio.
Firmava le foto di *ogni* persona del brand e le restituiva al workbench, che le mette in
`referenceUrls`; `media-generator/+server.ts` accetta quegli URL come stringhe grezze e li passa
al job UGC. Il cancello — `resolvePeopleVisualRefsDetailed` — su quel percorso non veniva mai
chiamato. Risultato: una persona importata, che per costruzione non ha attestato nulla, era
selezionabile e renderizzabile dal workbench mentre la chat la rifiutava per nome. La stessa
regola diceva due cose diverse secondo la porta.

**Strada scelta: il cancello si applica dove i riferimenti nascono.** `media-refs` seleziona
`kind, consent` e trattiene chi non ha attestato: chi non esce non può essere rimandato indietro.

**Scartata: far ri-risolvere gli id al generatore.** È più robusta in astratto — non si fida del
client — ma `referenceUrls` è un campo generico che porta anche mood board, thumbnail di post e
foto prodotto, tutte cose senza id lato server. Renderlo fidato voleva dire un secondo canale
`people: [{id}]` piombato nel workbench, nel Motion Composer e nei parametri del job UGC: molto
più diff, e comunque inutile finché le altre porte firmano URL ungated (sotto). La difesa vera è
il chokepoint, non questo endpoint.

**La regola sta in un posto solo.** La condizione era scritta dentro
`resolvePeopleVisualRefsDetailed`; ora è `likenessConsented(subject)` in
`design-visual-refs.ts`, e la funzione di prima la chiama come la chiama `media-refs`. Nessuna
riscrittura del `kind === 'ai' || consent === true` altrove.

## Le altre porte, che restano aperte

Un giro su chi legge `people` e ne firma le immagini ha trovato **otto** bypass, sette oltre
questo. Sei arrivano davvero a un modello generativo:

1. `people.ts` `attachBrandPeople` — la pipeline di contenuto automatica (scheduler, radar,
   plan, generate, onboarding). Blast radius più grande di tutti: nessun umano nel giro.
2. `image-agent.ts:380` — catalogo asset dell'image agent → `resolveRefParts` → `generate`.
3. `ads-remix.ts:602` — remix di ad UGC, quindi **video**. L'unico filtro è `onlyOwnMediaUrls`,
   che è un cancello sui CDN esterni, non sul consenso.
4. `chat/lib/attachments.ts:106` — il picker "allega persone" della chat: `mintStandaloneImage`
   fa passare `people_ids` dal cancello e poi riceve `referenceUrls` ungated dalla porta di
   servizio.
5. `agent-urls.ts:107` e `chat/tools/read-tools.ts:683` — URL etichettati `reference` messi nel
   contesto del modello, che può rilanciarli in `create_post.image_urls` o
   `generate_image.reference_image_urls`.
6. `people.ts:283` `inferMissingPersonAttributes` — non è una reference di generazione, ma manda
   il volto reale a Gemini vision per dedurre genere ed età.

Il chokepoint vero è `signPersonImages`: otto chiamanti, uno solo controlla il consenso. Il
cancello vive un livello troppo in alto. Chiuderlo lì — la funzione prende la riga, non un
`PersonImage[]` nudo — è meno diff che rattoppare sei call site, ed è il seguito naturale di
questa PR. Qui si chiude solo `media-refs`, perché è quella che qualcuno ha notato.
