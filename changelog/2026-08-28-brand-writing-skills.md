# Skill di scrittura di brand sempre nell'agente chat

## Perché

Il prodotto di Anomalia è testo che parla per un brand, e il testo che sa di
chatbot è un difetto di qualità che i test non vedono (i modelli finto-agente
non giudicano la prosa). Le valutazioni misurano fatti, non slop: serve una
barra strutturale dentro il modello, non una regola di stile nel prompt.

## Cosa

Tre candidate valutate da skills.sh, vendorate in `src/lib/agent-docs/skills/`
e cucite direttamente in `HarnessAgent` (`skills: []`) dentro `startHarnessTurn`:

- **humanizer** (blader/humanizer, MIT, v2.11.2) — 28 pattern di AI-writing da
  Wikipedia "Signs of AI writing", con procedura di rewrite che preserva i
  claim. Modalità revisione.
- **stop-slop** (hardikpandya/stop-slop, MIT) — regole di generazione:
  struttura, ritmo, false agency, attivo. Modalità stesura. I riferimenti
  (`phrases.md`, `structures.md`, `examples.md`) viaggiano come `files` della
  skill, come da contratto `HarnessV1Skill`.
- **understand-anything** (egonex-ai) — scartata: nove skill di comprensione
  codice per agenti di coding, fuori dal dominio dei brand e già coperte nel
  repo dalle nostre skill.

## Decisioni

- Sempre attive, senza varco: il gate `HARNESS_SKILLS` resta per le skill del
  repo (default off perché pensate per agenti di codice); queste due sono
  brand-facing e viaggiano al di fuori della selezione.
- I markdown restano file veri inlineati con `?raw` (pattern già in uso in
  `agent-files.ts`): diffabili contro upstream, niente 43KB in template
  literal dove backtick e `${` sono mine sul percorso.
- Il frontmatter passa da `parseSkillFrontmatter` — un solo parser, due usi.
