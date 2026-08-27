/**
 * Una clip UGC vera, dal batch di produzione, per guardare le direttive Seedance 2.5 all'opera.
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/test-ugc-seedance-blocks.ts <slug> [formato] [piattaforma]
 *
 * Gira `streamUgcBatchResponse` — lo stesso percorso della pagina UGC Creator, planner compreso —
 * con UNA clip in un formato multi-scena, così esercita le parti nuove: shot numerati, "Hard cut."
 * dichiarato, frame di scena come reference, ritratto del talent passato al modello video.
 *
 * Stampa lo stream mentre scorre e, alla fine, il PROMPT che è finito a Seedance: è quello che si
 * vuole leggere per capire se la forma è giusta, più del video stesso.
 *
 * Spende crediti veri (immagini Nano Banana Pro + resa Seedance) e lascia la clip nella griglia UGC
 * del brand, come una generazione qualsiasi.
 */
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { streamUgcBatchResponse } from '../src/lib/server/media-generator/ugc-batch';
import { isUgcFormatId, isUgcPlatformId } from '../src/lib/ugc-formats';

const slug = process.argv[2] ?? 'anomalia';
const formatArg = process.argv[3] ?? 'unboxing';
const platformArg = process.argv[4] ?? 'tiktok';
const format = isUgcFormatId(formatArg) ? formatArg : 'unboxing';
const platform = isUgcPlatformId(platformArg) ? platformArg : 'tiktok';

const admin = createAdminClient();
// Gli slug in questo database NON sono unici, e il duplicato più recente è quello VUOTO: prendere
// "l'ultimo creato" pesca un brand senza membri e senza media. Vince quello che ha davvero
// qualcuno dentro. Un id passato a mano batte tutto.
const isUuid = /^[0-9a-f-]{36}$/i.test(slug);
const { data: brands } = await admin
  .from('brands')
  .select('id, name, slug, created_at')
  .eq(isUuid ? 'id' : 'slug', slug)
  .order('created_at', { ascending: false })
  .limit(10);
let brand: { id: string; name: string; slug: string } | undefined;
let userId: string | undefined;
for (const candidate of brands ?? []) {
  const { data: member } = await admin
    .from('brand_members')
    .select('user_id')
    .eq('brand_id', candidate.id)
    .limit(1)
    .maybeSingle();
  if (member?.user_id) {
    brand = candidate;
    userId = member.user_id as string;
    break;
  }
}
if (!brand || !userId) {
  console.error(`nessun brand "${slug}" con membri (${brands?.length ?? 0} candidati)`);
  process.exit(1);
}
console.log(`brand ${brand.id} (${brands?.length ?? 0} con questo slug)`);

const startedAt = new Date().toISOString();
console.log(`\n${brand.name} · formato ${format} · ${platform}\n${'='.repeat(70)}`);

const response = streamUgcBatchResponse({
  supabase: admin,
  userId,
  brandId: brand.id,
  prompt:
    "Una clip UGC per pubblicizzare il prodotto: arriva il pacco, lo apre in camera, lo usa per la prima volta e dà un giudizio onesto — inclusa una riserva vera. Niente packshot finale.",
  videoCount: 1,
  format,
  platform,
  aspectRatio: '9:16',
  useBrandStyle: true
});

// Lo stream è SSE: qui interessano solo le righe di testo, per vedere il lavoro mentre scorre.
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6)) as { type?: string; delta?: string; toolName?: string };
      if (evt.type === 'text-delta' && evt.delta) process.stdout.write(evt.delta);
      else if (evt.type === 'tool-input-start' && evt.toolName) console.log(`   · ${evt.toolName}`);
    } catch {
      /* keep-alive o evento non JSON */
    }
  }
}

// Il prompt che è davvero uscito, letto dalla riga che il batch ha salvato.
const { data: items } = await admin
  .from('media_generator_items')
  .select('kind, url, prompt, created_at')
  .eq('brand_id', brand.id)
  .gte('created_at', startedAt)
  .order('created_at', { ascending: true });

for (const item of items ?? []) {
  console.log(`\n${'='.repeat(70)}\n${item.kind?.toUpperCase()} — ${item.url}\n${'='.repeat(70)}`);
  if (item.kind === 'video') console.log(item.prompt);
}
console.log(`\n${(items ?? []).length} elementi prodotti.`);
