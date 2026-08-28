# Piano Editoriale — Guida completa

Il piano editoriale è il cuore della strategia di contenuto. Definisce cosa pubblicare, quando, dove e con quale tono.

## Panoramica

Il piano editoriale ha 3 livelli:

```
Strategia (piano editoriale)
  └── Piano settimanale (seeds)
       └── Contenuti (post)
```

**Strategia** → definisce voice, cadenza, platform mix, 4 settimane con temi
**Piano settimanale** → genera seeds (righe) per ogni settimana
**Contenuti** → produce i seeds in post reali

## Visualizzare il piano

```bash
anomalia plan my-brand
```

Mostra:
- Piano proposto (se presente) con le modifiche suggerite
- Cadenza (3/week, 5/week, daily)
- Settimana corrente
- Voice (mood, tone, goal)
- Platform mix con percentuali
- Strategia completa
- 4 settimane con tema, focus, content mix, rationale, brief

## Lifecycle completo

### 1. Generare il primo piano

Per brand senza piano attivo:

```bash
anomalia plan my-brand propose
```

L'AI analizza il brand kit, i prodotti, lo storico post e i competitor per generare un piano a 4 settimane.

### 2. Visualizzare e valutare

```bash
anomalia plan my-brand
```

Se c'è un piano proposto, mostra:
- Le modifiche suggerite (`changes_summary`)
- Il feedback originale (se era una revisione)
- Il piano completo in anteprima

### 3. Approvare o scartare

```bash
# Approva — il piano diventa attivo
anomalia plan my-brand approve

# Scarta — il piano viene rifiutato
anomalia plan my-brand discard
```

### 4. Richiedere una revisione

Se vuoi modificare il piano senza riscriverlo da zero:

```bash
anomalia plan my-brand revise --feedback "Voglio più behind-the-scenes e meno promozionale"
```

L'AI produce un nuovo piano proposto con le modifiche. Poi approvi o scarti.

Puoi anche usare l'AI chat per feedback più naturali:

```bash
anomalia ai my-brand --message "Voglio più focus su Instagram e meno su TikTok"
anomalia ai my-brand --message "Aumenta la frequenza a 5 post a settimana"
anomalia ai my-brand --message "Aggiungi LinkedIn al platform mix"
```

### 5. Salvare un brief per una settimana

Ogni settimana può avere un brief utente che guida la generazione dei contenuti:

```bash
anomalia plan my-brand save-brief --week 0 --brief "Mostra il processo creativo del brand"
anomalia plan my-brand save-brief --week 1 --brief "Focus sui prodotti nuovi"
anomalia plan my-brand save-brief --week 2 --brief "Behind the scenes e persone del team"
anomalia plan my-brand save-brief --week 3 --brief "User generated content e testimonianze"
```

Il brief viene salvato senza rigenerare nulla.

### 6. Rigenerare una settimana

Se vuoi rigenerare una settimana specifica con un nuovo brief:

```bash
anomalia plan my-brand replan --week 0 --brief "Dietro le quinte del brand"
```

L'AI ricostruisce solo quella settimana, mantenendo le altre 3 invariate.

### 7. Modificare inline via AI

```bash
# Cambia tema settimana
anomalia ai my-brand --message "Cambia il tema della settimana 2 a 'dietro le quinte'"

# Cambia voice
anomalia ai my-brand --message "Cambia il tone a friendly e casuale"

# Cambia cadenza
anomalia ai my-brand --message "Aumenta la frequenza a 5 post a settimana"

# Cambia platform mix
anomalia ai my-brand --message "Dai più peso a Instagram (60%) e meno a TikTok (40%)"
```

## Piano Settimanale (Seeds)

Una volta che il piano editoriale è attivo, ogni settimana ha dei "seeds" — righe che definiscono cosa pubblicare.

### Visualizzare i seeds

```bash
anomalia weekly-plan my-brand
anomalia weekly-plan my-brand --week 2
```

Mostra:
- Week navigator (W1, W2, W3, W4 con tema)
- Settimana corrente con tema
- Post già generati con status
- Seeds in attesa con platform, format, pillar, angle
- Quota mensile

### Generare seeds per una settimana

```bash
anomalia weekly-plan my-brand plan --week 0
```

L'AI genera le righe (seeds) per la settimana, basandosi su:
- Piano editoriale (tema, focus, content mix)
- GTM phase (platform weights)
- Prodotti e persone del brand
- Brief utente (se presente)

### Produrre i seeds in post

```bash
# Produci tutti i seeds
anomalia weekly-plan my-brand produce --week 0

# Produci singolo seed via AI
anomalia ai my-brand --message "Produci solo il primo seed della settimana"
```

Ogni seed diventa un post reale con caption, immagine e scheduling.

### Modificare i seeds via AI

```bash
# Cambia platform di un seed
anomalia ai my-brand --message "Cambia il primo seed da Instagram a TikTok"

# Cambia format
anomalia ai my-brand --message "Cambia il formato del secondo seed da post a carousel"

# Aggiungi un seed
anomalia ai my-brand --message "Aggiungi un reel per venerdì alle 18"

# Rimuovi un seed
anomalia ai my-brand --message "Rimuovi il seed del weekend"
```

## Struttura del piano

Ogni piano editoriale contiene:

| Campo | Descrizione |
|-------|-------------|
| `strategy` | Dichiarazione strategica (2-4 frasi) |
| `voice` | `{ mood, tone, goal, personality }` |
| `cadence` | `3/week`, `5/week`, `daily` |
| `platform_mix` | `[{ platform, share, role }]` |
| `gtm` | Sezione go-to-market (stage, summary, platform_recs, plays) |
| `weeks` | 4 settimane con theme, focus, content_mix, rationale, brief |

Ogni settimana:

| Campo | Descrizione |
|-------|-------------|
| `theme` | Tema della settimana |
| `focus` | Focus specifico |
| `content_mix` | `[{ type, count }]` — es. 2 post, 2 reel, 1 carousel |
| `rationale` | Motivo della scelta |
| `brief` | Brief utente (opzionale) |
| `status` | `upcoming`, `planned`, `done` |

## Stati del piano

| Stato | Significato |
|-------|-------------|
| `proposed` | In attesa di approvazione |
| `active` | Piano corrente |
| `superseded` | Sostituito da un nuovo piano |
| `rejected` | Scartato |

## Storico

Ogni piano sostituito viene conservato. Puoi vedere lo storico con:

```bash
anomalia ai my-brand --message "Mostrami lo storico dei piani editoriali"
```

## Combinazione con altri comandi

```bash
# 1. Configura il brand
anomalia studio my-brand kit-update --about "..." --audience "..."
anomalia studio my-brand add-note --text "Il nostro pubblico preferisce video brevi"

# 2. Definisci la strategia
anomalia plan my-brand propose
anomalia plan my-brand approve

# 3. Genera i contenuti
anomalia weekly-plan my-brand plan --week 0
anomalia weekly-plan my-brand produce --week 0

# 4. Rivedi e approva
anomalia content my-brand --status pending_user
anomalia approve my-brand --all

# 5. Analizza i risultati
anomalia analytics my-brand
```
