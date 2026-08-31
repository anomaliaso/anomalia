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
import { executePlan } from '$lib/server/content-preview/caption-quality';
import { renderWithQC, aspectRatioFor, brandVisualDirective, carouselSeriesDirective } from '$lib/server/content-preview/images';

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

type RunRow = { steps: unknown; violations: string[] | null; status: string; cost_usd_estimate: number | null };

async function waitForRun(
  admin: ReturnType<typeof createAdminClient>,
  brandId: string,
  attempts = 20
): Promise<RunRow | null> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await admin
      .from('agent_runs')
      .select('steps, violations, status, cost_usd_estimate')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as RunRow;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const MAX_RENDERED = 12;

function inlinePart(dataUrl: string) {
  const [head, data] = dataUrl.split(',');
  return { inlineData: { mimeType: head.slice(5).split(';')[0], data } };
}

/** I seed dell'agente fino in fondo: caption, prompt slide, immagini. Senza, la sonda misura solo
 *  il testo e ogni regola sulla messa in scena resta un'affermazione. */
async function renderPosts(profile: Record<string, unknown>, strategy: Parameters<typeof executePlan>[2]) {
  const posts = await executePlan(null as never, profile, strategy, { language: 'Italian' });
  const brandLook = brandVisualDirective(KIT.brand_colors, null);
  const files: string[] = [];
  let budget = MAX_RENDERED;

  for (const [i, post] of posts.entries()) {
    const prompts = (post.image_prompts ?? []).length ? post.image_prompts! : post.image_prompt ? [post.image_prompt] : [];
    const aspectRatio = aspectRatioFor(post.platform, post.format);
    let anchor: ReturnType<typeof inlinePart> | undefined;
    for (const [n, prompt] of prompts.entries()) {
      if (budget <= 0) return { posts, files };
      budget -= 1;
      const full = prompts.length > 1 && n > 0 ? prompt + carouselSeriesDirective(n, prompts.length) : prompt;
      // Con il QC, come in produzione: il critico rilegge il testo lettera per lettera e ritenta.
      // Senza, la sonda mostrava render grezzi — «È la cariera alias» sarebbe uscita così com'è.
      const { dataUrl } = await renderWithQC(
        null as never,
        full,
        { visualStyle: KIT.visual_style, brandLook, aspectRatio, moodImages: anchor ? [anchor] : [] },
        { visualStyle: KIT.visual_style },
        false
      ).catch((e) => {
        console.error(`  slide ${i + 1}.${n + 1} fallita: ${e instanceof Error ? e.message : e}`);
        return { dataUrl: undefined };
      });
      if (!dataUrl) continue;
      anchor ??= inlinePart(dataUrl);
      const file = `post-${i + 1}-slide-${n + 1}.png`;
      writeFileSync(resolve(OUT, 'slides', file), Buffer.from(dataUrl.split(',')[1], 'base64'));
      files.push(file);
      console.log(`  reso ${file}`);
    }
  }
  return { posts, files };
}

async function main() {
  mkdirSync(resolve(OUT, 'slides'), { recursive: true });
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

    // persistAgentRun scrive senza attendere (`void admin…`): letta subito, la riga non c'è ancora e
    // il report annuncia "0 chiamate" di un agente che ha lavorato — una sonda che mente sul nulla.
    const run = await waitForRun(admin, fixture.brandId);
    if (!run) console.warn('ATTENZIONE: nessuna riga agent_runs — il conteggio dei tool NON è misurato');

    const steps = (run?.steps ?? []) as Array<{ step: number; toolCalls?: Array<{ name: string; input?: unknown }> }>;
    const calls = steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.name));
    const researches = steps.flatMap((s) => (s.toolCalls ?? []).filter((c) => c.name === 'research').map((c) => c.input));

    const report = [
      `# L'agente al lavoro — ${Math.round((Date.now() - t0) / 1000)}s · $${(result.costUsd ?? 0).toFixed(3)} · ${run?.status}`,
      '',
      `## Cosa ha chiamato (${calls.length} chiamate${run ? '' : ' — RIGA MANCANTE, non misurato'})`,
      calls.map((c, i) => `${i + 1}. ${c}`).join('\n') || '_niente_',
      '',
      `## Le ${researches.length} ricerche${run ? '' : ' — NON MISURATE'}`,
      researches.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join('\n') || '_nessuna — ha scritto senza cercare_',
      '',
      '## I seed',
      result.strategy.seeds
        .map((s, i) => {
          const beats = (s.beats ?? [])
            .map((b, n) => `   ${n + 1}. ${b.shows}${b.who ? `\n      in scena: ${b.who}` : ''}${b.thinks ? `\n      pensa: «${b.thinks}»` : ''}${b.says ? `\n      ${b.says.speaker} dice: «${b.says.line}»` : ''}`)
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

    console.log('produco caption e immagini…');
    const { posts, files } = await renderPosts(profile, result.strategy);
    writeFileSync(
      resolve(OUT, 'agente.md'),
      `${report}\n\n## I post prodotti\n\n${posts
        .map((p, i) => {
          const slides = (p.image_prompts ?? []).map((sp, n) => `   ${n + 1}. ${sp}`).join('\n');
          return `### ${i + 1}. ${p.platform} · ${p.format}\n\n${p.caption}\n\n${slides ? `**Slide:**\n${slides}` : `**Immagine:** ${p.image_prompt}`}`;
        })
        .join('\n\n---\n\n')}\n\n${files.length} immagini in slides/\n`
    );
    writeFileSync(resolve(OUT, 'agente.json'), JSON.stringify({ result, steps: run?.steps }, null, 2));
    console.log(`\nricerche: ${researches.length} · seed con fonte: ${result.strategy.seeds.filter((s) => s.sourced_from).length}/${result.strategy.seeds.length}`);
    console.log(`fatto: ${OUT}/agente.md`);
  } finally {
    await destroyFixture(fixture).catch((e) => console.error('teardown fallito:', e));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
