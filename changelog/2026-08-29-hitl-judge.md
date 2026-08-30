# 2026-08-29 — HITL action judge

## Perché

Il gate dei tool distingue ora le azioni conseguenziali dalle letture. Prima ogni tool passava
dalla stessa decisione binaria e non c'era un punto comune per l'auto-review.

## Decisioni

- `ToolSpec` richiede una classificazione esplicita `consequential`.
- `planActionGate` conserva le regole esplicite: `ask` e `allow` vincono sempre.
- Il percorso di default diventa `judge` solo per azioni conseguenziali con auto-review e checker.
- Un checker che fallisce restituisce `ask` per un'azione conseguenziale; l'executor non viene
  chiamato.
- Il bridge live e il worker in coda costruiscono il checker sullo stesso transcript; il flag
  `CHAT_ACTION_JUDGE=on` abilita il controllo senza duplicare la classificazione.
- Il gate vive nel kit e la traduzione verso l'AI SDK resta nell'adapter, senza una seconda
  classificazione nei plugin.
