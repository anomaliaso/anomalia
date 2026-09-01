# Una guida ai prompt immagine, dove il prompt si scrive davvero

Il prompt di sistema dell'image agent sapeva **giudicare** un'immagine e non sapeva
**scriverne** una. Sei righe di workflow, sei punti di QC — e il punto 5 boccia il render
generico («over-saturated HDR glow, waxy skin, sterile posing, un'immagine che potrebbe
stare nel feed di chiunque») senza dire da nessuna parte come lo si evita. Il parametro era
`prompt: z.string().describe('Image generation prompt')`. Punto.

Adesso `how/WRITE-IMAGE-PROMPTS.md` è inline nel suo prompt di sistema, e nell'indice dei
file dei tre mestieri che possono mintare una still.

## Da dove viene, e cosa è stato buttato

È condensata dal guide di Nano Banana di `NikiforovAll/claude-code-rules` (Apache-2.0), che
gira come skill `nano-banana-prompting`. **La skill così com'è non poteva entrare**: è
interattiva — `AskUserQuestion` a raffica, «vuoi che la generi adesso?», handoff a una
seconda skill — e le domande che fa a un umano qui hanno già una risposta in
`ImageAgentOpts`. Output type sta in `productKind` e `referenceMode`; soggetto in
`productName`/`personName`; era, camera e luce in `visualStyle`/`brandLook`/`visualPlaybook`;
aspect ratio in `aspectRatioFor(platform)`; ruoli dei riferimenti in `refs`; editing in
`baseImageUrl`; iterazione in `feedback`. Un secondo agente non le avrebbe risposte, le
avrebbe inventate partendo dallo stesso contesto del primo.

Quindi è stato preso il contenuto e buttato il workflow. Delle sedici tecniche ne restano
nove, e **quattro sono escluse perché qui sono difetti**:

- **Tecniche 5, 7, 16** (typography, infografiche etichettate, traduzione in-image) chiedono
  tutte al diffusore di scrivere lettere. È il difetto più frequente che abbiamo sui
  visuali: «Social growts», «Scopa menu». Il testo si disegna in codice sopra l'immagine.
- **Tecnica 11** (aspect ratio dentro il prompt) contraddice il renderer: il rapporto lo
  decide `aspectRatioFor(platform)` e `render_image` lo porta come argomento suo. Copiarla
  avrebbe creato esattamente la regola scritta in due posti che diverge al primo cambio —
  `caption-quality.ts:291` già dice il contrario.
- **Tecniche 9, 14, 15** (multi-pannello, blending, upscaling) non hanno un aggancio: i
  caroselli qui sono N render separati (`renderSlides`), non un pannello unico, e un
  percorso di upscale non esiste.

Ci sono invece quattro regole che upstream non può conoscere, e ognuna è un difetto già
pagato: niente testo leggibile, niente aspect ratio, niente descrizione fisica di una
persona con nome (l'identità si blocca dalle foto di riferimento, una descrizione ci
compete e il render deriva), e il medium deve essere quello del brand — un brand illustrato
non diventa una foto «per varietà».

## Perché nessun cancello

La guida video ha `unlocks: ['create_post']`: chi scrive un reel deve averla letta. Quel
cancello se l'era guadagnato con una misura — 131 prompt su 340 chiedevano testo nel frame,
il 16,8% delle review lo ritrovava corrotto. Sulle immagini quella misura non c'è. Un
`unlocks` su `generate_image` costerebbe un giro di tool in più a ogni still per un difetto
di cui non conosciamo la frequenza, ed è il tipo di costo che si accende dopo aver contato,
non prima. Sta nell'indice, si legge, e diventa cancello quando un numero lo chiede.
Precedente identico: `how/DISRUPTIVE-IDEAS.md`.

## Il file è uno, i lettori sono due

L'image agent non ha `read_file`, quindi la guida gli sta inline nel prompt di sistema
(`IMAGE_PROMPT_GUIDE`, ~1,2k token per passo, sopra un prompt che porta già immagini a
768px). L'agente in chat la legge come file. Stesso markdown, due import `?raw`: se cambia,
cambia per entrambi.

## Quello che non è stato toccato

Le istruzioni sui prompt immagine vivono anche in `caption-quality.ts:291-302`,
`produce-agent.ts:259`, `content-preview/creation.ts:232` e `articles.ts:356` — quattro
posti, ognuno col suo paragrafo inline. Sono la stessa regola scritta cinque volte, e vanno
ricondotte a questo file. Non qui: sarebbe un refactor del percorso batch mescolato a un
cambio di comportamento, e i due si separano.
