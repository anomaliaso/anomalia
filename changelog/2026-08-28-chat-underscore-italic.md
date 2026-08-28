# Il corsivo `_…_` che arrivava crudo

Prima: `renderMd` (`src/lib/chat-markdown.ts`) sapeva rendere `**…**`, `__…__`,
`*…*`, `~~…~~` ma non `_…_` — l'unico stile che il server scrive da solo, e non
per eleganza. `failChatJob` (queue.ts) quando una ripresa in background muore
senza produrre nulla scrive una riga `_…_` nel thread (la «ripresa che muore
senza dirlo», v. `CHANGELOG.md:4574`), e i goal notice in forma vecchia
portano `_…_`. Resultato: gli underscore crudi a schermo, nel caso
evidenziato dall'utente («La ripresa in background non è partita — …»).

Ora: `renderMd` rende `_…_` in `<em>`. Le guard sono parola-per-parola
(lookbehind/lookahead `[\w]`), così `foo_bar_baz` resta intatto e `_…_` non
ruba testo dentro identificatori. Il filtro sta dopo `__…__` → `<strong>`:
il bold ha sempre la precedenza.

Decisioni:

- **Guard a confini di parola, non regex ingorda.** Il markdown di CommonMark
  esclude underscore intraparo; senza guard, codici e slug del testo del
  modello (`run_seo_geo_audit`, `foo_bar_baz`) diventerebbero corsivo spezzato.
- **Niente post-processing tipo goal-status.** `splitGoalStatus` converte
  `_…_` in `*…*` perché il suo paragrafo vive anche nel transcript del modello
  e nella CLI. In chat il testo può essere reso direttamente: un fix nel
  renderer è più in basso e serve ogni surface che passa da `renderMd`
  (chat globale, thread, editor del post, pannello goal).
- **Test a tre quase:** notice del server in corsivo vero, snake_case
  intatto, `__…__` ancora bold (non doppio consumo).
