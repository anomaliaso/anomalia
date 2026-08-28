# Studio — Guida completa

Lo Studio è la knowledge base del brand. Contiene tutte le informazioni che l'AI usa per generare contenuti.

## Visualizzare lo Studio

```bash
bun run cli.ts studio my-brand
```

Mostra:
- Completeness score (0-100%)
- Brand kit (categoria, about, audience)
- Prodotti
- Persone (reali e AI)
- Competitors
- Knowledge (note, documenti, immagini)

## Brand Kit

Il brand kit contiene le informazioni fondamentali del brand.

### Aggiornare il brand kit

```bash
bun run cli.ts studio my-brand kit-update \
  --about "Siamo un ristorante italiano specializzato in cucina fusion" \
  --category "Ristorante" \
  --audience "Giovani professionisti 25-35 anni, appassionati di food" \
  --style "Minimalista e moderno" \
  --language it
```

Tutti i parametri sono opzionali — puoi aggiornare solo i campi che vuoi:

```bash
# Aggiorna solo la lingua
bun run cli.ts studio my-brand kit-update --language it

# Aggiorna solo l'audience
bun run cli.ts studio my-brand kit-update --audience "Famiglie con bambini"
```

### Imposta colori brand

```bash
bun run cli.ts studio my-brand colors --colors "#7c5cff,#ffffff,#1a1a1a"
```

- Massimo 8 colori
- Formato hex: `#rgb` o `#rrggbb`
- Separati da virgola

## Persone

Le persone possono essere reali o generate dall'AI.

### Aggiungi persona reale

```bash
bun run cli.ts studio my-brand people-add \
  --name "Marco Rossi" \
  --role "CEO" \
  --description "Fondatore dell'azienda, appassionato di innovazione"
```

### Genera persona AI

```bash
bun run cli.ts studio my-brand people-generate \
  --name "Sofia" \
  --role "Influencer fitness" \
  --gender female \
  --ageRange 26-35 \
  --ethnicity "mediterranea" \
  --vibe professional \
  --description "Personal trainer con passione per il wellness"
```

Parametri per la generazione AI:
- `--gender`: `female`, `male`, `non-binary` (opzionale)
- `--ageRange`: `18-25`, `26-35`, `36-50`, `50+` (opzionale)
- `--vibe`: `professional`, `casual`, `luxury`, `sporty`, `creative`, `natural` (opzionale)
- `--ethnicity`: qualsiasi stringa (opzionale)

### Elimina persona

```bash
bun run cli.ts studio my-brand people-delete --id <uuid>
```

L'ID si ottiene dalla lista dello studio (`studio my-brand` mostra gli ID troncati).

## Knowledge

La knowledge base contiene note, documenti e immagini che l'AI usa come contesto.

### Aggiungi nota

```bash
bun run cli.ts studio my-brand add-note \
  --title "Tone of voice" \
  --text "Siamo amichevoli ma professionali. Evitiamo il linguaggio troppo formale. Usiamo emoji con moderazione."
```

### Aggiungi nota (senza titolo)

```bash
bun run cli.ts studio my-brand add-note --text "Il nostro prodotto principale è la pizza gourmet."
```

Il titolo default è "Note".

### Elimina documento

```bash
bun run cli.ts studio my-brand delete-doc --id <uuid>
```

## Competitors

### Aggiungi competitor manualmente

```bash
bun run cli.ts studio my-brand add-competitor \
  --name "RivalCo" \
  --website "rivalco.com" \
  --compKind direct \
  --rationale "Compete nel nostro stesso segmento di mercato"
```

- `--compKind`: `direct` (default) o `indirect`
- `--website`: opzionale, viene normalizzato con `https://`
- `--rationale`: opzionale

### Ricerca competitor con AI

```bash
bun run cli.ts studio my-brand research
```

L'AI:
1. Analizza il brand (nome, categoria, prodotti, audience)
2. Cerca competitor online
3. Deduplica con quelli esistenti
4. Aggiunge i nuovi con `source: ai`

### Elimina competitor

```bash
bun run cli.ts studio my-brand delete-competitor --id <uuid>
```

## Sync Storico Post

Sincronizza i post pubblicati dai social accounts collegati:

```bash
bun run cli.ts studio my-brand sync-history
```

- Recupera i post da Instagram, TikTok, Facebook, etc.
- Aggiorna la tabella `social_post_history`
- Ricostruisce il contesto del brand

## Completeness Score

Il completeness score indica quanto è completo il brand kit:

| Score | Significato |
|-------|-------------|
| 80-100% | Eccellente — l'AI ha tutti i dati necessari |
| 50-79% | Buono — mancano alcuni dettagli |
| 0-49% | Incompleto — aggiungi più informazioni |

Il score è calcolato su 8 fattori:
1. Prodotti (3+ = pieno)
2. Storico post (synced)
3. Voice/Tone (definito)
4. About (presente)
5. Audience (presente)
6. Logo (presente)
7. Colori (presenti)
8. Knowledge (documenti)
