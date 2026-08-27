import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { brandDoctor } from '$lib/server/brand-doctor';

// GET /api/v1/brands/:slug/doctor — perché questo brand non riceve niente dall'AI.
//
// Per ogni ciclo coperto (pubblicazione, autopilot, analytics review): il PRIMO gate che il brand
// non supera, cosa serve per superarlo, e l'ultimo esito registrato in loop_ticks. Stessa idea di
// `radar/diagnose`, generalizzata ai cicli ricorrenti — vedi docs/38-salto-di-qualita.md §0.2.
//
// Read-only: nessuna scrittura, nessuna AI, nessun credito. Il client admin serve perché
// loop_ticks e scheduler_runs sono telemetria service-role; l'autorizzazione è già stata fatta da
// loadBrandForUser sul client dell'utente.

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const admin = createAdminClient();
  const { data: full } = await admin
    .from('brands')
    .select('id, name, slug, plan, autopilot_failure_count, last_autopilot_run_at, own_history_at')
    .eq('id', brand.id)
    .maybeSingle();

  return json(await brandDoctor(admin, full ?? brand));
};
