# L'analytics review agent esce dal framework, settimo dei dodici

Settimo giro, stessa ricetta. Questo è l'agente con il tavolo più largo della serie: legge
le performance vere e poi propone aggiustamenti al GTM, revisioni al piano editoriale,
riscrive post in coda, li rischedula, corregge articoli in bozza e scrive lezioni nella
memoria del brand.

Proprio per questo i test di caratterizzazione guardano il **giro**, non le scritture: quelle
hanno già i loro test, e rifarli qui sarebbe una seconda definizione che diverge dalla prima
al primo campo aggiunto. Quello che serviva fissare era cosa il modello riceve (il tavolo
esatto, la disciplina sull'evidenza, il digest, la guida dell'owner), come si chiude, cosa
finisce in `agent_runs` e `agent_sessions`, e cosa succede quando non si chiude.

Come il SEO agent, **non solleva mai**: un modello che muore viene catturato, registrato
come corsa fallita, e la funzione torna `null`. Una review che fallisce non deve portarsi
dietro il cron che l'ha chiamata.

## L'arco che spariva

Prima: `analytics-review-agent.ts → harness/index → harness/run → chat/model` e `→
chat/controller`. Adesso non più da qui.

## Cosa non cambia

Il cliente non osserva niente: stesse proposte, stesse note, stesse righe. Nessun changelog
pubblico.
