# Revisione dei tool MCP che restano

Questo documento risponde a una domanda sola: **i tool che sopravvivono all'aggregazione, sono
fatti bene?** Non è l'inventario e non è il piano di fusione — quelli stanno in
[`docs/mcp-tools.md`](mcp-tools.md), che si rigenera dal registro. Questo è scritto a mano, porta
le prove riga per riga, e si rilegge quando cambia il comportamento, non quando cambia il conteggio.

**Perché due file e non uno.** `docs/mcp-tools.md` dichiara sé stesso generato dal registro
(«rigenerarlo è uno script, non un lavoro») e porta il commit da cui è stato estratto. Una
revisione con giudizi e prove non si rigenera: se vivesse lì, la prossima estrazione o la cancella
o costringe lo script a imparare a preservarla. E i due non si sovrappongono, perché questo **non
ripete il censimento**: per quanti tool esistono, come si dividono e quali si fondono, la fonte
resta l'altro. Qui c'è solo quello che l'altro non può dire.

> Il collegamento reciproco da `docs/mcp-tools.md` **non è stato aggiunto di proposito**: le sue
> §3 e §4 sono in mano a un altro agente mentre questo viene scritto. Va aggiunto quando #383
> atterra.

---

## Riepilogo

**115 tool analizzati.** Misurati con `tools/list` attraverso il transport vero su `dev@d21c818e`:
**126 esposti**, meno i 4 media in ritiro e i 7 che escono con #383 — non ancora mergiata quando
questo è stato misurato; dopo, il server ne espone 119, e 119 − 4 = 115.

| gravità | quanti | cosa sono |
|---|---|---|
| **Critica** | 5 | un tool la cui funzione principale è irraggiungibile; spesa reale non protetta e non dichiarata; tre tool che dichiarano un successo mai avvenuto o distruggono dati che avevano promesso di non toccare |
| **Alta** | 3 | parametri che si sbagliano in silenzio, e un ramo che non guarda il proprio esito |
| **Media** | 4 | annotazioni che dicono il falso, riferimenti a tool che stanno per sparire |
| **Bassa** | 3 | coppie confondibili, un parametro morto, rotte orfane |

### Le tre cose da fare per prime

1. **L'audit SEO non si può eseguire dal MCP.** Lo schema di `seo_action` impone
   `action ∈ {run, plan, more, asset, article}`; l'handler riconosce `'audit'`, non `'run'`.
   L'intersezione è vuota: **nessuna chiamata valida secondo lo schema raggiunge l'audit.**
   [§1](#1-laudit-seo-è-irraggiungibile-lenum-e-lhandler-non-si-incontrano)
2. **`ads_action` ha un'azione che nessuno ha scritto: `approve`** — l'unica che manda in onda una
   campagna. La descrizione ne elenca nove, l'handler ne accetta dieci. **Serve un coordinamento
   immediato con #383**, che sta trasformando quel campo in un enum: costruito dai nove nomi
   scritti, `approve` diventerebbe irraggiungibile e le campagne non partirebbero più.
   [§2](#2-ads_action-lazione-che-lancia-le-campagne-non-è-scritta-da-nessuna-parte)
3. **Quindici tool spendono soldi veri fuori dalla regola dichiarata**: cinque senza alcun
   cancello sul saldo (quattro dei quali accettano anche una chiave API di sola lettura), nove che
   spendono dicendo «No model, no credits» — fra cui `approve_post`, `approve_posts` e
   `publish_post` — e uno che dice di spendere e non spende.
   [§3](#3-la-regola-sui-crediti-è-scritta-nellhandshake-e-quindici-tool-non-la-rispettano)

### Quello che invece è in ordine, misurato e non supposto

Vale la pena dirlo, perché è la maggior parte:

- **Nessun tool morto.** 115 su 115 puntano a una rotta che esiste ed esporta il metodo dichiarato.
- **Nessuna annotazione `readOnlyHint` che mente.** Nessuno dei 40 tool di sola lettura del
  registro scrive dentro il proprio `GET`, e nessun cancello sui crediti sta in un `GET`
  (verificato **per metodo**, non per file: un `GET` e un `POST` convivono spesso nello stesso
  `+server.ts`, e contare per file dà un falso positivo).
- **Il precedente dello `slug` opzionale è chiuso.** Fra i 115 rimasti nessuno ha `slug` opzionale.
- **Il trasporto non mente.** `request()` alza su ogni risposta non-2xx (`cli/lib/api.ts:28-31`):
  nessuno dei 107 tool del registro può inventarsi un successo per conto proprio. Tutti i difetti
  gravi stanno negli handler.
- **Le descrizioni sono di qualità alta**, e la domanda 2 la passano quasi tutte: la maggioranza
  delle coppie vicine si nomina a vicenda e dichiara il proprio costo. I difetti della §11 sono
  danni collaterali di un ritiro, non un problema di scrittura.

---

## Come è stato misurato

L'elenco viene da `tools/list` **attraverso `handleMcpFetch`**, non da un grep dei sorgenti: un
`initialize` e poi un `tools/list`, come in `cli/mcp/http-app.test.ts`.

```
initialize + tools/list via handleMcpFetch (dev@d21c818e) → 126 tool
  115 dal registro dei contratti (packages/api-contracts/src/, BRAND_ENDPOINTS)
   11 registrati a mano       (cli/mcp/tools/)
  47 readOnlyHint · 18 destructiveHint · 392 parametri (slug e id inclusi)
```

Gli handler sono stati letti, non dedotti. Dove c'è scritto che un tool ha un difetto c'è il file e
la riga; in due casi c'è l'output di un'esecuzione.

**Due errori di metodo evitati, che vale la pena lasciare scritti.** Una prima lettura degli schemi
cercava l'enum al livello sbagliato (`platforms.enum` invece di `platforms.items.enum`) e faceva
sembrare senza enum anche i due tool che ce l'hanno: la §8 dice quali sono davvero. E una prima
ricerca dei cancelli sui crediti contava per file invece che per metodo, marcando come «a
pagamento» ogni `GET` che condivide il `+server.ts` con un `POST` gated.

### I numeri di `docs/mcp-tools.md` sono invecchiati

Quel documento porta `d099e02a` e dice **127 tool, 116 nel registro, 247 parametri, 45 letture**.
Oggi lo stesso registro misura **115 tool, 241 parametri, 44 letture**, 126 in tutto: dal commit
citato è uscito un tool di lettura. Il conteggio dei distruttivi (13) è ancora esatto perché
contava solo il registro. Non è un difetto: è la prova che va rigenerato.

---

# I difetti, dal peggiore

## 1. L'audit SEO è irraggiungibile: l'enum e l'handler non si incontrano

**Gravità: critica.** Non è un difetto di descrizione: è una funzione del prodotto che dal MCP non
si può chiamare.

Lo schema dichiara cinque azioni, e `action` è obbligatorio:

`packages/api-contracts/src/search.ts:17`
```ts
      action: z.enum(['run', 'plan', 'more', 'asset', 'article']),
```

L'handler ne riconosce cinque, ma la prima ha un altro nome:

`src/routes/api/v1/brands/[slug]/seo/+server.ts:37-43, 83`
```ts
  const { action = 'audit', initiativeId, guidance } = await request.json().catch(() => ({})) as ...
  ...
    if (action === 'audit') {
  ...
    return json({ error: `Unknown action: ${action}` }, { status: 400 });
```

`run` non compare in nessun ramo: cade fino in fondo e torna `400 Unknown action: run`. E l'unico
modo di raggiungere l'audit sarebbe `action: 'audit'`, che l'enum rifiuta, oppure omettere `action`
per prendere il default — ma lo schema lo dichiara obbligatorio. **L'intersezione fra ciò che lo
schema permette e ciò che l'handler accetta non contiene l'audit.**

Due aggravanti. La prima: la descrizione del tool descrive `run` come *«audits the website's
technical health»*, quindi un modello che segue la documentazione alla lettera fallisce sempre. La
seconda: il cancello sui crediti sta **prima** del dispatch (`:34-35`), quindi ogni tentativo
consuma comunque una verifica di saldo prima di essere rifiutato.

È il gemello della §2, con la simmetria invertita: là un'azione esiste e non è documentata, qui
un'azione è documentata e non esiste.

---

## 2. `ads_action`: l'azione che lancia le campagne non è scritta da nessuna parte

**Gravità: critica, e urgente per il coordinamento.**

> Che `action` debba diventare un enum è già deciso e in lavorazione con #383: **non è questa la
> segnalazione.** La segnalazione è che l'elenco da cui l'enum verrà costruito è incompleto, e
> costruirlo dai nomi scritti oggi introdurrebbe una regressione.

Misurato confrontando la prosa della descrizione con i `case` dell'handler:

```
nella descrizione : create, delete, duplicate, pause, propose, reject, resume, sync, toggle   (9)
nell'handler      : approve, create, delete, duplicate, pause, propose, reject, resume, sync, toggle  (10)
MANCANTE          : approve
```

`packages/api-contracts/src/ads.ts:45-50` elenca nove verbi. `approve` non compare mai — eppure due
righe dopo la stessa descrizione dice *«`duplicate` makes a paused copy as a new proposal —
**approving it** is what launches it»*: spiega che bisogna approvare e non dice come si chiama
l'azione. E `approve` è l'unico ramo che manda davvero in onda una campagna, l'unico che
restituisce `zernioAdId` (`src/routes/api/v1/brands/[slug]/ads/+server.ts:87-95`).

Oggi il campo è `z.string().min(1)` (`ads.ts:55`), quindi indovinare `"approve"` funziona. **Con un
enum costruito sui nove nomi documentati smetterebbe di funzionare**, e non ci sarebbe più alcun
modo di lanciare una campagna dal MCP. L'enum va scritto dai dieci `case`, non dalla prosa — ed è
esattamente il difetto che la §1 mostra già realizzato su `seo_action`.

Nella stessa firma, `campaignId` ed `extra` non hanno descrizione utile, ed `extra`
(`z.record(z.string(), z.unknown())`, `ads.ts:57`) è l'unico canale per `goal`, `budgetAmount`,
`campaignType`, `adId`, `next`. `goal` è un'unione chiusa di dieci valori
(`src/lib/server/zernio-ads.ts:39-49`) che viene solo castata a runtime — `body.goal as AdGoal`
(`ads/+server.ts:92`) — senza validazione: un modello che scrive `goal: "brand_awareness"` lo vede
inoltrato tale e quale alla piattaforma pubblicitaria.

---

## 3. La regola sui crediti è scritta nell'handshake, e quindici tool non la rispettano

**Gravità: critica.** Non è documentazione: sono soldi che escono senza controllo, e in quattro
casi anche un'autorizzazione mancante.

La regola la dichiara il server stesso, in una riga che ogni sessione legge prima di qualunque
descrizione (`cli/mcp/server.ts:20`):

> *«Whatever spends the brand's credits says so in its own description; everything else is free.»*

Il cancello che la fa rispettare è `gateAiAction` (`src/lib/server/cli-auth.ts:229-244`): controlla
i permessi della chiave, poi il saldo, e restituisce `402 credits_exhausted`. Cercandolo **per
metodo HTTP** su tutte le rotte, e risalendo le catene di chiamata, i tool che spendono davvero
sono 29. Quindici sono fuori regola, in tre modi diversi.

### 3a. Cinque spendono e non c'è nessun cancello

| tool | rotta | modello che chiama | `gateAiAction` | `checkApiKeyWriteAccess` |
|---|---|---|---|---|
| `propose_plan` | `editorial-plan/propose/+server.ts` | `proposeFirstPlan` (`:14`) | **assente** | **assente** |
| `plan_week` | `weekly-plan/plan/+server.ts` | `planWeekStrategy` (`:126`) | **assente** | **assente** |
| `replan_week` | `editorial-plan/replan-week/+server.ts` | `replanWeek` (`:31`) | **assente** | **assente** |
| `revise_plan` | `editorial-plan/revise/+server.ts` | `revisePlan` (import `:5`) | **assente** | **assente** |
| `generate_person` | `studio/people/+server.ts` | `generateAiPersonImages` (`:27`) | **assente** | presente (`:12`) |

L'handler più corto lo mostra per intero — non c'è altro in mezzo:

`src/routes/api/v1/brands/[slug]/editorial-plan/propose/+server.ts:6-19`
```ts
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  try {
    const result = await proposeFirstPlan(supabase, brand, null);
    return json({ ok: true, plan_id: result.id });
```

Due conseguenze distinte. *Il saldo*: un brand senza piano a pagamento, o coi crediti finiti, li
chiama quante volte vuole; il `402` non arriva mai. *La chiave*, più seria:
`checkApiKeyWriteAccess` (`cli-auth.ts:217-223`) è ciò che impedisce a una chiave `anomalia_` di
sola lettura di scrivere, e quattro di questi cinque non lo chiamano. **Una chiave dichiarata
read-only può proporre un piano editoriale, pianificare una settimana, ripianificarla e
revisionarla** — tutte operazioni che scrivono e che costano.

`generate_person` è il più caro per chiamata: disegna tre volte, una base più una per posa
(`src/lib/server/people.ts:106-133`, `const POSES = [...]` di due elementi). E se la base non esce,
la funzione torna `[]` (`:118`), la persona viene inserita comunque con `images: images ?? []`
(`studio/people/+server.ts:40`) e la rotta risponde `{ok: true, person}` (`:48`): il tool promette
*«the face is drawn»* e consegna una persona senza volto, senza dirlo.

### 3b. Nove spendono dicendo di essere gratis

| tool | cosa spende | prova | cosa dichiara |
|---|---|---|---|
| `approve_post` | verdetto LLM pre-pubblicazione, quando l'orario cade nella finestra di lancio | `src/lib/server/publish.ts:293-296` → `src/lib/server/prepublish-check.ts:269` (`llmStructured`, con immagini) | *«No model, no credits»* |
| `approve_posts` | lo stesso, per ogni post della coda | idem | *«No model, no credits»* |
| `publish_post` | lo stesso | idem | *«No model, no credits»* |
| `add_note` | `rebuildBrandContext`, sempre | `studio/documents/+server.ts:42` → `src/lib/server/brand-context.ts:186,250` (`aiText`) | *«No model, no credits»* |
| `update_brand_kit` | idem, ogni chiamata | `studio/kit/+server.ts:43` → stessa catena | *«No model, no credits»* |
| `delete_document` | idem | `studio/documents/[id]/+server.ts:36` → stessa catena | tace |
| `sync_history` | idem, quando `synced > 0`; **più** il fornitore esterno a consumo `scrapecreators` (`studio/history/sync/+server.ts:16`) | `studio/history/sync/+server.ts:23` | tace |
| `edit_post` | `learnFromCaptionEdit`, fire-and-forget, quando cambia la didascalia di un post nato dal piano | `src/lib/server/post-editing.ts:209` → `src/lib/server/brand-memory.ts:767` (`structured`) | *«No model, no credits»* |
| `search_knowledge` | un embedding della domanda quando le parole chiave non bastano — registrato in `ai_calls` e quindi conteggiato | `src/lib/server/llm.ts:420-427`, tariffato in `src/lib/server/ai-log.ts:257`, sommato in `src/lib/server/credits.ts:246-296` | *«no credits are spent»*, esplicito |

I tre più usati del prodotto — approvare e pubblicare un post — sono in questa tabella. E quattro
degli altri spendono per la stessa ragione: `rebuildBrandContext` chiama `aiText` due volte
(`brand-context.ts:186` e `:250`) ed è invocata da ogni scrittura sullo studio.

### 3c. Uno dice di spendere e non spende

`ads_action` con `propose`: la descrizione dice *«`propose` has the AI draft new ads»*, ma la
funzione è deterministica — ranking sui dati più templating, e il commento nel codice lo dichiara
(*«does NOT spend»*, `src/lib/server/ads.ts:314`); in tutto `ads.ts` non c'è una chiamata a
`aiText` o `structured`. Nello stesso tool, invece, **quattro altri rami spendono e la descrizione
non lo dice**: `approve` (`ads.ts:596`, `:747`), `resume` (`:978`, `:997`), `toggle` verso attivo
(`:1051-1052`) e `sync` (`:1228`, `:1241`). Non è inferenza di modello ma una commissione sul
budget pubblicitario, e attinge — lo dichiara `src/lib/server/ads-credits.ts:7-12` — *«the same
balance as AI generation»*.

**Il quadro d'insieme.** Il cancello è applicato rotta per rotta invece che in un punto solo: non
sta nel livello LLM condiviso (`src/lib/server/ai-text.ts`, `research.ts`), quindi ogni nuova rotta
che chiama un modello parte scoperta e resta scoperta finché qualcuno non si ricorda di aggiungere
la riga. È lo stesso schema che CLAUDE.md chiama «una regola scritta in cinque posti diverge al
primo cambiamento»: qui è scritta in ventinove, e ne mancano quindici.

---

## 4. `approve_plan` dichiara attivato un piano che può essere rimasto proposto

**Gravità: critica.** È il difetto della classe `logout`, sul tool che se lo può permettere meno —
l'unico della famiglia piani annotato `destructive: true`.

`activatePlan` esegue due `update`, non legge l'errore di nessuno dei due, e costruisce la risposta
dall'oggetto che aveva già in memoria invece che da ciò che è stato scritto:

`src/lib/server/editorial-plan.ts:965-977`
```ts
  // Supersede whatever is active first — the partial unique index allows only one 'active' row.
  await supabase
    .from('editorial_plans')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('brand_id', brandId).eq('status', 'active').neq('id', planId);
  await supabase
    .from('editorial_plans')
    .update({ status: 'active', weeks, activated_at: ..., updated_at: ... })
    .eq('id', planId);
  const activated = { ...plan, weeks, status: 'active' };
```

La rotta scarta perfino quel valore di ritorno, aggiunge una terza scrittura non controllata, e
risponde:

`src/routes/api/v1/brands/[slug]/editorial-plan/approve/+server.ts:29-41`
```ts
    await activatePlan(supabase, brand.id, proposed.id, brand.timezone as string);
    if (oldActive) {
      await supabase.from('editorial_plans').update({ status: 'superseded' }).eq('id', oldActive.id);
    }
    await syncPrefsFromPlan(supabase, brand.id, proposed);
    return json({ ok: true });
```

**Il fallimento è raggiungibile, non teorico**, e il commento nel codice nomina da sé il vincolo che
lo produce — che esiste davvero:

`supabase/migrations/0034_editorial_plans.sql:33`
```sql
create unique index editorial_plans_active_uniq on public.editorial_plans (brand_id) where status = 'active';
```

Se il primo `update` non manda in `superseded` il piano attivo, il secondo viola l'indice unico e
fallisce. L'errore non viene letto. Il tool risponde `ok: true`, il brand continua a seguire il
piano vecchio, e l'agente riferisce alla persona che il nuovo è attivo — mentre la descrizione
promette *«Make the proposed editorial plan the one this brand actually follows»*.

**Secondo problema, stessa rotta.** `activatePlan` normalizza il piano e timbra l'inizio delle
settimane (`stampWeekStarts`), ma la rotta butta via quel risultato e passa a `syncPrefsFromPlan`
la riga **grezza** `proposed`: le preferenze del brand vengono sincronizzate da un oggetto diverso
da quello attivato.

---

## 5. `update_brand_kit` cancella i campi che non gli mandi, e promette il contrario

**Gravità: critica.** Perdita di dati silenziosa, su un tool annotato `destructive: false`.

La descrizione (`packages/api-contracts/src/studio.ts:260-262`):

> *Change what this brand IS: what it does, its category, who it speaks to, its style, its
> language. These are the facts every generated post is written from, so a wrong one is wrong
> everywhere. **Only the fields you send change.** No model, no credits.*

L'handler fa un `upsert` con tutte e quattro le colonne forzate a `null` quando non arrivano:

`src/routes/api/v1/brands/[slug]/studio/kit/+server.ts:20-27`
```ts
  const { error: kitError } = await supabase
    .from('brand_kit')
    .upsert({
      brand_id: brand.id,
      about: about ?? null,
      category: category ?? null,
      target_audience: target_audience ?? null,
      brand_style: brand_style ?? null,
    }, { onConflict: 'brand_id' });
```

**Provato, non dedotto.** Eseguito l'handler con `{ about: 'Torrefazione a Trieste' }`, catturando
il payload che arriva a `upsert`:

```
UPSERT PAYLOAD: {"brand_id":"brand-1","about":"Torrefazione a Trieste",
                 "category":null,"target_audience":null,"brand_style":null}
```

Tre colonne azzerate che il chiamante non ha nominato. Un agente che segue la descrizione alla
lettera — «mando solo il campo che cambio» — svuota categoria, pubblico e stile del brand, e riceve
`{ok: true}`.

Nella stessa esecuzione è emerso il secondo difetto: la scrittura della lingua non viene
controllata. Con `{ language: 'it' }` e l'`update` su `brands` che fallisce, la rotta risponde
comunque **HTTP 200** (`kit/+server.ts:33-38`): l'`upsert` sopra è controllato, questo no.

**Che sia un caso isolato e non lo stile della casa, lo dimostrano i vicini.** Ogni altro tool che
fa la stessa promessa la mantiene:

| tool | file | come |
|---|---|---|
| `edit_post` | `posts/[id]/+server.ts:28` | `for (const f of FIELDS) if (body[f] !== undefined) updates[f] = body[f];` |
| `update_voice` | `voice/update/+server.ts:25-46` | un `if (x !== undefined)` per campo |
| `set_brand_settings` | `settings/brand/+server.ts:93-98` | patch con spread condizionale |
| `set_appearance` | `studio/appearance/+server.ts:114-115` | `input.display_font ?? current.display_font ?? null` — ricade sul corrente |
| `update_competitor`, `update_product`, `update_person` | `src/lib/server/brand-rows.ts` | patch condiviso, che controlla anche `data?.length` |

Esiste perfino un test che difende esattamente questa proprietà — ma per i prodotti:
`src/routes/api/v1/brands/[slug]/products/[id]/server.edit.test.ts:54`, *«scrive solo il campo
passato, non un patch con tutte le colonne»*. Per `brand_kit` non c'è: **nessun test copre
`PUT /studio/kit`**.

---

## 6. `render_post` fa pagare il render, fallisce, e risponde `ok: true`

**Gravità: alta.**

`src/routes/api/v1/brands/[slug]/posts/[id]/render/+server.ts:108`
```ts
      return json({ ok: true, url: updated?.media_url ?? null, error: updated?.media_url ? null : renderError });
```

L'endpoint è gated: i crediti sono già stati spesi quando si arriva qui. Se il renderer non produce
l'immagine, `renderError` viene valorizzato (`:98`, `'no image produced'`), `url` resta `null` — e
`ok` resta `true`, con HTTP 200. Il livello MCP avvolge la risposta con `ok()`
(`cli/mcp/util.ts:13-24`), che **non** marca `isError`: un modello che guarda `ok` legge un
successo, ha pagato, e non ha l'immagine.

La verità è nei campi fratelli, quindi è recuperabile — ma il contratto che il tool espone è `ok`,
e `ok` mente.

---

## 7. `ads_action` con `reject` è l'unico ramo dello switch che non guarda il proprio esito

**Gravità: alta.**

`src/routes/api/v1/brands/[slug]/ads/+server.ts:97-100`
```ts
    case 'reject': {
      await rejectCampaign(supabase, brand.id, String(body.campaignId ?? ''));
      return json({ ok: true });
    }
```

`src/lib/server/ads.ts:803-814` — la funzione ritorna `void` e non legge l'errore:
```ts
export async function rejectCampaign(
  supabase: SupabaseClient, brandId: string, campaignId: string
): Promise<void> {
  await supabase
    .from('ad_campaigns')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', campaignId).eq('brand_id', brandId).eq('status', 'proposed');
}
```

Il filtro `.eq('status', 'proposed')` può legittimamente non trovare nessuna riga — una campagna già
uscita da quello stato, o un `campaignId` mancante, che qui diventa la stringa vuota. In tutti
questi casi non è stato rifiutato niente e il tool risponde `ok: true`.

Il confronto coi fratelli nello stesso file prova che è una dimenticanza: `approve` (`:94`),
`duplicate` (`:103`) e gli altri tornano `400` quando `result.ok` è falso.

---

## 8. `platforms` è lo stesso concetto con quattro forme, e i valori sbagliati spariscono

**Gravità: alta.** È il precedente dello `slug` in un'altra veste: un parametro che si sbaglia senza
che nessuno lo dica.

La lista chiusa esiste, nove valori: `TARGET_PLATFORMS`
(`packages/api-contracts/src/brand-settings.ts:10-20`). Arriva al modello su due tool su sei —
misurato sullo schema JSON esposto da `tools/list`, guardando `items.enum`:

| tool | forma di `platforms` | enum nello schema |
|---|---|---|
| `set_brand_settings` | `array<string>` | **sì** (9 valori) |
| `generate_captions` | `array<string>` | **sì** (9 valori) |
| `create_post` | `array<string>` | no |
| `edit_post` | `array<string>` | no — **e nessuna descrizione del campo** |
| `check_content` | `array<string>` | no |
| `get_creation_kit` | **`string`, separato da virgole** | no |

**Primo difetto: `get_creation_kit` cambia forma.** È il tool che si chiama *prima* di scrivere un
post, `create_post` quello che si chiama dopo. Il primo vuole `"instagram,linkedin"`, il secondo
`["instagram","linkedin"]`.

**Secondo: una piattaforma sconosciuta non viene rifiutata, viene scartata.**

`src/lib/manual-posting-captions.ts:17-28`
```ts
export function normalizePlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  ...
  for (const item of raw) {
    const k = capKey(String(item ?? ''));
    if (!k || !KNOWN.has(k) || seen.has(k)) continue;
```

`continue`, non un errore. `create_post(platforms: ["linkedin", "pinterest"])` crea il post **solo
per LinkedIn** e risponde `{ok: true, id, status: 'pending_user'}`: metà della richiesta è sparita e
nessuno lo dice. `no_platforms` (`src/lib/server/manual-posting.ts:245`) scatta solo se si sbagliano
*tutte*. `check_content` fa lo stesso: dà un esito pulito senza aver mai valutato la piattaforma
scartata.

Va riconosciuto che l'errore più probabile è già coperto: `capKey` mappa `twitter` → `x`
(`manual-posting-captions.ts:12-15`). Sono gli altri a passare inosservati.

**Terzo, e il più netto: in `edit_post` la regola è scritta accanto al campo che non la applica.**
Nello stesso handler, nello stesso ciclo, `format` è protetto con una motivazione esplicita e
`platforms` no:

`src/routes/api/v1/brands/[slug]/posts/[id]/+server.ts:27-37`
```ts
  const updates: Record<string, unknown> = {};
  for (const f of FIELDS) if (body[f] !== undefined) updates[f] = body[f];
  ...
  // `format` drives the renderer and the publisher — a free-form string here silently produces
  // the wrong media downstream, so only the enum is accepted.
  if (updates.format !== undefined && !isContentFormat(updates.format)) {
    return json({ error: `Invalid format. Use one of: ...` }, { status: 400 });
  }
```

`platforms` prosegue invariato fino a `supabase.from('posts').update(patch)`
(`src/lib/server/post-editing.ts:214`): niente normalizzazione, niente minuscole, niente controllo
di appartenenza. `edit_post({platforms: ["Instagram","Twitter"]})` scrive nel database esattamente
quelle due stringhe. `create_post` almeno le scarta; `edit_post` le conserva sbagliate.

**Quarto, minore.** La lista chiusa è dichiarata due volte, in due posti che nessuno tiene
allineati: `TARGET_PLATFORMS` (`brand-settings.ts:10`) e `PLATFORM_KEYS`
(`src/lib/components/platform-meta.ts:25`). Oggi coincidono; niente lo garantisce domani.

---

## 9. Un verbo dentro un parametro rende `destructiveHint` incapace di dire la verità

**Gravità: media**, ed è una proprietà del protocollo, non un'opinione: `destructiveHint` è
un'annotazione **per tool**. Non esiste modo di dire «distruttivo solo quando `action = delete`».
Quindi un tool che nasconde un verbo in un parametro è marcato distruttivo per intero o per niente,
e sbaglia comunque in uno dei due versi.

Il verso che costa di più è il primo: un client che avvisa sui tool distruttivi finisce per avvisare
anche sulle azioni innocue, e da lì si impara a cliccare via l'avviso. Il presidio si perde senza
che nessuno l'abbia tolto.

Cercati tutti i tool con questa forma — un verbo, una modalità o una cancellazione espressa da un
valore invece che dal nome:

| tool | dove sta il verbo | `destructiveHint` | perché è sbagliato |
|---|---|---|---|
| `ads_action` | `action`: 10 verbi, fra cui `delete` | **true** | avvisa anche su `sync` e `propose`, che non distruggono niente — e `propose` non spende nemmeno (§3c) |
| `seo_action` | `action`: 5 valori | false | nessuno cancella, ma **tutti spendono**: l'avviso che servirebbe è sul costo, e non esiste annotazione che lo esprima |
| `geo_action` | `action`: `audit`/`fix` | false | come sopra, entrambi a pagamento |
| `set_automation` | `enabled: true/false` | false | `true` avvia un lavoro che **da lì in poi spende da solo, senza nessuno che guardi** — lo dice la descrizione stessa; `false` non distrugge niente. Due conseguenze opposte, una sola annotazione |
| `set_appearance` | `remove_logo: true` | false | `if (input.remove_logo) patch.logos = []` — `studio/appearance/+server.ts:109`: cancella il logo |
| `edit_post` | `media_url: null` | false | la descrizione lo dice: *«clears the image and makes it text-only»* |
| `reorder_slides` | `order: [...]` | false | *«Anything left out is dropped»*: le slide si cancellano per omissione |
| `set_radar_platform` | `enabled: true/false` | false | stessa forma di `set_automation`, conseguenze minori |

Non è una proposta di rifattorizzazione — quella la decide il piano di aggregazione. È il criterio
da applicare quando lo si scrive: **un verbo che cambia la reversibilità dell'operazione appartiene
al nome del tool, non a un suo parametro**, perché il nome è l'unico posto in cui il protocollo sa
leggerlo.

---

## 10. Tredici tool sostituiscono contenuto e si annotano `destructive: false`

**Gravità: media**, con una punta alta su `optimize_article`. È la variante «l'annotazione mente»
della domanda 1: `destructiveHint` è la riga su cui un client decide se chiedere conferma a un
umano.

| tool | dove sta il flag | cosa dice la sua descrizione |
|---|---|---|
| `optimize_article` | `articles.ts:178` | *«REPLACES the text that is there; keep a copy if you might want it back»* |
| `regenerate_post_media` | `posts.ts:438` | *«The old image is REPLACED»* |
| `plan_week` | `plans.ts:298` | *«replaces the week draft in review»* |
| `replan_week` | `plans.ts:282` | *«replaces that week»* |
| `revise_plan` | `plans.ts:205` | *«It replaces the pending proposal»* |
| `save_plan` | `plans.ts:92` | *«Saving replaces an earlier pending proposal»* |
| `save_week_seeds` | `plans.ts:171` | *«saving replaces the one in review»* |
| `refresh_keywords` | `search.ts:70` | *«replaces the current set»* |
| `ads_remix` | `ads.ts:38` | *«it replaces the briefs from last time»* |
| `set_colors` | `studio.ts:410` | *«The list REPLACES the whole palette»* |
| `set_brand_settings` | `brand-settings.ts` | *«`hashtags` and `voice_examples` REPLACE the whole list»* |
| `set_blog_settings` | `blog-settings.ts` | *«`locales`, `navbar_links` and `analytics` replace their whole list»* |
| `create_product` | `studio.ts:61` | avverte che `sync_products` *«would erase a hand-made row»* |

`optimize_article` è il caso peggiore: riscrive irreversibilmente un articolo scritto da una
persona, dice esplicitamente «tieni una copia», e non fa chiedere niente a nessuno. Il confronto
interno regge il giudizio: `publish_article`, che è **reversibile** con `unpublish_article`, porta
`destructive: true` (`articles.ts:193`).

---

## 11. Sei tool sopravvissuti puntano a tool che stanno per sparire — e i riferimenti non sono solo nei sorgenti

**Gravità: media**, che diventa alta nel momento esatto in cui il ritiro atterra.

Le descrizioni si nominano a vicenda, ed è la cosa migliore di questo insieme. Ma sei riferimenti
puntano ai quattro media e a `get_memory`, che escono:

| tool che resta | manda a | perché è un problema |
|---|---|---|
| `record_memory_used` | `get_memory` | *«Call it after acting, with the ids from `get_memory`»* — è la sua **unica** istruzione operativa: senza quel tool non è più eseguibile come descritto |
| `render_post` | `generate_image` | l'alternativa che offre non esisterà |
| `regenerate_post_media` | `refine_image` | idem |
| `make_video` | `generate_video` | idem, e ci si appoggia due volte |
| `check_media_job` | `generate_video` | dice quali job osserva citandone il produttore |
| `generate_media` | `generate_image`, `generate_video` | *«Prefer generate_image or generate_video»*: il sopravvissuto raccomanda i ritirati |

**E i riferimenti vivono anche fuori dai sorgenti.** Cercandoli solo nelle descrizioni se ne trova
meno della metà:

| dove | cosa contiene | conseguenza |
|---|---|---|
| `cli/skills/anomalia/SKILL.md` e `cli/skills/anomalia/references/tools.md` | tutti e undici i nomi ritirati | **`cli/skills/tools-coverage.test.ts` fallisce**: asserisce nei due versi che skill e tool coincidano (*«un tool che la skill nomina e non esiste lo chiama qualcuno»*) |
| `cli/skills/findability.test.ts` | `generate_image`, `refine_image`, `generate_video`, `whoami` | stesso effetto sulla CI |
| `src/lib/i18n/locales/docs/{en,it,es,fr}.json`, chiave `agents.s50` | *«Verify with `whoami` / `list_brands` or `anomalia brands`»* | una pagina pubblica dice **in quattro lingue** di usare un tool che non esisterà |
| `cli/mcp/server.ts:22` | *«Sign in with `login`»* | è nell'handshake: la legge ogni sessione, prima di qualunque descrizione |

E un riferimento **già morto oggi**, indipendente da qualunque ritiro:
`packages/api-contracts/src/studio.ts:54` — la descrizione di `create_product` spiega cosa fa
`sync_products`, che **non è un tool MCP**. Esiste come comando CLI (`cli/commands/products.ts:49`)
e come tool della chat interna (`src/lib/agent/tools/pipeline-tools.ts:516`), ma un client MCP non
lo vedrà mai in `tools/list`.

---

## 12. Cinque parametri che il codice corregge o scarta invece di rifiutare

**Gravità: media.** Stessa famiglia della §8: il modello riceve una conferma e un risultato diverso
da quello che ha chiesto.

| tool.parametro | schema | cosa fa davvero | prova |
|---|---|---|---|
| `set_blog_settings.accent` | `string`, «Six-digit hex», nessuna regex | valore non conforme → **`#111111`**, risposta `ok` | `src/lib/server/blog-settings.ts:317` |
| `set_blog_settings.font` | `string` | fuori elenco → **`'sans'`** | `blog-settings.ts:318` |
| `set_blog_settings.layout` | `string` | tutto ciò che non è `sidebar` → **`'navbar'`** | `blog-settings.ts:319` |
| `query.limit` | `integer`, nessun massimo (il JSON dice `maximum: 9007199254740991`) | `Math.min(limit ?? 20, 100)` — troncato senza dirlo; il tetto sta solo nella prosa | `src/lib/server/chat/query-tool.ts:297` |
| `get_bio.platform`, `set_bio.platform` | `string` libera | `.eq('platform', platform)`: un valore inesistente dà `bioUrl: null` (identico a «nessuna bio») o 404 «No active social account» (identico a «niente collegato») | `packages/api-contracts/src/studio.ts:219-243`, `bio/+server.ts:18-29` |

`set_colors` fa la cosa giusta sullo stesso identico tipo di dato — esadecimale validato con una
regex e un fallimento con un nome (`studio.ts:396-406`) — quindi `accent` non è una scelta, è una
dimenticanza. E `get_bio`/`set_bio` sono la corrispondenza più stretta col precedente dello `slug`:
la stessa nozione è `z.enum(TARGET_PLATFORMS)` su `create_social_connect_link`
(`packages/api-contracts/src/social.ts:18`) e su `set_radar_platform`, e stringa libera qui.

**Due vincoli del database che lo schema non rispecchia**, quindi il rifiuto arriva da Postgres come
errore grezzo invece che dallo schema come guida:

| tool.parametro | schema | vincolo reale |
|---|---|---|
| `add_radar_source.lang` | `string`, `max(5)` | `lang ~ '^[A-Za-z-]{2,5}$'` — `supabase/migrations/20260905200000_table_value_checks.sql:300-301`: `"1"` passa lo schema e viene rifiutato dal database |
| `save_memory.key` / `.value` | solo `min(1)` | `key <= 200`, `value <= 50000` caratteri — stessa migrazione, righe 272-275 |

E un fallimento non dichiarato: `seo_action.initiativeId` è opzionale nello schema
(`packages/api-contracts/src/search.ts:16`) ma obbligatorio per `action: 'asset' | 'article'`
(`src/routes/api/v1/brands/[slug]/seo/+server.ts:67`). Fallisce con un messaggio chiaro, ma quel
codice non è nell'elenco `failures` del contratto, che dichiara solo `credits_exhausted`.

---

## 13. Quattro coppie in cui il modello può scegliere male

**Gravità: bassa**, ma è la classe che ha già prodotto un incidente — l'agente chiamato a
modificare un'immagine ne ha generata una nuova. Qui non si propongono fusioni: si scrive la frase
che manca.

**`render_post` ↔ `regenerate_post_media`.** È lo stesso incidente un piano più sotto. La regola che
li separa è *il post ha già un'immagine oppure no*, e non è scritta in nessuna delle due: ciascuna
rimanda invece a un tool di libreria in uscita (§11).
Su `render_post`: *«Use this only when the post has no image yet — to change an image already on a
post, use regenerate_post_media.»*
Su `regenerate_post_media`: *«The post must already have an image; if it has none, render_post draws
it from the prompt.»*

**`add_note` ↔ `save_memory`.** Entrambi scrivono ciò che il brand sa, in due posti diversi —
`brand_documents`, indicizzato (`studio/documents/+server.ts:27`), e la memoria a chiave/valore — e
**nessuna delle due nomina l'altra**. «Ricorda che il CEO preferisce didascalie corte» va bene in
tutti e due.
Su `save_memory`: *«For a document, a transcript or a policy — anything you want searchable passage
by passage — use add_note instead; this is for short facts retrieved by key.»*

**`add_person` ↔ `generate_person`.** Il rimando esiste in una direzione sola: `generate_person`
dice *«For a REAL person, use add_person»*, ma `add_person` non nomina mai `generate_person`.
Su `add_person`: *«For an invented spokesperson with a generated face, use generate_person — it
needs no consent because nobody is being depicted.»*

**`update_voice` ↔ `set_brand_settings`.** Due tool scrivono «come suona il brand»: il primo il
framework (mood, tono, registro), il secondo `voice_examples`. Nessuno nomina l'altro.
Su `update_voice`: *«The examples the AI imitates are not here: they live in set_brand_settings as
`voice_examples`.»*

---

## 14. `produce_week` espone un parametro che non fa niente

**Gravità: bassa**, ma è puro costo: occupa la finestra di ogni sessione.

`cli/mcp/tools/plan.ts:20`
```ts
        week: z.number().int().min(0).optional().describe('Unused for API resolve — seeds draft is auto-detected'),
```

Il campo arriva al modello e l'handler non lo legge mai: la destrutturazione prende solo
`{ slug, row_index }` (`plan.ts:25`). La descrizione lo confessa, il che impedisce il danno; ma un
parametro documentato come inutile va rimosso, non documentato.

---

## 15. Nessun tool morto — ma 31 rotte non le raggiunge nessuno

**Gravità: bassa per i tool, informativa per le rotte.**

La metà buona della domanda 6 è pulita: **115 tool su 115** hanno una rotta che esiste e che esporta
il metodo dichiarato. Sono stati risolti tutti i percorsi del registro
(`src/routes/api/v1/brands/[slug]<pathUnderBrand>/+server.ts`, con `:id` → `[id]`) e verificati gli
`export const <METODO>`; per gli otto scritti a mano, le funzioni `api.*` esistono tutte in
`cli/lib/api.ts` e colpiscono rotte esistenti.

L'altra metà: su 183 `+server.ts` sotto `src/routes/api/v1/`, 102 sono raggiunti da un tool MCP, 40
sono bersagli di cron dichiarati in `vercel.json`, 4 dal browser o da un servizio esterno — e **31
non li raggiunge nessuno**. Non pesano sulla finestra di contesto, ma sono superficie che nessuno
esercita.

Il repository lo sa già: `src/routes/api/v1/brands/[slug]/registry.test.ts` tiene una lista
`REST_ONLY` di rotte volutamente fuori dal registro, e il suo stesso commento non decide —
*«Superficie REST voluta, o codice morto da cancellare»*.

| gruppo | rotte | perché nessuno le chiama |
|---|---|---|
| **Connectors** | `connections/`, `connections/[id]/`, `connections/[id]/complete/`, `connections/catalog/` | Settings → Connectors chiama `$lib/server/composio-catalog` direttamente. **`CLAUDE.md` afferma che ci arriva la CLI con `anomalia connections`: quel comando non esiste** — `cli/commands/` non ha il file e nessun comando è registrato |
| **Rubriche** | `rubrics/`, `rubrics/approve/`, `rubrics/propose/` | `/app/[brand]/rubrics` chiama `loadApprovedRubrics` / `approveRubrics` / `proposeRubrics` direttamente |
| **Chiavi API** | `api-keys/`, `api-keys/[id]/` | il browser le gestisce con le form action di SvelteKit |
| **Webhook di brand** | `webhook/` (GET, PUT, DELETE) | idem, su `$lib/server/brand-webhooks` |
| **Mercato spento apposta** | `market/harvest/`, `market/trends/` | disattivate per costo: un test lo afferma — *«spenti: la raccolta senza brand costava 26 dollari/30d e cresceva 4x»* |
| **Mercato admin** | `market/backfill/`, `market/brief/`, `market/fit/` | protette da `cronAuthorized` ma non schedulate |
| **Client scritto, comando mai** | `editorial-plan/update/`, `gtm/update/`, `tick/`, `weekly-plan/save/` | `cli/lib/api.ts` ha `updateEditorialPlan`, `updateGtmPlan`, `tick`, `saveWeekDraft`: nessun comando CLI li chiama |
| **Articoli REST** | `articles/`, `articles/[id]/` | distinti da `/web`, che è quello che usano i tool |
| **Altre** | `agent-templates/`, `agent-sessions/`, `agent-sessions/[id]/`, `publishing/`, `library/scan/`, `posts/[id]/revoke/`, `analytics/visual/backfill/`, `benchmark/`, `benchmark/run/`, `onboarding/process/`, `version/` | `agent-templates` porta un commento che dice «for the CLI and the MCP server» e non la chiama nessuno dei due: `/agents` importa `$lib/server/agent-templates` direttamente. `onboarding/process` è un no-op dichiarato, tenuto per non dare 404 a vecchi cron |

Attenzione a come si legge questa tabella: «non la raggiunge nessuno» è il risultato di una ricerca
**dentro questo repository**. `agent-sessions`, `publishing` e `version` si dichiarano superficie
REST pubblica per consumatori esterni, che da qui sono invisibili. Orfana qui significa *senza
chiamante interno*, non *cancellabile*.

---

# La tabella completa

115 tool, le sei domande. `R` = sola lettura, `W` = scrive. `✅` = nessun rilievo; `⚠️` = difetto
minore; `❌` = difetto sostanziale, col rimando alla sezione che lo prova.

Le sei colonne sono, nell'ordine del brief: **1** fa quello che nome e descrizione promettono
(annotazione inclusa) · **2** si capisce senza la skill · **3** dice quanto costa, verificato
contro il codice · **4** lo schema guida invece di lasciar sbagliare · **5** si distingue dai
vicini · **6** ha una rotta viva. La colonna 6 è `✅` per tutti: nessun tool punta a una rotta
inesistente (§15).

| tool | | 1 mantiene? | 2 da solo? | 3 costo | 4 schema | 5 distinto? | 6 rotta |
|---|---|---|---|---|---|---|---|
| `add_blog_term` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `add_competitor` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `add_note` | W | ✅ | ✅ | ❌ §3 paga, dice gratis | ✅ | ⚠️ §13 | ✅ |
| `add_person` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ⚠️ §13 | ✅ |
| `add_radar_source` | W | ✅ | ✅ | gratis, e lo dice ✅ | ⚠️ §12 | ✅ | ✅ |
| `ads_action` | W | ❌ §7 | ❌ §2 | ❌ §3 alcune azioni pagano | ❌ §2 | ✅ | ✅ |
| `ads_remix` | W | ⚠️ §10 | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `approve_plan` | W | ❌ §4 | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `approve_post` | W | ✅ | ✅ | ❌ §3 paga, dice gratis | ✅ | ✅ | ✅ |
| `approve_posts` | W | ✅ | ✅ | ❌ §3 paga, dice gratis | ✅ | ✅ | ✅ |
| `check_content` | W | ✅ | ✅ | gratis, e lo dice ✅ | ⚠️ §8 | ✅ | ✅ |
| `check_media_job` | R | ✅ | ⚠️ §11 | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `create_billing_portal_link` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `create_checkout_link` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `create_post` | W | ✅ | ✅ | gratis, e lo dice ✅ | ❌ §8 | ✅ | ✅ |
| `create_product` | W | ⚠️ §10 | ❌ §11 | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `create_share` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `create_social_connect_link` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `delete_article` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `delete_competitor` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `delete_document` | W | ✅ | ✅ | ❌ §3 paga, tace | ✅ | ✅ | ✅ |
| `delete_person` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `delete_product` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `diagnose_brand` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `diagnose_radar` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `discard_plan` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `edit_post` | W | ⚠️ §9 | ✅ | ❌ §3 paga, dice gratis | ❌ §8 | ✅ | ✅ |
| `generate_article` | W | ✅ | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `generate_captions` | W | ✅ | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `generate_media` | W | ✅ | ❌ §11 | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `generate_person` | W | ⚠️ §3 | ✅ | ❌ §3 paga, zero gate | ✅ | ⚠️ §13 | ✅ |
| `geo_action` | W | ⚠️ §9 | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_ads` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_analytics` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_article` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_audit_findings` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_automations` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `get_backlinks` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_bio` | R | ✅ | ✅ | gratis, tace ✅ | ⚠️ §12 | ✅ | ✅ |
| `get_blog_settings` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `get_brand_settings` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `get_calendar` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_creation_kit` | R | ✅ | ✅ | gratis, e lo dice ✅ | ⚠️ §8 | ✅ | ✅ |
| `get_dashboard` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_geo` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_goals` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_gsc` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_gtm` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_keywords` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_knowledge_status` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_market_field` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_media_models` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `get_plan` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_post` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_radar` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `get_ranks` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_seo` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_status` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_studio` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `get_voice` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_weekly_plan` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `get_writing_skills` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `import_media_url` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `list_audit_citations` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `list_brands` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `list_media` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `list_posts` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `list_shares` | R | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `list_social_accounts` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `list_web_audits` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `list_web_fixes` | R | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `make_video` | W | ✅ | ⚠️ §11 | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `optimize_article` | W | ⚠️ §10 | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `plan_week` | W | ⚠️ §10 | ✅ | ❌ §3 paga, zero gate | ✅ | ✅ | ✅ |
| `produce_week` | W | ✅ | ✅ | paga, e lo dice ✅ | ⚠️ §14 | ✅ | ✅ |
| `propose_plan` | W | ✅ | ✅ | ❌ §3 paga, zero gate | ✅ | ✅ | ✅ |
| `publish_article` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `publish_post` | W | ✅ | ✅ | ❌ §3 paga, dice gratis | ✅ | ✅ | ✅ |
| `query` | W | ✅ | ✅ | gratis, e lo dice ✅ | ⚠️ §12 | ✅ | ✅ |
| `record_memory_used` | W | ✅ | ❌ §11 | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `refresh_keywords` | W | ⚠️ §10 | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `regenerate_post_media` | W | ⚠️ §10 | ⚠️ §11 | paga, e lo dice ✅ | ✅ | ⚠️ §13 | ✅ |
| `regenerate_slide` | W | ✅ | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `reject_post` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `remove_blog_term` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `remove_radar_source` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `render_post` | W | ❌ §6 | ⚠️ §11 | paga, e lo dice ✅ | ✅ | ⚠️ §13 | ✅ |
| `reorder_slides` | W | ⚠️ §9 | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `replan_week` | W | ⚠️ §10 | ✅ | ❌ §3 paga, zero gate | ✅ | ✅ | ✅ |
| `reschedule_post` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `research_competitors` | W | ✅ | ✅ | paga, e lo dice ✅ | ✅ | ✅ | ✅ |
| `revise_plan` | W | ⚠️ §10 | ✅ | ❌ §3 paga, zero gate | ✅ | ✅ | ✅ |
| `revoke_share` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `save_brief` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `save_memory` | W | ✅ | ✅ | gratis, tace ✅ | ⚠️ §12 | ⚠️ §13 | ✅ |
| `save_plan` | W | ⚠️ §10 | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `save_week_seeds` | W | ⚠️ §10 | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `search_knowledge` | R | ✅ | ✅ | ❌ §3 paga, dice gratis | ✅ | ✅ | ✅ |
| `seo_action` | W | ❌ §1 | ✅ | paga, e lo dice ✅ | ❌ §1 | ✅ | ✅ |
| `set_appearance` | W | ⚠️ §9 | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `set_automation` | W | ⚠️ §9 | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `set_bio` | W | ✅ | ✅ | gratis, tace ✅ | ⚠️ §12 | ✅ | ✅ |
| `set_blog_settings` | W | ⚠️ §10 | ✅ | gratis, e lo dice ✅ | ⚠️ §12 | ✅ | ✅ |
| `set_brand_settings` | W | ⚠️ §10 | ✅ | gratis, e lo dice ✅ | ✅ | ⚠️ §13 | ✅ |
| `set_colors` | W | ⚠️ §10 | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `set_media_model` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `set_radar_platform` | W | ⚠️ §9 | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `sync_history` | W | ✅ | ✅ | ❌ §3 paga, tace | ✅ | ✅ | ✅ |
| `unpublish_article` | W | ✅ | ✅ | gratis, tace ✅ | ✅ | ✅ | ✅ |
| `update_article` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `update_brand_kit` | W | ❌ §5 | ✅ | ❌ §3 paga, dice gratis | ⚠️ §5 | ✅ | ✅ |
| `update_competitor` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `update_person` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `update_product` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ✅ | ✅ |
| `update_voice` | W | ✅ | ✅ | gratis, e lo dice ✅ | ✅ | ⚠️ §13 | ✅ |

---

# Cosa non è stato verificato, e perché

Elencato perché un'analisi che non dice dove si ferma vale quanto un test che passa senza misurare
niente.

**Niente è stato esercitato contro un brand vero.** Non c'è stato uno stack locale né un browser:
nessuna delle 115 chiamate è stata eseguita end-to-end. Le due prove per esecuzione (§5) girano
sull'handler con un client Supabase finto: dimostrano **la forma del payload che parte e lo stato
HTTP che torna**, non cosa fa Postgres quando lo riceve. Le RLS, i trigger e i vincoli veri
restano fuori.

**I difetti sono provati come raggiungibili, non come avvenuti.** Per `approve_plan` (§4) è
dimostrato il percorso e l'indice unico che lo rende possibile — non che sia successo in
produzione. Per stabilirlo servirebbe leggere i log o contare le righe `editorial_plans` rimaste
`proposed` dopo un'approvazione.

**La spesa è misurata leggendo le catene di chiamata, non le fatture.** Nessuna chiamata a
pagamento è stata eseguita e `ai_calls` non è stato interrogato. Per `search_knowledge` in
particolare, il costo di un singolo embedding non è stato quantificato: è dimostrato che finisce
in `ai_calls` e quindi nel conteggio, non quanto pesi.

**`ads_action` è l'unico tool di cui non ho letto ogni ramo fino in fondo.** I dieci `case` sono
stati enumerati e i rami che spendono identificati per riga, ma la catena verso la piattaforma
pubblicitaria esterna (Zernio) non è stata seguita oltre `src/lib/server/ads.ts`.

**Le §2 e §11 presuppongono che i ritiri atterrino come descritti.** Se #383 o il ritiro dei
quattro media cambia forma, i riferimenti pendenti cambiano con loro. Vanno riletti dopo il merge.

**L'elenco dei tool è stato misurato su `dev@d21c818e`, prima di #383.** Il numero esposto oggi
(126) non è più quello che si vedrà dopo il merge (119). L'insieme analizzato — 115 — non cambia,
ma se qualcuno rigenera l'inventario dopo #383 e trova 119, i due numeri sono coerenti, non in
conflitto.

**La suite non è stata eseguita.** Le due prove della §5 sono state fatte girare da sole. Non è
stato verificato se qualche altro test già rosso coprisse per caso uno di questi difetti — e nella
§11 c'è una previsione (`tools-coverage.test.ts` fallirà quando i tool escono) che è dedotta dal
codice del test, non da un'esecuzione.

**Su `docs/mcp-tools.md` ho confrontato i numeri di oggi con quelli che il documento dichiara, non
col commit citato.** Che il tool di lettura mancante sia uscito fra `d099e02a` e oggi è
un'inferenza dal conteggio, non un `git diff`.

**Le rotte orfane sono orfane rispetto a questo repository.** Un consumatore esterno, un segnalibro
o un'integrazione di terze parti che chiama `/api/v1/...` direttamente qui non si vede. Tre di
quelle rotte si dichiarano API pubblica.
