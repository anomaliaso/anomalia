# 2026-08-28 — `z.literal(true)` nei tool schema: Gemini rifiuta il toolset intero

## Il difetto (misurato in locale, 28/8/2026)

Turno accodato del Content Creator fallito prima di chiamare il modello:

```
Invalid value at 'tools[0].function_declarations[59].parameters
  .properties[5].value.enum[0]' (TYPE_STRING), true
```

Colpevole: `update_person` (catalog-tools.ts) dichiarava `consent: z.literal(true)`. La
conversione zod→JSON schema dell'SDK produce `enum: [true]` — e Gemini pretende enum di sole
stringhe. Non un turno perso: l'INTERO toolset rifiutato, quindi qualunque turno che monti
`update_person` (content, ugc, motion, web, analyst) moriva così.

## Fix

`consent: z.boolean()` con descrizione esplicita ("true ONLY when the USER has just stated…").
Il semantica era già "solo `true` fa qualcosa" (l'execute guarda `consent === true`); ora lo dice
anche lo schema in un formato che il provider accetta.

## Guardia

`src/lib/server/chat/tool-schema.test.ts` monta il toolset completo di ogni agente e passa gli
schema zod in cerca di enum con valori non-stringa. Riprodurrebbe il difetto il giorno in cui un
altro `z.literal(non-stringa)` entra in un tool.
