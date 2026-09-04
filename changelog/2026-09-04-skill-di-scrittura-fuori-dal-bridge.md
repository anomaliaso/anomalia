# `get_writing_skills` — il mestiere esce dal bridge prima che il bridge sparisca

## La regressione che stava per succedere in silenzio

`src/lib/agent-docs/skills/` contiene `humanizer`, `stop-slop`, `social` (con `platform-limits`,
`carousel-frameworks`, `listening`, e altri sei riferimenti) e `seo-audit`: 145 KB su 17 file.
**Sono il motivo per cui i testi non suonano da chatbot.**

Raggiungevano un modello per una strada sola:

```
agent-docs/skills/*.md → brand-skills.ts (?raw) → skillsForAgent() → adapters.ts:421 → harness
                                                                     ↑
                                                          UNICO chiamante, dentro il bridge
                                                          che stiamo cancellando
```

Cancellato quel file, il mestiere smette di arrivare a qualsiasi modello. Nessuna eccezione,
nessun test rosso, nessun errore nei log: la qualità della copy scende e basta. È la stessa forma
della regressione dei motion video.

Un test lo agganciava — `brand-skills.test.ts:116` fa
`expect(src).toMatch(/skillsForAgent\(opts\.agentId\)/)` — ma è appeso al **bridge**: chi cancella
il bridge cancella anche quell'asserzione, legittimamente, e la strada resta chiusa lo stesso.

## Cosa è stato verificato prima di decidere

**Le skill del brand non esistono in `brand-skills.ts`.** Il nome inganna: `brandSkills` è un
array `const` di quattro markdown importati con `?raw`, uguali per ogni brand. La selezione che fa
`skillsForAgent` è **per agente del team** (`content`, `ugc`, `web`, `analyst`, `auto`, `motion`),
non per brand. Impacchettarle una volta per tutte è corretto.

**Le skill del brand esistono altrove, e nessuno le serviva.** La migrazione 0178 le ha messe in
`brand_memory` con `category = 'skill'`: markdown la cui prima riga è il trigger, scritte
dall'operatore o distillate da `runDream` quando trova tre lezioni sulla stessa procedura. La
rotta `/studio/memory?category=skill` esiste ma **non è nel registry**, quindi via MCP non c'è
nessun tool: un agente esterno non poteva leggere le procedure del brand in nessun modo.
Sono nella stessa risposta, distinte da `source`.

## La strada scelta, e le due scartate

**Un tool del registry** (`get_writing_skills`), non file spediti col pacchetto skill, non risorse
MCP.

- **Scartato: copiarle in `cli/skills/anomalia/`.** Il pacchetto skill oggi è 47 KB di
  *istruzioni operative* (quale tool chiamare); le skill di scrittura sono 145 KB di *mestiere*:
  triplicherebbero un pacchetto che ogni utente Claude Code carica — e ChatGPT e Cursor, che sono
  metà del pivot e si collegano **solo** via MCP, non lo vedrebbero mai. Servirebbe anche un
  secondo mirror da tenere allineato.
- **Scartato: risorse MCP.** È la primitiva giusta sulla carta, ma il supporto alle risorse è
  disomogeneo fra i client, e uscirebbe dal registry a `registerTool` scritti a mano.
- **Scelto: un tool.** Ogni client MCP supporta i tool. Una sorgente sola — i file restano
  l'unica copia — e la stessa risposta per Claude, ChatGPT e Cursor.

## Come sta dentro una finestra

145 KB in una risposta sono inutilizzabili. La stessa divulgazione progressiva che il formato
skill usa già:

- il **corpo** di ogni `SKILL.md` del mazzo arriva inline (mazzo predefinito ~33 KB, `content`
  ~48 KB — che è esattamente quello che l'agente interno portava a ogni turno);
- i **riferimenti** sono elencati per percorso e non spediti; se ne chiede uno con
  `reference: "social/references/platform-limits.md"` e torna quello solo, senza il mazzo.

Nessun taglio dei corpi: troncare il mestiere è precisamente la regressione da evitare.

## Perché il modello lo chiamerà

Un tool che nessuno chiama non serve a niente. Tre posti lo dicono:

- la **descrizione** del tool comincia con `READ THIS BEFORE WRITING ANY COPY` (un test verifica
  che continui a dirlo);
- `cli/skills/anomalia/SKILL.md` lo mette fra le **regole operative**, non fra i workflow;
- il workflow "Before you write anything" ora ha due letture: `get_writing_skills` (**come**
  scrivere) e `get_creation_kit` (**cosa** dire).

## Il test che rimpiazza quello appeso al bridge

`ogni skill di prodotto raggiunge un modello per una strada che non passa dal bridge`: gira i sei
mazzi e pretende che l'unione copra **tutte** le skill in `brandSkills`. Cancellare
`adapters.ts` non lo tocca — la conoscenza continua ad arrivare. Cancellare una skill, o rompere
la rotta, lo fa diventare rosso.

## Cosa non è stato toccato

`skillsForAgent` **non è stata spostata** e il suo unico chiamante nel bridge è intatto. È stata
solo estratta `brandSkillsForAgent` — le sole skill di prodotto, senza toccare il disco — in un
commit separato senza cambi di comportamento, come vuole la regola: prima si riordina, poi si
aggiunge.
