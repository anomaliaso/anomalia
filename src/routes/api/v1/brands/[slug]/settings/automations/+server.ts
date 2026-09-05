import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { SET_AUTOMATION, statusForFailure } from '@anomalia/api-contracts';
import {
  ROSTER_JOBS,
  RUN_WINDOW_DAYS,
  brandRoster,
  jobBlurb,
  jobRunCounts,
  scheduledWorkAllowed,
  setJobEnabled
} from '$lib/server/job-roster';

// I lavori ricorrenti inclusi nel prodotto, e l'interruttore di ciascuno.
//
// Il client admin serve perché `brand_job_optouts` e `loop_ticks` sono territorio service-role;
// l'autorizzazione l'ha già fatta `loadBrandForUser` sul client dell'utente — stesso schema di
// `/doctor`.
//
// Accendere impegna crediti a ogni giro futuro, quindi la lettura porta `runs_30d`: quante volte
// il lavoro ha DAVVERO girato. Non porta dollari, e non è una dimenticanza — `ai_calls` non ha
// nessuna colonna che nomini il loop, e le sue label sono condivise fra lavori diversi, quindi
// una cifra per lavoro sarebbe inventata.

const windowStart = () =>
  new Date(Date.now() - RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

const cadenceOf = (key: string) => ROSTER_JOBS.find((j) => j.key === key)!.cadence;

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const admin = createAdminClient();
  const [roster, runs] = await Promise.all([
    brandRoster(admin, brand.id),
    jobRunCounts(admin, brand.id, windowStart())
  ]);

  return json({
    brand: brand.slug,
    plan: brand.plan,
    scheduled_work_allowed: scheduledWorkAllowed(brand.plan),
    jobs: roster.map((row) => ({
      job: row.key,
      what: jobBlurb(row.key),
      cadence: row.cadence,
      enabled: row.enabled,
      state: row.state,
      reason: row.reason,
      last_run_at: row.lastRunAt,
      behind: row.behind,
      runs_30d: runs.get(row.key) ?? 0
    }))
  });
};

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SET_AUTOMATION.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { job, enabled } = parsed.data;
  const res = await setJobEnabled(createAdminClient(), {
    brandId: brand.id,
    jobKey: job,
    enabled,
    userId: user?.id ?? null
  });

  if (!res.ok) {
    return json(
      { error: 'toggle_failed', detail: res.error },
      { status: statusForFailure(SET_AUTOMATION, 'toggle_failed') }
    );
  }

  return json({
    ok: true,
    job,
    enabled,
    cadence: cadenceOf(job),
    // Ripetuto nella risposta di chi accende: ciò che è stato impegnato resta scritto nel turno,
    // non solo nella descrizione che l'agente ha letto prima.
    spends_on_every_run: enabled,
    scheduled_work_allowed: scheduledWorkAllowed(brand.plan)
  });
};
