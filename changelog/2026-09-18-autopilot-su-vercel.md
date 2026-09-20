# L'autopilot smette di aspettare un processo solo

`run_autopilot` era l'unico job che il drain serverless aveva l'ordine di non reclamare
(`WORKER_ONLY_TOOL_JOBS`): lo eseguiva soltanto il worker long-lived su Render. Da lì venivano tre
cose, tutte misurate in produzione su 30 giorni.

**La fila.** Il tick delle 06:00 accoda un job per brand e un processo solo li mangia tre alla
volta. Separando l'attesa dal lavoro (`scheduler_runs.created_at` meno `chat_jobs.created_at`):

| | coda | lavoro |
|---|---|---|
| p50 | 337s | **48s** |
| p95 | 2167s | 1105s |
| oltre 30 min | — | 4 run su 136 |

Il run mediano lavora meno di un minuto e aspetta sei. Il p95 aspetta trentasei minuti per un
lavoro di diciotto. Il muro di Vercel — 1800s, già la `maxDuration` di `/api/v1/chat/queue/work` —
copre il 97% dei run, e il drain serverless ne prende uno per invocazione concatenandosi da solo:
i brand partono insieme invece che in coda.

**Il giorno in cui il worker non c'è.** 10 settembre: quattro job chiusi come
`never picked up by a worker`. Un job riservato a un processo che non esiste non è in ritardo, è
perso — e nessun altro poteva prenderlo.

**Un'ora dentro una funzione da mezz'ora.** Il tick accodava `deadline_ms: 3_600_000`, scritto a
mano quando a eseguirlo era un processo senza muri. Su Vercel un budget più lungo del muro non
allunga il run: lo fa uccidere a metà, e la riga resta `running` finché il reaper la chiude come
*heartbeat lost* — un guasto del processo, non un timeout. Ora il budget è
`AUTOPILOT_RUN_BUDGET_MS` in `autopilot-thresholds.ts`, con un test che lo tiene agganciato a
`CHAT_MAX_DURATION_MS`; il tick non lo passa più, così a deciderlo è un posto solo.

`WORKER_ONLY_TOOL_JOBS` sparisce, e con esso il parametro `mode` di
`processNextPendingToolJob`: serviva solo a scegliere fra due allowlist. L'allowlist resta una,
`EXECUTABLE_TOOL_JOBS` — `motion_video` e `ugc_batch` restano fuori perché non hanno un case
nell'esecutore, che è un motivo diverso e continua a valere.

**Non rimosso:** `src/worker/`, `scripts/build-worker.mjs` e il servizio `worker` del
docker-compose. In self-host non c'è il cron di Vercel e non c'è un muro da 1800s: lì un processo
long-lived è la scelta giusta, e `infra/app/Dockerfile` più `self-host-compose.test.ts` lo danno
per presente. Quello che cambia è che la produzione non ne ha più bisogno.

**Scartato:** spezzare `runAutopilotForBrand` in step ripresi dal cron. È la strada giusta per il
3% di run che sfora davvero i 30 minuti, ma è un rewrite di 1200 righe per un quarantesimo dei
casi — e non era ciò che teneva acceso il worker.
