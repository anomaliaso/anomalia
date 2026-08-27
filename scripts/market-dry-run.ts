/**
 * Dry run of the market harvest pipeline — every pure stage, no network, no database.
 *
 * Exists because the real loop needs SCRAPECREATORS_API_KEY and a service-role key, and running it
 * for the first time should not be the first time anyone sees its output. Feed the parsers the
 * payload shapes the real endpoints return and watch the whole chain: parse → score → baseline →
 * label → correlate.
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/market-dry-run.ts
 */
import {
  parseThreadsSearch,
  parseRedditSearch,
  dedupeDiscovered,
  categoriesForTick,
  DEFAULT_CATEGORIES
} from '../src/lib/server/market-discovery';
import { marketPostRow, accountsOf, ageHoursOf } from '../src/lib/server/market-harvest';
import {
  accountBaselines,
  outperformance,
  correlateChecks,
  engagementAtAge,
  velocity,
  topOutperformers
} from '../src/lib/server/market-metrics';
import { groupErrors } from '../src/lib/server/market-errors';

const NOW = Date.parse('2026-08-19T12:00:00Z');
const agoHours = (h: number) => (NOW - h * 3_600_000) / 1000;

const line = (s = '') => console.log(s);
const rule = (t: string) => { line(); line(`── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`); };

// ── 1. What a tick actually asks for ────────────────────────────────────────────────────────
rule('1. ROTAZIONE CATEGORIE');
line(`Categorie totali: ${DEFAULT_CATEGORIES.length}`);
for (const hour of [0, 1, 2, 6]) {
  const picked = categoriesForTick(DEFAULT_CATEGORIES, hour, 2);
  const queries = picked.flatMap((c) => c.queries).length;
  const subs = picked.flatMap((c) => c.risingSubreddits ?? []).length;
  line(`  ora ${String(hour).padStart(2)}: ${picked.map((c) => c.id).join(', ').padEnd(26)} → ${queries} query × 3 piattaforme + ${subs} rising = ${queries * 3 + subs} chiamate`);
}
const perTick = categoriesForTick(DEFAULT_CATEGORIES, 0, 2);
const callsPerTick = perTick.flatMap((c) => c.queries).length * 3 + perTick.flatMap((c) => c.risingSubreddits ?? []).length;
line(`  → ~${callsPerTick} chiamate/tick × 24 tick = ~${callsPerTick * 24}/giorno`);
line(`  → giro completo delle ${DEFAULT_CATEGORIES.length} categorie ogni ${Math.ceil(DEFAULT_CATEGORIES.length / 2)} ore`);

rule('1b. DA DOVE ARRIVANO DAVVERO LE ETICHETTE');
const FETCHES = 24, PER_FETCH = 24;
line(`  1 ricerca      → ~10 post su ~10 account   → 0 etichettabili (servono 5 post/account)`);
line(`  1 fetch profilo→ ~${PER_FETCH} post di 1 account       → ${PER_FETCH} etichettabili + baseline imparziale`);
line(`  per tick: ${callsPerTick} ricerche → ~0 etichette`);
line(`            ${FETCHES} fetch profilo → ~${FETCHES * PER_FETCH} etichette`);
line(`  → il pool cresce dai PROFILI, non dalle ricerche. Le ricerche danno ampiezza.`);

// ── 2. Parsing ──────────────────────────────────────────────────────────────────────────────
rule('2. PARSING (payload nella forma che restituiscono gli endpoint)');
const threads = parseThreadsSearch({
  posts: [
    { code: 'aa1', user: { username: 'chef_marco' }, caption: { text: 'Hai 3 tavoli vuoti il martedì? Ecco come li riempio da 2 anni. Scrivimi in DM.' },
      taken_at: agoHours(26), like_count: 1840, text_post_app_info: { direct_reply_count: 96, repost_count: 41 },
      video_versions: [{ url: 'https://cdn.example/clip.mp4' }] },
    { code: 'aa2', user: { username: 'chef_marco' }, caption: { text: 'Nel mondo di oggi, scopri come portare il tuo ristorante al livello successivo!' },
      taken_at: agoHours(25), like_count: 22, text_post_app_info: { direct_reply_count: 1, repost_count: 0 } },
    { code: 'aa3', user: { username: 'chef_marco' }, caption: { text: 'Menu nuovo da domani.' }, taken_at: agoHours(30), like_count: 130 },
    { code: 'aa4', user: { username: 'chef_marco' }, caption: { text: 'Il 68% dei clienti non torna dopo la prima volta. Il motivo non è il cibo.' },
      taken_at: agoHours(28), like_count: 910, text_post_app_info: { direct_reply_count: 44 } },
    { code: 'aa5', user: { username: 'chef_marco' }, caption: { text: 'Buon weekend a tutti!' }, taken_at: agoHours(40), like_count: 75 },
    { code: 'bb1', user: { username: 'trattoria_x' }, caption: { text: 'Aperti anche a Ferragosto.' }, taken_at: agoHours(27), like_count: 12 }
  ]
}, 'ristorante marketing');

const reddit = parseRedditSearch({
  posts: [
    { permalink: '/r/restaurateur/comments/x1/slow_tuesdays/', title: 'How I fixed slow Tuesdays', selftext: 'We tested 4 offers over 6 weeks. Numbers inside.',
      subreddit: 'restaurateur', created_utc: agoHours(20), score: 430, num_comments: 88 }
  ]
}, 'r/restaurateur:rising');

const found = dedupeDiscovered([...threads, ...reddit]);
line(`Threads: ${threads.length} post · Reddit: ${reddit.length} post · dopo dedupe: ${found.length}`);
line(`Media rilevati: ${found.filter((p) => p.mediaUrl).length} (di cui video: ${found.filter((p) => p.mediaType === 'video').length})`);
line(`Post scartati per handle o testo mancante: ${6 + 1 - found.length}`);

// ── 3. Scoring col rubric ───────────────────────────────────────────────────────────────────
rule('3. SCORING (stesso metro dei nostri post)');
const rows = found.map(marketPostRow);
for (const r of rows.slice(0, 4)) {
  const snippet = String(r.content).slice(0, 48).padEnd(50);
  line(`  ${String(r.quality_index).padStart(5)}  ${snippet} eng=${String(r.engagement).padStart(5)}  fmt=${r.format_bucket}`);
}
const worst = rows.reduce((a, b) => (a.quality_index < b.quality_index ? a : b));
line(`  peggiore: ${worst.quality_index} — hook ${worst.checks.hook_strength}, ai_tells ${worst.checks.ai_tells}`);

// ── 4. Baseline + etichetta ─────────────────────────────────────────────────────────────────
rule('4. BASELINE E SOVRAPERFORMANCE');
const asMarket = found.map((p) => ({
  accountKey: `${p.platform}:${p.accountHandle}`,
  platform: p.platform,
  mediaType: p.mediaType,
  metrics: p.metrics
}));
const baselines = accountBaselines(asMarket);
line(`Account con baseline utilizzabile: ${baselines.size} su ${new Set(asMarket.map((p) => p.accountKey)).size}`);
for (const b of baselines.values()) line(`  ${b.accountKey}: mediana ${b.medianEngagement} su ${b.posts} post`);
line('Account senza baseline → post NON etichettati (esclusi dal fit, non contati come flop):');
for (const key of new Set(asMarket.map((p) => p.accountKey))) {
  if (!baselines.has(key)) line(`  ${key}`);
}
line();
for (const p of asMarket) {
  const o = outperformance(p, baselines);
  const label = o === null ? 'NON ETICHETTATO' : `${o.toFixed(2)}×`;
  line(`  ${p.accountKey.padEnd(22)} eng=${String(p.metrics.likes + (p.metrics.comments ?? 0) + (p.metrics.shares ?? 0)).padStart(5)} → ${label}`);
}

// ── 5. Traiettoria ──────────────────────────────────────────────────────────────────────────
rule('5. TRAIETTORIA (perché il cron è orario)');
const curve = [
  { ageHours: 2, engagement: 120 },
  { ageHours: 9, engagement: 640 },
  { ageHours: 21, engagement: 1500 },
  { ageHours: 33, engagement: 1810 }
];
line(`Letture: ${curve.map((o) => `${o.ageHours}h=${o.engagement}`).join('  ')}`);
line(`Engagement interpolato a 24h: ${engagementAtAge(curve, 24)}`);
line(`Velocità media: ${velocity(curve)?.toFixed(1)} interazioni/ora`);
line(`Un post visto solo a 3h → valore a 24h: ${engagementAtAge([{ ageHours: 3, engagement: 40 }], 24)} (rifiuta di estrapolare)`);
line(`Età di un post pubblicato 26h fa: ${ageHoursOf(new Date(NOW - 26 * 3_600_000).toISOString(), NOW)}h`);

// ── 6. Correlazione ─────────────────────────────────────────────────────────────────────────
rule('6. FIT (con questi numeri finti serve solo a mostrare la soglia)');
const scored = rows.map((r, i) => ({ checks: r.checks, outperformance: 1 + i * 0.3, format: r.format_bucket }));
const fit = correlateChecks(scored);
line(fit.length ? JSON.stringify(fit.slice(0, 3)) : `Nessuna correlazione riportata: ${scored.length} coppie < 30 richieste. È il comportamento voluto.`);

// ── 7. Errori ───────────────────────────────────────────────────────────────────────────────
rule('7. ERRORI (un endpoint morto per un tick intero)');
const simulated = [
  ...Array.from({ length: 18 }, (_, i) => ({ stage: 'discovery' as const, target: `linkedin/food: query${i}`, message: 'http_error: 503' })),
  { stage: 'media' as const, target: 'threads:aa1', message: 'too_large: 91000000 > 64000000' },
  { stage: 'media' as const, target: 'threads:aa9', message: 'http_error: 403' },
  { stage: 'baseline' as const, target: 'threads:trattoria_x', message: 'too_few_posts (1 < 5)' }
];
line(`Errori grezzi nel tick: ${simulated.length}`);
line(`Righe scritte in market_harvest_errors: ${simulated.length}`);
const groups = groupErrors(simulated);
line(`Eventi inviati a Sentry: ${groups.length}  (non ${simulated.length} — ecco perché il progetto non viene sommerso)`);
for (const g of groups) line(`  [${g.stage}] ${g.reason} ×${g.count}  esempi: ${g.samples.join(', ')}`);

rule('8. I MIGLIORI, PER SOVRAPERFORMANCE E NON PER DIMENSIONE');
const labelled = asMarket
  .map((p) => ({ key: p.accountKey, outperformance: outperformance(p, baselines) ?? Number.NaN, eng: p.metrics.likes }))
  .filter((p) => Number.isFinite(p.outperformance));
for (const t of topOutperformers(labelled, 3)) {
  line(`  ${t.outperformance.toFixed(2)}×  ${t.key}  (like grezzi: ${t.eng})`);
}
line();
