/**
 * L'AGENTE vero, non la scorciatoia.
 *
 * La sonda creativa chiama `planStrategy` diretto, quindi non esercita niente di ciò che vive
 * nell'agente settimanale: il protocollo narrativo (cerca i racconti → scegline uno →
 * approfondisci quello), il tool di ricerca, il gate di fattibilità, la riparazione delle battute.
 * Qui gira `runWeekPlannerAgent` su un brand usa e getta nel database vero, e si guarda UNA cosa:
 *
 *   ha cercato prima di scrivere, e la storia che racconta ha una fonte?
 *
 * Il brand viene distrutto nel `finally`, sempre, come ogni fixture di questo repo.
 *
 *   PUBLIC_SUPABASE_URL=http://localhost:8000 … npm run eval:agent
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '$lib/server/supabase-admin';
import { createFixture, destroyFixture, type Fixture } from './durability/fixture';
import { runWeekPlannerAgent } from '$lib/server/week-planner-agent';

const OUT = resolve(import.meta.dirname, '../../eval-results/agent');

const KIT = {
  category: 'media & community',
  about:
    'Transwiki è un progetto editoriale indipendente che raccoglie e racconta le esperienze delle persone trans in Italia: la burocrazia del cambio di nome, il lavoro, la sanità, la famiglia, la vita quotidiana. Non vende niente.',
  target_audience:
    'Persone trans e non binarie in Italia, chi le ama e le accompagna, e chi lavora nei servizi che le incontrano.',
  site_type: 'media',
  visual_style: 'Grafica editoriale sobria: fondi pieni, tipografia grande, poche foto d\'archivio.',
  brand_colors: ['#F5EDE4', '#1B1B1B', '#E86A5C', '#3B6FB6'],
  content_pillars: ['Esperienze in prima persona', 'Burocrazia e diritti', 'Salute e accesso alle cure', 'Lavoro e discriminazione'],
  ai_context:
    "Tono caldo e diretto, mai pietistico e mai da opuscolo istituzionale. Non si usa mai il linguaggio del 'coraggio' e della 'battaglia'. Non si estetizza il dolore. Le storie vengono da persone reali."
};

const RUBRICS = [
  {
    name: 'Giorni normali',
    promise: 'Una situazione vera di una persona trans in Italia, raccontata in vignette disegnate',
    strategic_role: 'cuore narrativo',
    format: 'carousel',
    cadence: '1/week',
    differentiation: 'nessuno nel campo disegna le storie',
    rationale: 'il progetto esiste per raccogliere esperienze',
    art_direction:
      "Fumetto a inchiostro nero spesso e costante con UNA tinta piatta calda su carta crema, come una serigrafia a due colori. Riquadri rettangolari con bordo netto e gutter larghi. Protagonista fisso: Sam, silhouette minuta, felpa grigia oversize con le maniche tirate sulle mani, zaino di tela verde sempre addosso. Nessun acquerello, nessun realismo."
  },
  {
    name: 'Il modulo spiegato bene',
    promise: 'Una pratica alla volta, spiegata passo passo',
    strategic_role: 'toglie ansia',
    format: 'carousel',
    cadence: '2/month',
    differentiation: 'il registro dell\'help desk, non dell\'opuscolo',
    rationale: 'chi legge arriva con una pratica davanti',
    art_direction:
      'Grafica editoriale risograph a due colori su carta avorio, griglia a schede con elenchi numerati e box evidenziatore. Nessuna fotografia.'
  }
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const admin = createAdminClient();
  let fixture: Fixture | null = null;

  try {
    fixture = await createFixture('narrativa');
    console.log(`brand usa e getta: ${fixture.brandId}`);

    await admin.from('brand_kit').upsert({ brand_id: fixture.brandId, ...KIT }, { onConflict: 'brand_id' });
    await admin.from('brands').update({ target_platforms: ['instagram'] }).eq('id', fixture.brandId);
    const batchId = crypto.randomUUID();
    await admin.from('rubrics').insert(
      RUBRICS.map((r) => ({ brand_id: fixture!.brandId, batch_id: batchId, status: 'approved', ...r }))
    );

    const profile = { name: 'Transwiki', language: 'Italian', products: [], people: [], pages: [], announcements: [], libraryMedia: [], ...KIT };

    console.log('agente al lavoro…');
    const t0 = Date.now();
    const result = await runWeekPlannerAgent({
      supabase: admin,
      userId: fixture.userId,
      brandId: fixture.brandId,
      profile,
      platforms: ['instagram'],
      count: 3,
      maxCarousels: 2,
      prefs: { language: 'Italian' },
      verbose: true,
      deadlineMs: 900_000
    });

    const { data: run } = await admin
      .from('agent_runs')
      .select('steps, violations, status, cost_usd_estimate')
      .eq('brand_id', fixture.brandId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const steps = (run?.steps ?? []) as Array<{ step: number; toolCalls?: Array<{ name: string; input?: unknown }> }>;
    const calls = steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.name));
    const researches = steps.flatMap((s) => (s.toolCalls ?? []).filter((c) => c.name === 'research').map((c) => c.input));

    const report = [
      `# L'agente al lavoro — ${Math.round((Date.now() - t0) / 1000)}s · $${(result.costUsd ?? 0).toFixed(3)} · ${run?.status}`,
      '',
      `## Cosa ha chiamato (${calls.length} chiamate)`,
      calls.map((c, i) => `${i + 1}. ${c}`).join('\n') || '_niente_',
      '',
      `## Le ${researches.length} ricerche`,
      researches.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join('\n') || '_nessuna — ha scritto senza cercare_',
      '',
      '## I seed',
      result.strategy.seeds
        .map((s, i) => {
          const beats = (s.beats ?? [])
            .map((b, n) => `   ${n + 1}. ${b.shows}${b.thinks ? `\n      pensa: «${b.thinks}»` : ''}${b.says ? `\n      dice: ${b.says}` : ''}`)
            .join('\n');
          return [
            `### ${i + 1}. ${s.format}${s.rubric ? ` · "${s.rubric}"` : ''}`,
            `- angolo: ${s.angle}`,
            `- fonte: ${s.sourced_from || '**NESSUNA**'}`,
            beats ? `- battute:\n${beats}` : ''
          ].filter(Boolean).join('\n');
        })
        .join('\n\n'),
      '',
      `## Violazioni residue\n${(run?.violations ?? []).join('\n') || '_nessuna_'}`,
      '',
      `## Note dell'agente\n${result.notes}`
    ].join('\n');

    writeFileSync(resolve(OUT, 'agente.md'), report);
    writeFileSync(resolve(OUT, 'agente.json'), JSON.stringify({ result, steps: run?.steps }, null, 2));
    console.log(`\nricerche: ${researches.length} · seed con fonte: ${result.strategy.seeds.filter((s) => s.sourced_from).length}/${result.strategy.seeds.length}`);
    console.log(`fatto: ${OUT}/agente.md`);
  } finally {
    await destroyFixture(fixture).catch((e) => console.error('teardown fallito:', e));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
