# AI Chat — Guida

Il comando `ai` ti permette di chattare con l'AI di Anomalia direttamente dalla CLI. Può fare tutto ciò che fa il chatbot nella dashboard web.

## Uso base

```bash
anomalia ai my-brand --message "Il tuo messaggio"
```

## Esempi per categoria

### Analisi

```bash
# Analizza i post
anomalia ai my-brand --message "Analizza i miei ultimi 10 post e dimmi quali funzionano meglio"

# Benchmark competitor
anomalia ai my-brand --message "Confronta la mia strategia con i competitor"

# Suggerimenti
anomalia ai my-brand --message "Cosa posso migliorare nella mia strategia di contenuto?"
```

### Modifiche brand

```bash
# Brand kit
anomalia ai my-brand --message "Cambia la descrizione del brand in 'Ristorante fusion italiano'"
anomalia ai my-brand --message "Aggiorna il target audience a 'giovani professionisti 25-35'"

# Colori
anomalia ai my-brand --message "Imposta i colori del brand a #7c5cff e #ffffff"

# Voice
anomalia ai my-brand --message "Cambia il tone a friendly e professionale"
anomalia ai my-brand --message "Aggiungi 'costoso' alle parole vietate"
```

### Modifiche contenuto

```bash
# Caption
anomalia ai my-brand --message "Riscrivi la caption dell'ultimo post in modo più breve"
anomalia ai my-brand --message "Rendi la caption più emozionale"

# Approvazione
anomalia ai my-brand --message "Approva tutti i post pending"
anomalia ai my-brand --message "Approva il post con caption '...'"

# Scheduling
anomalia ai my-brand --message "Sposta il prossimo post a lunedì alle 10"
anomalia ai my-brand --message "Pubblica subito il post più recente"
```

### Strategia

```bash
# Piano editoriale
anomalia ai my-brand --message "Cambia il tema della settimana 2 a 'dietro le quinte'"
anomalia ai my-brand --message "Aumenta la frequenza a 5 post a settimana"
anomalia ai my-brand --message "Aggiungi LinkedIn al platform mix"

# GTM
anomalia ai my-brand --message "Cambia l'obiettivo GTM a 'aumentare le vendite online'"
anomalia ai my-brand --message "Aggiorna i KPI della fase corrente"
```

### Studio

```bash
# Competitor
anomalia ai my-brand --message "Aggiungi competitor Notion e Asana"
anomalia ai my-brand --message "Ricerca nuovi competitor"

# Prodotti
anomalia ai my-brand --message "Aggiorna il prezzo della Pizza Margherita a €14"

# Persone
anomalia ai my-brand --message "Aggiungi Marco come CEO del brand"

# Conoscenza
anomalia ai my-brand --message "Aggiungi una nota: il nostro pubblico preferisce video brevi"
```

## Pipe mode (per agenti AI)

Quando usi la CLI da un agente AI o in un pipeline, usa `--pipe` per output raw:

```bash
# Input da pipe
echo "Analizza i miei post" | anomalia ai my-brand --pipe

# Output raw (senza formattazione)
anomalia ai my-brand --message "Riassumi il brand" --pipe

# In uno script
response=$(anomalia ai my-brand --message "Quali sono i KPI?" --pipe)
echo "$response"
```

## Come funziona internamente

1. La CLI invia il messaggio a `POST /app/{slug}/chat`
2. Il backend costruisce il system prompt con tutti i dati del brand
3. L'AI (Gemini 3.5 Flash) risponde usando i suoi tools (read/write)
4. La risposta viene streamata alla CLI
5. Se l'AI esegue un'azione (es. modifica un post), i dati vengono aggiornati nel DB

## Limiti

- Le operazioni async (ricerca competitor, sync social, generazione persone AI) richiedono più tempo e possono non completarsi in una singola chiamata
- Per operazioni complesse, usa i comandi CLI dedicati (`anomalia studio`, `anomalia post`, etc.)
- L'AI ha accesso in lettura/scrittura a tutti i dati del brand

## Suggerimenti

- Sii specifico nei messaggi per risultati migliori
- Puoi fare riferimento a post, prodotti, persone per nome
- L'AI ricorda il contesto della conversazione (ultimi 50 messaggi)
- Usa `anomalia ai my-brand --message "aiuto"` per vedere cosa può fare
