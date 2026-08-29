# Kill crons raccolta mercato (`market/harvest`, `market/trends`)

## Perché

Audit budget #1 (30 lug → 29 ago, dati reali da `ai_calls`):

- I due crons sono la **raccolta di mercato di piattaforma**: discovery di
  post virali per categoria + sweep delle tendenze + baseline degli account
  (storico profili via scrapecreators). È la fonte della sorpresa #2
  dell'audit: **$26.2/30d di chiamate scrape senza brand** (13.367 call —
  il 65% della spesa scrapecreators), in crescita 4× in un mese (824 →
  9.180 call/settimana).
- Il consumo a valle si è ridotto col tempo: il wall pubblico è spento, e
  field watch / brief di mercato / reference motion leggono lo stock in
  `market_posts`, che resta disponibile.
- Decisione del product owner (2026-08-29): bloccare entrambi.

## Cosa è stato fatto

Solo i due crons commentati in `vercel.json` (JSONC). Nessun codice toccato,
nessun dato cancellato: lo stock in `market_posts` e le rotte REST restano —
un re-run manuale o un decommentare è il revert completo.

Non toccato di proposito: `market/field` (la distillazione dei dati già
raccoti per le pagine brand, costo AI $0.55/30d) e i label AI on-demand.

## Scartato

- Spegnerli con un flag nel codice: due crons sono config di deploy, non
  logica — il registro giusto è `vercel.json`, coerente con i kill
  SEO/GEO (PR #49).
