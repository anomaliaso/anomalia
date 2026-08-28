# 2026-08-28 — Delegare è parte del mestiere

## Perché

La task #8 chiede agenti proattivi nel lavoro di squadra: chi ha un compito che contiene un
pezzo di un altro mestiere deve girarlo al collega senza aspettare l'ordine, e condividere con
la squadra le nozioni che le servono. Il meccanismo esisteva già (`message_agent`,
`open_session_with_user`); mancava il comportamento e una misura.

## Cosa c'era prima

- `ORCHESTRATION_BLOCK` descriveva la differenza sub-agent/colleagues ma non imponeva mai la
  proattività: la delega partiva solo se l'utente (o il brief) la chiedeva.
- `message_agent` rifiutava il fan-out (N destinatari) senza `because_user_asked`, anche quando
  chi chiamava stava eseguendo un obiettivo aperto che richiedeva più mestieri.
- Nessun fatto nell'eval:ux misurava la delega.

## Decisioni

- **Prompt-layer prima, tool dopo** (scelta di design): la regola nuova sta in
  `ORCHESTRATION_BLOCK` — "PROACTIVE BY DEFAULT": il pezzo di altro mestiere si gira con UNA riga
  di `message_agent`, e la nozione che serve a un collega parte in DM (e in `add_memory` se deve
  sopravvivere al turno). Nessun trasporto nuovo: se l'eval mostra che il modello non lo fa, si
  valuta un tool dedicato in una task futura.
- **Fan-out sbloccato dall'obiettivo, non dal buon cuore**: con un goal aperto sul thread il
  fan-out passa senza `because_user_asked` — chi lavora un mandato sta coordinando, non
  allargandosi. Senza goal, la regola sociale resta identica.
- **Il fatto della delega nell'eval:ux**: dopo i contatti del team, il walk manda una domanda
  cross-craft (audit + idee post) e `delegationFacts` conta i DM agente-agente con messaggi.
  Non-gate oggi: è la baseline comportamentale che decide se il prompt basta o serve il tool.

## Scartato

- Nuovo tool `delegate_to_agent`: transport duplicato di `message_agent`; si riprende solo se
  l'eval dimostra che il prompt non basta.
- Canale di scrittura nel team journal per le notifiche: il journal è già scritto dai report di
  fine turno; la notifica che serve a un collega vive nel DM, la nozione che serve a tutti nel
  brand memory.
- Gate del fan-out rimosso del tutto: senza obiettivo, un fan-out deciso dall'agente resta il
  rumore che la regola era nata a fermare.
