/**
 * Il verdetto del soak del worker: cosa è cambiato da quando è acceso.
 *
 * Non è un A/B — il volume (≈8 turni al giorno) non lo regge. Risponde a tre domande che a
 * questo volume si rispondono per istanza, non per statistica: il worker regge un turno che
 * il muro avrebbe spezzato? doppia il lavoro del cron? resta in piedi?
 */
import { createClient } from '@supabase/supabase-js';

const since = process.argv[2];
if (!since) {
	console.error('uso: node scripts/worker-soak-report.mjs <ISO-timestamp-di-accensione>');
	process.exit(2);
}

const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: jobs, error } = await db
	.from('chat_jobs')
	.select('id, status, error, created_at, completed_at, input_params')
	.eq('tool_name', 'chat_response')
	.gte('created_at', since)
	.order('created_at');
if (error) throw error;

const secs = (j) =>
	j.completed_at ? (Date.parse(j.completed_at) - Date.parse(j.created_at)) / 1000 : null;
const WALL = /heartbeat|timeout|time limit|never picked up/i;

const done = jobs.filter((j) => j.status === 'done');
const lunghi = done.filter((j) => (secs(j) ?? 0) > 300);

console.log(`da ${since} — ${jobs.length} turni`);
console.log(`  finiti          ${done.length}`);
console.log(`  falliti         ${jobs.filter((j) => j.status === 'failed').length}`);
console.log(`  morti dal muro  ${jobs.filter((j) => WALL.test(j.error ?? '')).length}`);
console.log(`  continuazioni   ${jobs.filter((j) => j.input_params?.continuation).length}`);
console.log(`  oltre 300s      ${lunghi.length}${lunghi.length ? ' ← quelli che il muro avrebbe spezzato' : ''}`);
for (const j of lunghi) {
	console.log(`    ${j.id.slice(0, 8)}  ${Math.round(secs(j))}s  ${j.status}`);
}
