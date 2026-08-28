# Post — Guida all'editing

Il comando `post` permette di gestire singoli post: modificare, approvare, pubblicare, riprogrammare, eliminare.

## Visualizzare un post

```bash
anomalia post my-brand <post-id>
```

Mostra tutti i dettagli del post: platform, status, caption, pillar, format, slot, product.

## Modificare un post

### Caption

```bash
anomalia post my-brand <post-id> edit --caption "Nuovo testo della caption"
```

### Prompt immagine

```bash
anomalia post my-brand <post-id> edit --imagePrompt "Un caffè artigianale su sfondo chiaro"
```

### Piattaforme

```bash
anomalia post my-brand <post-id> edit --platforms "instagram,facebook"
```

### Tipo contenuto

```bash
anomalia post my-brand <post-id> edit --contentType carousel
```

### Data/ora

```bash
anomalia post my-brand <post-id> edit --slot "2026-06-20T10:00"
```

### Prodotto associato

```bash
anomalia post my-brand <post-id> edit --product "Pizza Margherita"
```

### Modifiche multiple

```bash
anomalia post my-brand <post-id> edit \
  --caption "Nuovo testo" \
  --platforms "instagram" \
  --slot "2026-06-20T10:00"
```

## Approvare un post

```bash
anomalia post my-brand <post-id> approve
```

Approva il post e lo schedula per la pubblicazione tramite Zernio.

## Pubblicare immediatamente

```bash
anomalia post my-brand <post-id> publish
```

Pubblica il post subito, indipendentemente dallo scheduling.

## Riprogrammare

```bash
anomalia post my-brand <post-id> reschedule --scheduledFor "2026-06-20T10:00"
```

Cancella lo scheduling esistente e programma il post per la nuova data.

## Eliminare un post

```bash
anomalia post my-brand <post-id> reject
```

Elimina il post. Funziona solo per post con status `pending_user`.

## Uso con AI

Tutte queste operazioni possono essere fatte anche tramite il comando `ai`:

```bash
# Modifica caption
anomalia ai my-brand --message "Riscrivi la caption del post <id> in modo più breve"

# Approva
anomalia ai my-brand --message "Approva il post <id>"

# Riprogramma
anomalia ai my-brand --message "Sposta il post <id> a domani alle 10"
```

## ID del post

L'ID del post si ottiene da:
- `anomalia content my-brand` — lista tutti i post con ID
- `anomalia ai my-brand --message "Quali sono gli ultimi post?"` — l'AI li elenca
- Dashboard web — click su un post per vedere l'ID
