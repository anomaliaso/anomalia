/**
 * La sonda CREATIVA: non "il codice regge", ma "quello che esce si può guardare".
 *
 * Gira il percorso vero — proposeRubrics → planStrategy → executePlan → render — su un brand
 * finto che NON ha prodotti da vendere ma storie da raccontare, che è il caso in cui il piano
 * usciva corretto e piatto. Guarda tre cose e le scrive su disco:
 *
 *   1. le RUBRICHE proposte hanno registri diversi, e almeno una ha una direzione artistica che
 *      non è una fotografia;
 *   2. i caroselli arrivano dal piano con le BATTUTE già scritte, una per slide;
 *   3. le slide renderizzate stanno nel medium della rubrica invece di tornare foto.
 *
 * Niente database e niente dev server: le rubriche non vengono salvate, il brand non esiste.
 * Costa chiamate vere al modello — le immagini sono la parte cara, `--no-images` le salta.
 *
 *   npm run eval:creative
 *   npm run eval:creative -- --posts=5 --no-images
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { proposeRubrics, type Rubric } from '$lib/server/rubrics';
import { planStrategy } from '$lib/server/content-preview/plan-pipeline';
import { executePlan } from '$lib/server/content-preview/caption-quality';
import { renderPostImage, aspectRatioFor, brandVisualDirective } from '$lib/server/content-preview/images';
import type { PostSeed, PreviewPost } from '$lib/server/content-preview';

const OUT_ROOT = resolve(import.meta.dirname, '../../eval-results/creative');
const MAX_RENDERED_SLIDES = 12;
const PLATFORMS = ['instagram'];

// Un brand la cui materia sono le persone, non un catalogo: è qui che un piano "corretto" è
// comunque un piano da buttare.
const BRAND = {
  name: 'Transwiki',
  about:
    'Transwiki è un progetto editoriale indipendente che raccoglie e racconta le esperienze delle persone trans in Italia: la burocrazia del cambio di nome, il lavoro, la sanità, la famiglia, la vita quotidiana. Non vende niente: pubblica, spiega e tiene insieme una comunità.',
  category: 'media & community',
  site_type: 'media',
  language: 'Italian',
  target_audience:
    'Persone trans e non binarie in Italia, chi le ama e le accompagna, e chi lavora nei servizi che le incontrano (sanità, scuola, HR).',
  content_pillars: [
    'Esperienze in prima persona',
    'Burocrazia e diritti, spiegati',
    'Salute e accesso alle cure',
    'Lavoro e discriminazione',
    'Comunità e alleanza'
  ],
  ai_context:
    "Il tono è caldo e diretto, mai pietistico e mai da opuscolo istituzionale. Si parla in prima persona plurale con la comunità e in seconda persona con chi legge. Le storie vengono da persone reali e non si estetizza il dolore: si mostra la vita intera, comprese le parti belle e ridicole. Non si usa mai il linguaggio del 'coraggio' e della 'battaglia'. Quello che funziona sono i racconti concreti, minuti, riconoscibili, e le spiegazioni pratiche che tolgono ansia.",
  visual_style:
    "Grafica editoriale sobria: fondi pieni, tipografia grande, poche foto d'archivio. Palette calda con accenti freddi.",
  brand_colors: ['#F5EDE4', '#1B1B1B', '#E86A5C', '#3B6FB6'],
  products: [],
  people: [],
  pages: [],
  announcements: [],
  libraryMedia: []
};

const args = new Set(process.argv.slice(2));
const arg = (name: string, fallback: number) => {
  const hit = [...args].find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) || fallback : fallback;
};
const withImages = !args.has('--no-images');
const postCount = arg('posts', 6);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(OUT_ROOT, stamp);

function write(name: string, body: string) {
  writeFileSync(resolve(outDir, name), body);
}

function rubricheReport(rubrics: Rubric[]): string {
  const lines = rubrics.map(
    (r) =>
      `### ${r.name}\n- **formato**: ${r.format} · **cadenza**: ${r.cadence}\n- **promessa**: ${r.promise}\n- **ruolo**: ${r.strategic_role}\n- **direzione artistica**: ${r.art_direction ?? '_(nessuna — eredita lo stile del brand)_'}\n- **perché**: ${r.rationale}`
  );
  const drawn = rubrics.filter((r) => r.art_direction && !/photograph|fotograf/i.test(r.art_direction));
  return `# Rubriche proposte — ${BRAND.name}\n\n${lines.join('\n\n')}\n\n---\n\n**${rubrics.length} serie · ${rubrics.filter((r) => r.art_direction).length} con direzione artistica · ${drawn.length} in un medium non fotografico**\n`;
}

function pianoReport(seeds: PostSeed[]): string {
  const rows = seeds.map((s, i) => {
    const beats = (s.beats ?? []).map((b, n) => `   ${n + 1}. ${b}`).join('\n');
    return [
      `### ${i + 1}. ${s.platform} · ${s.format}${s.slide_count ? ` (${s.slide_count} slide)` : ''}${s.rubric ? ` · rubrica "${s.rubric}"` : ''}`,
      `- **angolo**: ${s.angle}`,
      s.art_direction ? `- **direzione artistica**: ${s.art_direction}` : '',
      beats ? `- **battute**:\n${beats}` : s.format === 'carousel' ? '- **battute**: _(nessuna — è il difetto)_' : ''
    ]
      .filter(Boolean)
      .join('\n');
  });
  const carousels = seeds.filter((s) => s.format === 'carousel');
  const withBeats = carousels.filter((s) => (s.beats ?? []).length >= 3);
  return `# Piano della settimana\n\n${rows.join('\n\n')}\n\n---\n\n**${carousels.length} caroselli · ${withBeats.length} arrivati con la storia già scritta**\n`;
}

function postsReport(posts: PreviewPost[]): string {
  return `# Post prodotti\n\n${posts
    .map((p, i) => {
      const slides = (p.image_prompts ?? []).map((sp, n) => `   ${n + 1}. ${sp}`).join('\n');
      return `### ${i + 1}. ${p.platform} · ${p.format}\n\n${p.caption}\n\n${slides ? `**Slide:**\n${slides}` : `**Immagine:** ${p.image_prompt}`}`;
    })
    .join('\n\n---\n\n')}\n`;
}

function inlinePart(dataUrl: string) {
  const [head, data] = dataUrl.split(',');
  return { inlineData: { mimeType: head.slice(5).split(';')[0], data } };
}

async function renderSeries(posts: PreviewPost[]): Promise<string[]> {
  const files: string[] = [];
  const visualStyle = BRAND.visual_style;
  const brandLook = brandVisualDirective(BRAND.brand_colors, null);
  let budget = MAX_RENDERED_SLIDES;

  for (const [i, post] of posts.entries()) {
    const prompts = (post.image_prompts ?? []).length ? post.image_prompts! : post.image_prompt ? [post.image_prompt] : [];
    if (!prompts.length) continue;
    const aspectRatio = aspectRatioFor(post.platform, post.format);
    let anchor: ReturnType<typeof inlinePart> | undefined;

    for (const [n, prompt] of prompts.entries()) {
      if (budget <= 0) return files;
      budget -= 1;
      // La slide 1 finita fa da ancora estetica alle successive, come in produzione.
      const dataUrl = await renderPostImage(null as never, prompt, {
        visualStyle,
        brandLook,
        aspectRatio,
        moodImages: anchor ? [anchor] : []
      }).catch((e) => {
        console.error(`  slide ${i + 1}.${n + 1} fallita: ${e instanceof Error ? e.message : e}`);
        return undefined;
      });
      if (!dataUrl) continue;
      if (!anchor) anchor = inlinePart(dataUrl);
      const file = `post-${i + 1}-slide-${n + 1}.png`;
      writeFileSync(resolve(outDir, 'slides', file), Buffer.from(dataUrl.split(',')[1], 'base64'));
      files.push(file);
      console.log(`  reso ${file}`);
    }
  }
  return files;
}

function indexHtml(files: string[]): string {
  return `<!doctype html><meta charset="utf-8"><title>Sonda creativa — ${BRAND.name}</title>
<style>body{font:15px/1.5 system-ui;margin:40px;max-width:900px}img{width:100%;border-radius:8px;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}</style>
<h1>Sonda creativa — ${BRAND.name}</h1>
<p><a href="00-rubriche.md">rubriche</a> · <a href="01-piano.md">piano</a> · <a href="02-post.md">post</a> · <a href="03-piano.json">json</a></p>
<div class="grid">${files.map((f) => `<figure><img src="slides/${f}" alt="${f}"><figcaption>${f}</figcaption></figure>`).join('')}</div>`;
}

async function main() {
  mkdirSync(resolve(outDir, 'slides'), { recursive: true });
  console.log(`sonda creativa → ${outDir}`);

  console.log('1/4 rubriche…');
  const rubrics = await proposeRubrics(null as never, BRAND, {
    platforms: PLATFORMS,
    outputLanguage: 'Italian'
  });
  write('00-rubriche.md', rubricheReport(rubrics));
  console.log(`  ${rubrics.length} serie, ${rubrics.filter((r) => r.art_direction).length} con direzione artistica`);

  console.log('2/4 piano…');
  const strategy = await planStrategy(
    null as never,
    BRAND,
    PLATFORMS,
    postCount,
    { language: 'Italian' },
    0,
    [],
    '',
    [],
    '',
    2,
    rubrics,
    '',
    []
  );
  write('01-piano.md', pianoReport(strategy.seeds));
  write('03-piano.json', JSON.stringify({ rubrics, strategy }, null, 2));
  console.log(`  ${strategy.seeds.length} seed, ${strategy.seeds.filter((s) => (s.beats ?? []).length).length} con battute`);

  console.log('3/4 post…');
  const posts = await executePlan(null as never, BRAND, strategy, { language: 'Italian' });
  write('02-post.md', postsReport(posts));

  console.log(withImages ? '4/4 immagini…' : '4/4 immagini saltate (--no-images)');
  const files = withImages ? await renderSeries(posts) : [];
  write('index.html', indexHtml(files));

  console.log(`\nfatto: ${outDir}/index.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
