# Via i componenti della chat, tranne gli otto che disegnano i generatori

Quarto passo. Spariscono 23 componenti `Chat*` (8.967 righe), tredici moduli
`chat-*.ts` rimasti senza importatori (863 righe) e lo store `stores/chat.ts`.

## Gli otto che restano, e perché non sono sette

`ChatLiveStatus` sta dentro `MediaGeneratorGallery` e `MotionVideoLiveOverlay`;
`ChatImageLightbox` dentro `MediaGeneratorWorkbench`. Sono gli **unici due**
consumatori veri fuori dalla chat — verificato sugli `import` reali, non sulle
occorrenze del nome.

Ma un componente si porta dietro quelli che monta. Seguendo il grafo degli import
a partire da quei due si arriva a **otto**, non sette: `ChatLiveStatus`,
`ChatImageLightbox`, `ChatToolChips`, `ChatThought`, `ChatDmChip`,
`ChatMediaCard`, `ChatExpressionStickers` e — quello che mancava all'elenco —
**`ChatExpressionSticker`**, il singolare, che `ChatExpressionStickers` monta.
Cancellarlo avrebbe rotto la galleria del media generator.

## Due falsi allarmi, chiusi guardando gli import veri

- **`ChatPrompt` (2.026 righe) si può cancellare.** `MediaGeneratorComposer`
  sembrava importarlo; la riga è `/* Mirror ChatPrompt shell aesthetics */`, un
  commento nel CSS. Stessa storia per `material-press.ts`.
- **`HomeChatMockup` non dipende da niente di tutto questo.** Sembrava montare
  `ChatConnectCard`, `ChatDmChip` e `ChatToolChips`; sono nomi dentro i commenti.
  Importa solo `AgentAvatar`, `AgentAvatarStack` e `HomeAgentPanel`. La homepage
  di marketing non si tocca ed è al sicuro davvero, non per fortuna.

`ChatThought` e `ChatToolChips` citano `ChatSources` e `ChatGoalStatusCard` nei
commenti: anche lì, nessun import. I due se ne vanno.

## Lo store: il simbolo si estrae prima

`stores/chat.ts` (339 righe) era rimasto con tre soli importatori —
`AgentAvatarStack`, `AgentStack3D`, `IntroCarousel` — e tutti e tre prendevano
**un tipo solo**, `ThreadAgentAvatar`: quattro campi che descrivono un volto da
disegnare. Due dei tre sono superfici non-chat (la pila di avatar è chrome del
guscio, il carosello è onboarding).

Il tipo è stato spostato in `agent-avatars.ts`, dove vivono già faccia, colore e
le loro normalizzazioni, e poi lo store è stato cancellato. È lo stesso schema
dei sette moduli condivisi sotto `server/chat/`: se un importatore sopravvive, il
simbolo esce **prima**, il file muore **dopo**.

## I test

- Cancellato `chat-send-loading.test.ts`: parlava solo di `ChatColumn` e
  `ChatPrompt`.
- Sfoltiti `chat-dm` e `chat-expression`: montavano l'asserzione su due
  superfici, ne resta una (`ChatLiveStatus`).
- `agent-owners.test.ts` perde il caso che leggeva `ChatAgentProposalCard`.
- `ui-tokens.test.ts`: sei voci di `LEGACY_STRAYS` puntavano a componenti
  cancellati. Il messaggio del test dice esattamente cosa fare — «il debito può
  solo scendere» — e infatti scende.

`chat-messages.css` resta: lo importa `ChatLiveStatus`.

## Cosa resta

`src/lib/server/chat/` e `stores/chat-session.ts` (quest'ultimo serve a
`ChatLiveStatus` e a `MediaGeneratorWorkbench`). E `agent-base.ts`, che è il
prossimo passo con l'estrazione già decisa: `GROUNDING_BLOCK`, `ChatModelResolved`
e `chat/subagents` escono da `chat/`; `goal` e `artifact` se ne vanno da soli,
perché erano già condizionati a `threadId` e senza conversazione erano `{}`.

## Tabelle non toccate

Nessuna migration.
