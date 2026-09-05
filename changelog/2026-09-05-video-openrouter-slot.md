# Il video ha uno slot, e OpenRouter ha un trasporto per servirlo

Il registro aveva quattro slot e il video non era uno di quelli. `videoModel(job)` non passava da
`route()`: un video era l'id di un modello di kie, scelto da `AI_ROUTE_VIDEO_I2V`, e non esisteva
il posto dove dire **chi lo serve**. Aggiungere `openrouter` agli endpoint due PR fa è quindi
arrivato al testo e alle immagini e si è fermato prima del video — non per una scelta, per la
mancanza dello slot.

Adesso il video è uno slot come gli altri, una riga per tabella, e `AI_ROUTE_VIDEO` lo indirizza.

## Le famiglie sono per (fornitore, modalità), e non è pedanteria

`grok-imagine` non è `grok`. Sembra la stessa cosa e non lo è, perché `SERVED_BY` è indicizzato
**per famiglia**: collegare il trasporto video di Grok su una famiglia condivisa col testo
renderebbe valida anche `AI_ROUTE_TEXT=grok@openrouter`, che nessun trasporto serve. Quella rotta
atterrerebbe altrove **in silenzio** — cioè si leggerebbe come rispettata senza esserlo, che è
esattamente il guasto per cui `SERVED_BY` è stato scritto il giorno prima.

Il file aveva già la convenzione giusta e la seguiva senza dirla: `gemini` e `gemini-tts` sono due
famiglie, `nano-banana` è la modalità immagine di Google. Le tre nuove — `grok-imagine`, `seedance`,
`kling` — la rendono esplicita nel tipo.

## Nessun default si sposta

`HOME` e `SLOT_DEFAULT` tengono il video su kie. Questa PR costruisce la strada, non ci manda il
traffico: lo spostamento è una decisione che arriva dopo, coi numeri qui sotto, e un test la tiene
ferma (*«il video resta su kie: questa rotta costruisce la strada, non ci manda il traffico»*).

## Il trasporto è asincrono, quindi è la forma della #325 e non una seconda

OpenRouter serve il video su una superficie **separata** dal catalogo chat: `POST /videos`,
`GET /videos/{jobId}`, `GET /videos/models`. Cercare quei 28 modelli in `GET /api/v1/models` dà
zero risultati e fa concludere che non esistano — è già successo.

Essendo asincrono porta con sé lo stesso rischio che su kie è costato clip pagate due volte, quindi
porta la stessa soluzione già in produzione, non una nuova:

- l'esito è esplicito — `done` / `failed` / `timeout`, mai un `undefined` che li confonde;
- una **scadenza porta il suo `jobId`**, e il tentativo dopo **riprende quello**. Il ritentativo
  vero resta legittimo solo sui **rifiuti**, mai sulle scadenze;
- una scadenza lascia una riga in `ai_calls` con l'id e **senza costo inventato**.

`renderOpenrouterVideo` con `resumeJobId` non invia niente e va dritto al poll. Il test conta gli
invii, perché è quello il soldo: se ne passassero due, staremmo pagando due volte la stessa clip.

### Il trasporto si legge dalla RIGA, mai dalla variabile di adesso

L'id che finisce su `video_renders.task_id` porta scritto chi lo può interrogare
(`openrouter:<jobId>`). Senza il marchio, una riga consegnata prima di un deploy che cambia
`AI_ROUTE_VIDEO` verrebbe cercata su kie dal riconciliatore, non trovata mai, e la clip **già
pagata** resterebbe lì senza che nessuno se ne accorga. Per la stessa ragione l'upscale di kie
rifiuta un id marchiato invece di spenderci un giro di rete.

## Due trappole misurate, non dedotte

**La clip non si scarica senza la chiave.** `unsigned_urls` punta a
`/videos/{id}/content`, che senza `Authorization` risponde **401**; `persistMp4` faceva una `fetch`
nuda. Il render sarebbe riuscito, sarebbe stato **fatturato**, e la clip sarebbe finita come «clip
rendered but could not be stored». Misurato: 401 senza header, 200 e 6,5 MB con.

**Una durata fuori scala non viene rifiutata: viene silenziosamente riportata dentro.** Un invio
con `duration_seconds: 999` — nome di campo sbagliato, il vero è `duration` — è stato **accettato**
(202) e ha prodotto 8 secondi, addebitati $0,64. Non c'è nessuna validazione che salvi da un campo
scritto male: la clampatura resta nostra, in `videoModelCaps`.

## I prezzi, misurati da entrambe le parti

Il lato OpenRouter si legge da `pricing_skus` **senza spendere** — `pricing` è nullo su tutti e 28,
e guardare lì fa concludere il falso. Il lato kie è quello che abbiamo davvero pagato in 30 giorni.

Su Grok Imagine 1.5 il confronto è chiuso, con soldi veri da entrambe le parti:

| Grok Imagine 1.5, 480p | kie (misurato, 30 render) | OpenRouter (`pricing_skus`, confermato) |
|---|---|---|
| al secondo | $0,0132 | $0,080 |
| clip da 10s | **$0,132** | **$0,80** |

**OpenRouter costa 6× kie su questo modello.** Il numero di OpenRouter non è una stima: un invio
partito per sbaglio durante la ricerca ha reso 8 secondi a 480p e ha addebitato **$0,64**, cioè
esattamente gli $0,08/s del listino. Il costo è stato reale ed è dichiarato qui.

Su Seedance 2.5 il confronto **non si chiude senza spendere**, e va detto invece di riempirlo:

- kie, misurato: **$114,11 per 63 render riusciti, $1,811 l'uno**, tipicamente 15s 480p (più 9
  falliti, che non paghiamo). Da solo supera l'intero budget immagini del mese.
- OpenRouter prezza Seedance **a token video** (`video_tokens: 0.0000107`), non al secondo. Quanti
  token siano 15 secondi a 480p dipende da una tokenizzazione che il catalogo non pubblica: le due
  formule plausibili danno **$0,82** e **$3,29** per una clip da 8s, cioè una più economica di kie e
  l'altra quasi il doppio.

Quindi: **prima di spostare Seedance serve UN render misurato**, non un'altra lettura di listino.
Visto il 6× su Grok, l'ipotesi da battere è che OpenRouter costi di più anche qui.

Messo accanto agli altri due assi — testo **neutro** (#335), immagini **+17%** (#333), video
**+500%** — «tutto su OpenRouter» non ha lo stesso prezzo dappertutto, e il video è l'unico dove il
conto è di un altro ordine di grandezza. È la ragione per cui il default resta su kie: dev'essere
una decisione esplicita con quel numero davanti, non un effetto collaterale dell'uniformità.

## Quello che NON è in questa PR, e perché

- **`generate_audio`.** Il payload kie lo manda per le clip parlate; sulla superficie video di
  OpenRouter non è documentato. Non l'ho inventato: un campo sconosciuto su un job a pagamento è un
  esperimento che si paga. Va verificato prima di spostare qualunque clip con copione.
- **I `reference_*` di Seedance.** Non esistono su OpenRouter. Un render con riferimenti resta su
  kie, **rumorosamente**, invece di girare senza i riferimenti con un 200 e nessun errore.
- **`refine` e `motion`.** Partono da un video che esiste gia' e vivono su `runTransformJob` (Aleph
  ha perfino un endpoint kie tutto suo). La superficie `/videos` di OpenRouter esprime un
  `frame_images`, non un video in ingresso: e' un altro mestiere, non lo stesso su un altro
  trasporto. Restano su kie **senza consultare `AI_ROUTE_VIDEO`**, il che e' onesto solo finche' e'
  scritto — quindi e' scritto qui.
- **L'upscale.** Prende il `task_id` di kie e di nessun altro; su OpenRouter sarebbe un altro
  modello (`black-forest-labs/flux-video-upscale`, prezzato a megapixel-secondo) e un altro
  mestiere.
- **I webhook di completamento.** OpenRouter accetta un `callback_url` e ci risparmierebbe il
  polling. È la strada giusta il giorno che il traffico ci va davvero; costruirla adesso, per una
  rotta che non porta traffico, sarebbe codice scritto per un'ipotesi.
- **Il changelog pubblico.** Nessun default si muove: per chi usa il prodotto oggi non cambia
  niente, e annunciare che «i video girano su OpenRouter» sarebbe falso.
