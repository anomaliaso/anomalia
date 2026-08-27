/**
 * Cosa tira fuori davvero il banco idee, per un brand vero, prima di spedirlo.
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/preview-disruptive-ideas.ts <slug> [n] [--save]
 *
 * Legge il grounding del brand (chi è, cosa vende, a chi, che tono), applica la stessa dottrina che
 * finisce nel system prompt di ogni agente (`disruptiveSystemSection`) e stampa le idee con la
 * leva, chi infastidiscono e l'autovalutazione. `--save` le scrive nel banco (`disruptive_ideas`),
 * altrimenti non tocca niente: serve per GUARDARE, che è esattamente il momento in cui si scopre se
 * la direttiva produce idee o slogan.
 *
 * Richiede le env del server (SUPABASE_SERVICE_ROLE_KEY + la chiave del provider AI).
 */
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { genaiClient } from '../src/lib/server/research';
import { aiStructured } from '../src/lib/server/xiaomi';
import { withBrandContext } from '../src/lib/server/ai-log';
import {
  formatUgcBrandGrounding,
  loadUgcBrandGrounding
} from '../src/lib/server/media-generator/brand-grounding';
import { CONTRAST_DEVICE_IDS, disruptiveSystemSection, contrastDeviceById } from '../src/lib/disruptive';
import { UGC_FORMAT_IDS, ugcFormatBrief } from '../src/lib/ugc-formats';
import { saveDisruptiveIdea } from '../src/lib/server/disruptive-ideas';

const slug = process.argv[2];
const count = Math.max(1, Math.min(12, Number(process.argv[3]) || 6));
const save = process.argv.includes('--save');

if (!slug) {
  console.error('usage: preview-disruptive-ideas.ts <brand-slug> [n] [--save]');
  process.exit(1);
}

const admin = createAdminClient();
// Slug o id: gli slug in questo database NON sono unici (stesso brand creato due volte), quindi
// maybeSingle() qui fallisce invece di rispondere. Si prende il più recente e si dice quale.
const isUuid = /^[0-9a-f-]{36}$/i.test(slug);
const { data: matches } = await admin
  .from('brands')
  .select('id, name, slug, created_at')
  .eq(isUuid ? 'id' : 'slug', slug)
  .order('created_at', { ascending: false })
  .limit(5);
const brand = matches?.[0];
if (!brand) {
  console.error(`brand "${slug}" not found`);
  process.exit(1);
}
if ((matches?.length ?? 0) > 1) {
  console.error(
    `attenzione: ${matches!.length} brand con questo slug — uso ${brand.id} (il più recente). Passa un id per scegliere.`
  );
}

const SCHEMA = {
  type: 'object' as const,
  properties: {
    ideas: {
      type: 'array' as const,
      minItems: count,
      maxItems: count,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'Titolo brevissimo e riconoscibile' },
          idea: { type: 'string' as const, description: "Cosa si VEDE, non cosa si comunica. 2-3 frasi." },
          device: { type: 'string' as const, enum: [...CONTRAST_DEVICE_IDS] },
          why_it_contrasts: { type: 'string' as const },
          who_it_annoys: { type: 'string' as const },
          format: { type: 'string' as const, enum: [...UGC_FORMAT_IDS] },
          score: {
            type: 'number' as const,
            description:
              'Quanto rompe la categoria, scala 0-100 (NON 0-10): 40 interessante, 70 scomoda davvero, 90 ne parlano i commenti'
          }
        },
        required: ['title', 'idea', 'device', 'why_it_contrasts', 'who_it_annoys', 'format', 'score']
      }
    }
  },
  required: ['ideas']
};

type Out = {
  ideas: Array<{
    title: string;
    idea: string;
    device: string;
    why_it_contrasts: string;
    who_it_annoys: string;
    format: string;
    score: number;
  }>;
};

const result = await withBrandContext(brand.id, async () => {
  const grounding = await loadUgcBrandGrounding(admin, brand.id);
  const prompt = `Proponi ${count} idee DIROMPENTI per questo brand.

${formatUgcBrandGrounding(grounding)}

${ugcFormatBrief()}

Ogni idea deve passare i tre test e nominare la leva su cui è costruita. Leve diverse fra loro: ${count} idee sulla stessa leva sono una sola idea. Scrivi in italiano.`;

  return aiStructured<Out>(
    genaiClient(),
    prompt,
    SCHEMA,
    disruptiveSystemSection(),
    'return_disruptive_ideas',
    { temperature: 0.95, label: 'preview_disruptive_ideas', brandId: brand.id }
  );
});

console.log(`\n${brand.name} — ${result.ideas.length} idee\n${'='.repeat(60)}`);
for (const [i, idea] of result.ideas.entries()) {
  const device = contrastDeviceById(idea.device);
  console.log(`\n${i + 1}. ${idea.title}  [${idea.score}/100]`);
  console.log(`   ${idea.idea}`);
  console.log(`   leva: ${device?.label ?? idea.device} · formato: ${idea.format}`);
  console.log(`   contrasto: ${idea.why_it_contrasts}`);
  console.log(`   infastidisce: ${idea.who_it_annoys}`);
  if (device) console.log(`   limite della leva: ${device.limit}`);
}

if (save) {
  let saved = 0;
  for (const idea of result.ideas) {
    const res = await saveDisruptiveIdea(admin, brand.id, null, {
      title: idea.title,
      idea: idea.idea,
      device: idea.device,
      whyItContrasts: idea.why_it_contrasts,
      whoItAnnoys: idea.who_it_annoys,
      format: idea.format,
      score: idea.score,
      surface: 'preview-script'
    });
    if (res.ok) saved++;
    else console.error(`   ! non salvata "${idea.title}": ${res.error}`);
  }
  console.log(`\nSalvate nel banco: ${saved}/${result.ideas.length}`);
} else {
  console.log(`\n(niente scritto nel banco — riesegui con --save per conservarle)`);
}
