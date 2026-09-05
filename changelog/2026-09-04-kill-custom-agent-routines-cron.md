# Le routine dei custom agent non partono più da sole

Primo pezzo della rimozione dei custom agent e delle loro routine. Qui va via la
cosa che le faceva *succedere*: il cron.

Spariscono `src/routes/api/v1/custom-agents/tick/+server.ts` (22 righe) e la sua voce
in `vercel.json`, che girava `*/5 * * * *` — 288 esecuzioni al giorno, ognuna capace
di aprire un thread e far lavorare un agente a spese del brand. Con questa PR le righe
di `custom_agent_schedules` restano dove sono e non fanno più partire niente.

## Perché prima il cron e non l'interfaccia

Perché è l'unico pezzo che si può togliere da solo senza entrare in casa d'altri.

Il censimento dice che i custom agent non sono un modulo: sono una feature intrecciata
al cuore della chat. `custom-agents.ts` e `custom-agent-persona.ts` sono importati da
`chat/queue.ts`, `chat/room.ts`, `chat/persistence.ts`, `agent/tools/agent-dm-tools.ts`
e `agent/tools/index.ts` — cioè da `src/lib/server/chat/` e `src/lib/agent/`, che in
questo momento sono in mano a un altro lavoro. Togliere il codice server oggi vorrebbe
dire riscrivere il drain della coda, le stanze e la persistenza del transcript dentro
file che qualcun altro sta modificando.

Il cron invece è una foglia: nessuno lo importa, e `tickCustomAgentSchedules` aveva lui
come unico chiamante.

## Cosa resta, e va tolto dopo

Nell'ordine in cui si può fare senza rompere la chat:

1. l'interfaccia — `app/[brand]/agents/+page.svelte` (1751 righe) e il suo
   `+page.server.ts`, che però tengono **anche** i roster job (`toggleJob`), che restano:
   vanno separati, non cancellati;
2. gli strumenti — `agent-team-tools.ts` (`create_scheduled_agent`,
   `update_scheduled_agent`, `set_scheduled_agent_enabled`, `propose_custom_agent`) e
   `agent-team.ts`, che vive solo per loro;
3. il codice server — `custom-agents.ts`, `custom-agents-read.ts`,
   `custom-agent-persona.ts`, e con loro `custom_agent_id` sfilato dalla chat.

**Attenzione a una parola sola: «routine» in questo repo indica due cose.** Le routine
dei custom agent, che sono righe di `custom_agent_schedules`, e i **roster job**
(`job-roster.ts`, `brand_job_optouts`, `ROSTER_JOBS`) — il lavoro ricorrente della
piattaforma: weekly recap, radar, geo, seo. Quelli restano. Un grep cieco su `routine`
prende tutti e due.

## Le tabelle non si toccano

`custom_agents`, `custom_agent_schedules`, `custom_agent_thread_runs` e `agent_templates`
restano (migration 0210, 0172, 0195, 0201). Si segnalano soltanto: qui i deploy non
eseguono migration, e le righe dei clienti non si buttano insieme a una funzione.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
