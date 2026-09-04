# Quick Reference — Anomalia CLI

## Comandi rapidi

```bash
# Panoramica
anomalia brands                              # Lista brand
anomalia dashboard <slug>                    # Dashboard completa
anomalia status <slug>                       # Status dettagliato

# Contenuti
anomalia content <slug>                      # Tutti i post
anomalia content <slug> --status pending     # Solo pending
anomalia approve <slug> --all                # Approva tutti

# Post (editing)
anomalia post <slug> <id>                    # Dettaglio post
anomalia post <slug> <id> edit --caption "..."  # Modifica caption
anomalia post <slug> <id> approve            # Approva
anomalia post <slug> <id> reject             # Elimina
anomalia post <slug> <id> publish            # Pubblica ora
anomalia post <slug> <id> reschedule --scheduledFor "2026-06-20T10:00"

# Piano editoriale
anomalia plan <slug>                         # Visualizza
anomalia plan <slug> propose                 # Genera primo piano
anomalia plan <slug> approve                 # Approva proposta
anomalia plan <slug> discard                 # Scarta proposta
anomalia plan <slug> revise --feedback "..." # Richiedi revisione
anomalia plan <slug> save-brief --week 0 --brief "..."
anomalia plan <slug> replan --week 0 --brief "..."

# Piano settimanale
anomalia weekly-plan <slug>                  # Visualizza
anomalia weekly-plan <slug> plan --week 0    # Genera seeds
anomalia weekly-plan <slug> produce --week 0 # Produci post

# GTM
anomalia gtm <slug>                          # GTM Roadmap

# Voice
anomalia voice <slug>                        # Voice rules

# AI Chat
anomalia ai <slug> --message "..."           # Chatta con l'AI
echo "..." | anomalia ai <slug>             # Pipe mode

# Analytics
anomalia analytics <slug>                    # Analytics
anomalia calendar <slug>                     # Calendario
anomalia calendar <slug> --month 2026-07     # Mese specifico

# Studio
anomalia studio <slug>                       # Mostra tutto
anomalia studio <slug> kit-update --about "..."
anomalia studio <slug> colors --colors "#hex,#hex"
anomalia studio <slug> add-note --text "..."
anomalia studio <slug> people-add --name "..."
anomalia studio <slug> people-generate --name "..." --gender female
anomalia studio <slug> add-competitor --name "..."
anomalia studio <slug> research              # Ricerca AI
anomalia studio <slug> sync-history          # Sync social

# Web / SEO / GEO
anomalia seo <slug>                          # Grade, iniziative, audit
anomalia seo <slug> run|plan|more            # Audit / piano / altre iniziative
anomalia seo <slug> asset|article --id <id>  # Genera da un'iniziativa
anomalia geo <slug>                          # Share of voice, citazioni
anomalia geo <slug> run|fix                  # Audit / genera fix
anomalia keywords <slug> [refresh]           # Keyword strategy
anomalia web <slug> [--status draft]         # Articoli blog
anomalia web <slug> generate --topic "..."   # Nuovo articolo
anomalia web <slug> optimize|publish --id <id>
anomalia ads <slug>                          # Campagne + metriche paid
anomalia ads <slug> --propose                # Proposte boost dai top post
anomalia ads <slug> --remix                  # Remix competitor ads → brief creativi
anomalia ads <slug> --approve <id> [--budget N]
anomalia ads <slug> --pause <id>             # Pausa campagna (tutte le creatività)
anomalia ads <slug> --resume <id>            # Riattiva campagna
anomalia ads <slug> --pause <id> --ad <adId> # Pausa UNA creatività (A/B)
anomalia ads <slug> --resume <id> --ad <adId>
anomalia ads <slug> --duplicate <id>          # Copia in pausa → nuova proposta
anomalia ads <slug> --delete <id>             # Elimina sulla piattaforma (storico ok)
anomalia ads <slug> --create --name "..." --headline "..." [--platform metaads|googleads]
```

## Status post

| Status | Colore | Significato |
|--------|--------|-------------|
| `pending_user` | 🟡 Giallo | In attesa di approvazione |
| `approved` | 🔵 Blu | Approvato, in attesa di scheduling |
| `scheduled` | 🟢 Verde | Schedulato per pubblicazione |
| `published` | 🟢 Verde | Pubblicato |
| `failed` | 🔴 Rosso | Pubblicazione fallita |

## Pipeline autopilot

```
● Ricerca ─ ◉ Strategia ─ ○ Generazione ─ ○ Pubblicazione ─ ○ Analisi
```

- `●` Completato
- `◉` Fase corrente
- `○` Futuro

## Score completeness

| Score | Stato |
|-------|-------|
| 80-100% | Eccellente |
| 50-79% | Buono |
| 0-49% | Incompleto |
