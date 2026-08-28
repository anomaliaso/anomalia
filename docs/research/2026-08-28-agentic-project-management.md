# APM (Agentic Project Management) — cosa può servire ad Anomalia

Data: 2026-08-28 · Task #8 · Riferimento: https://github.com/sdi2200262/agentic-project-management (MPL-2.0, ~2.4k star)

## Cos'è

Framework spec-driven per progetti complessi con assistenti AI. Tre ruoli specializzati, ognuno
nel proprio contesto:

- **Planner** — discovery strutturata, produce tre documenti (Spec / Plan / Rules).
- **Manager** — coordina l'esecuzione: assegna Task ai Worker, revisiona, mantiene lo stato.
- **Workers** — eseguono task nel loro dominio (frontend, backend, …), validano, scrivono in
  memoria di progetto, riportano al Manager.

Il punto dichiarato del progetto: i Worker NON ripartono freschi a ogni task — accumulano
conoscenza di dominio tra assegnazioni; quando il contesto si riempie, un **Handoff** strutturato
trasferisce il know-how a una nuova istanza invece di buttarlo.

## Differenza strutturale con Anomalia

APM è **human-in-the-loop**: l'utente media OGNI scambio fra agenti (lui lancia i comandi nella
conversazione giusta). È una scelta dichiarata di trasparenza — ogni assegnazione passa per
l'umano. Anomalia è l'opposto per costruzione: autopilot, la squadra agisce e l'utente decide.
**Il framework non è adottabile come orchestratore; al massimo sono adottabili dei principi.**

## Principi riutilizzabili (e cosa ne abbiamo già)

| Principio APM | Stato in Anomalia |
|---|---|
| Ruoli per dominio, contesto separato | ✅ Già nostro: 5 specialisti + thread per agente; i subagent girano in contesti puliti |
| Worker persistenti che accumulano conoscenza di dominio | ✅ Team thread = diario permanente; brand memory condivisa; per-agent skills (PR #27) |
| Stato fuori dal contesto (documenti, non chat) | ✅ In parte: brand kit, editorial plan, goal criteria, memory. Da difendere: niente stato importante solo nei transcript |
| Handoff strutturato quando il contesto si riempie | 🟠 Noi abbiamo compaction automatica del thread; l'Handoff esplicito "portami avanti le conclusioni" non esiste come protocollo — la compaction fa già gran parte del lavoro |
| Assegnazioni come brief autosufficienti | ✅ Regola già scritta nel prompt ("Write briefs that stand alone") |
| Report dopo ogni task (lavoro fatto vs dichiarato) | ✅ Nostro: read-back/verify nel WORK ETHIC, report nel diario a fine routine |

## Cosa NON prendere

- **Il Manager come ruolo separato che assegna task**: il nostro equivalente è già distribuito —
  l'Analyst dirige, il goal mode coordina, la coda esegue. Un coordinatore centrale aggiungerebbe
  un bottleneck e un contesto che invecchia.
- **La mediazione umana di ogni scambio**: svuota il prodotto del suo valore.
- **I tre documenti planner (Spec/Plan/Rules)**: GTM plan + goal criteria li coprono già in forma
  di prodotto.

## Conclusione

Nessun codice da importare. I due principi che valgono (contesto separato per mestiere; stato
durable fuori dal contesto) sono già architettura nostra — la task #8 li rafforza sul lato
comportamentale. L'unico lasso da tenere d'occhio: l'**Handoff esplicito** — se i thread lunghi
mostreranno perdite che la compaction non recupera, è il pezzo di APM a cui tornare.
