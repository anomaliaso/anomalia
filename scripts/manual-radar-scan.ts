// One-off manual radar SCAN for a brand (search + AI verdict only — no post/comment/article
// production, no emails). Run: npx vite-node scripts/manual-radar-scan.ts <slug>
// Writes the same rows a real scan would: brand_news_items + one radar_searches log row.
import { createAdminClient } from '../src/lib/server/supabase-admin';
import { radarScan, radarPrefsOf } from '../src/lib/server/radar';
import { withBrandContext } from '../src/lib/server/ai-log';

const slug = process.argv[2] ?? 'anomalia';
const admin = createAdminClient();

const { data: brand } = await admin
  .from('brands')
  .select('id, name, timezone, blog_config, content_prefs')
  .eq('slug', slug)
  .maybeSingle();

if (!brand) {
  console.error(`brand '${slug}' not found`);
  process.exit(1);
}

const prefs = radarPrefsOf(brand.content_prefs);
console.log(`[scan] ${slug} (${brand.id}) — mode=${prefs.mode}, enabled=${prefs.enabled}`);

const picked = await withBrandContext(brand.id, () =>
  radarScan(admin, { id: brand.id, name: brand.name, timezone: brand.timezone, blog_config: brand.blog_config }, prefs)
);

console.log(`\n[scan] done — ${picked.length} relevant items picked:`);
for (const p of picked) console.log(`  · [${p.action} · rel ${p.relevance}] ${p.sourceName} — ${p.title.slice(0, 80)}`);
process.exit(0);
