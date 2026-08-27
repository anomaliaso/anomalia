import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createAdminClient } from '$lib/server/supabase-admin';
import { runDream } from '$lib/server/brand-memory';
import { persistAgentRun } from '$lib/server/agent-runs';

// Nightly memory maintenance (Dream). Runs across ALL brands to decay stale entries,
// promote reinforced session-level facts, archive expired ones and synthesize skills.
// Protected by CRON_SECRET.
//
// `?dry=1` esegue le stesse decisioni SENZA scrivere, cancellare o chiamare l'AI, e risponde con
// il dettaglio per brand: è il modo di guardare cosa farebbe un giro prima di lasciarglielo fare.
// Il giro vero lascia invece una riga in `agent_runs` per ogni brand su cui ha toccato qualcosa,
// con il nome delle chiavi cancellate — un lavoro notturno che nessuno può ispezionare è come non
// averlo, e una riga sparita senza traccia non si recupera.

// Skill synthesis adds up to one AI call per brand that learned something this week, on top of
// the existing sequential per-brand maintenance.
// ponytail: still one sequential pass over every brand — shard by brand id if it ever times out.
export const config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request, url }) => {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = url.searchParams.get('dry') === '1';

  const supabase = createAdminClient();
  const { data: brands } = await supabase.from('brands').select('id, name');
  if (!brands?.length) return json({ processed: 0, dryRun });

  let totalDecayed = 0;
  let totalPromoted = 0;
  let totalArchived = 0;
  let totalSkills = 0;
  let totalAiCalls = 0;
  let errors = 0;
  const perBrand: Array<Record<string, unknown>> = [];

  for (const brand of brands) {
    try {
      const r = await runDream(supabase, brand.id, { dryRun });
      totalDecayed += r.decayed;
      totalPromoted += r.promoted;
      totalArchived += r.archived;
      totalSkills += r.skills;
      totalAiCalls += r.aiCalls;

      const touched = r.decayed + r.promoted + r.archived + r.skills + r.orphans;
      if (dryRun) {
        if (touched || r.aiCalls) perBrand.push({ brand: brand.name, ...r });
      } else if (touched) {
        persistAgentRun({
          brandId: brand.id as string,
          agent: 'dream',
          mode: r.capped ? 'nightly (capped)' : 'nightly',
          status: 'finished',
          finishedOk: true,
          notes: [
            `decayed ${r.decayed}, archived ${r.archived}, promoted ${r.promoted}, skills ${r.skills}, orphan edges ${r.orphans}`,
            r.archivedKeys.length ? `deleted keys: ${r.archivedKeys.join(', ')}` : null
          ]
            .filter(Boolean)
            .join(' — ')
        });
      }
    } catch (e) {
      console.error(`[dream] failed for brand ${brand.name}:`, e);
      errors++;
      if (!dryRun) {
        persistAgentRun({
          brandId: brand.id as string,
          agent: 'dream',
          mode: 'nightly',
          status: 'failed',
          finishedOk: false,
          notes: e instanceof Error ? e.message : String(e)
        });
      }
    }
  }

  return json({
    dryRun,
    processed: brands.length,
    decayed: totalDecayed,
    promoted: totalPromoted,
    archived: totalArchived,
    skills: totalSkills,
    aiCalls: totalAiCalls,
    errors,
    ...(dryRun ? { brands: perBrand } : {})
  });
};
