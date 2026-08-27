/**
 * Il cron che fa addormentare le computer — la metà di `computer.ts` che nessun turno chiama da
 * solo: `ensureComputer`/`touchComputer` succedono dentro un run (executor.ts), ma NIENTE
 * all'interno di un run controlla se è ora di fermarsi. Questo endpoint è quel "niente".
 */
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { sleepIdleComputers } from '$lib/agent/computer';
import { createCheckpointStorage } from '$lib/agent/adapters/checkpoint-storage';
import { createVercelSandboxProvider } from '$lib/agent/bridge/adapters';
// `reapDeadKitRuns` VIVE IN UN MODULO SUO, non qui: un +server.ts di SvelteKit puo' esportare
// SOLO i verbi HTTP (piu' config/prerender/…), e un export in piu' non e' un avviso — e' un build
// che fallisce in postbuild («Invalid export»), quindi quattro deploy di produzione fermi senza
// che un test locale se ne accorga. Il modulo separato resta ugualmente pinnabile dai test.
import { reapDeadKitRuns } from '$lib/server/agent-kit-recover';

// Stesso scaglione degli altri tick da "poco lavoro, spesso" (vedi la nota in custom-agents/tick):
// tre soli valori ammessi per non moltiplicare le funzioni serverless emesse.
export const config = { maxDuration: 300 };

const run = async (request: Request) => {
  if (!cronAuthorized(request)) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient();
  const sandbox = createVercelSandboxProvider();
  const home = createCheckpointStorage(sandbox, db);
  const report = await sleepIdleComputers({ db, sandbox, home });

  const reapedRuns = await reapDeadKitRuns(db);
  return json({ ok: true, ...report, reapedRuns });
};

export const GET: RequestHandler = ({ request }) => run(request);
export const POST: RequestHandler = ({ request }) => run(request);
