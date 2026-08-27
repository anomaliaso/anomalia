// Runs the strategy-lab agent endpoint N times for one brand and saves each
// GTM strategy + editorial plan (weekly content calendar) as JSON + Markdown,
// so the outputs can be inspected for prompt/harness tuning.
//
//   node scripts/run-strategy-lab.mjs [slug] [runs] [locale]
//   node scripts/run-strategy-lab.mjs anomalia 10 it
//
// Requires the dev server running (npm run dev). No individual post contents are
// generated — this stops at the editorial plan / content-calendar level.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const slug = process.argv[2] || 'anomalia';
const runs = Number(process.argv[3] || 10);
const locale = process.argv[4] || 'it';

// Find the dev server port (Vite uses 5173, falls back to 5174).
async function findBase() {
  for (const port of [5173, 5174]) {
    try {
      const r = await fetch(`http://localhost:${port}/`, { method: 'HEAD' });
      if (r.status) return `http://localhost:${port}`;
    } catch { /* try next */ }
  }
  return null;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ── Markdown rendering ──────────────────────────────────────────────────────
function weightsStr(w) { return (w ?? []).map((x) => `${x.platform} ${x.percent}%`).join(', '); }

function renderGtmPhases(phases, label) {
  if (!phases?.length) return `_(no ${label} phases)_\n`;
  return phases.map((p, i) => [
    `#### Phase ${i + 1} — ${p.name} _(${p.duration_weeks}w)_`,
    `- **Objective:** ${p.objective}`,
    `- **Rationale:** ${p.rationale}`,
    `- **Platform weights:** ${weightsStr(p.platform_weights)}`,
    p.pillars?.length ? `- **Pillars:** ${p.pillars.join(' · ')}` : '',
    p.goals?.length ? `- **Goals:**\n${p.goals.map((g) => `  - ${g.kpi} → ${g.target}${g.why ? ` _(${g.why})_` : ''}`).join('\n')}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');
}

function renderWeeks(weeks) {
  if (!weeks?.length) return '_(no weeks)_\n';
  return weeks.map((w, i) => {
    const mix = (w.content_mix ?? []).map((m) => `${m.count}× ${m.type}`).join(', ');
    return [
      `### Week ${i + 1} — ${w.theme}`,
      w.focus ? `- **Focus:** ${w.focus}` : '',
      mix ? `- **Content mix:** ${mix}` : '',
      w.rationale ? `- **Rationale:** ${w.rationale}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function renderMd(d, i) {
  const g = d.gtm ?? {};
  const p = d.plan ?? {};
  const voice = p.voice ?? {};
  const mix = (p.platform_mix ?? []).map((m) => `**${m.platform}** ${m.share}${m.role ? ` — ${m.role}` : ''}`).join(' · ');
  return [
    `# Strategy run ${pad(i)} — ${d.brand?.name ?? ''} (${d.brand?.slug ?? ''})`,
    `_Generated ${d.generatedAt} · GTM ${d.timingsMs?.gtm}ms · plan ${d.timingsMs?.plan}ms · lang ${d.inputs?.outputLanguage} · zeroToOne ${d.inputs?.zeroToOne} · history ${d.inputs?.historyCount}_`,
    '',
    '## 1 · GTM strategy',
    `**Business objective:** ${g.objective ?? '—'}`,
    '',
    '### 90-day roadmap',
    renderGtmPhases(g.phases_90d, '90d'),
    '',
    '### 6-month roadmap',
    renderGtmPhases(g.phases_6m, '6m'),
    '',
    '## 2 · Editorial plan',
    `**Strategy:** ${p.strategy ?? '—'}`,
    '',
    `**Voice:** ${voice.mood ?? '—'} / ${voice.tone ?? '—'} / ${voice.goal ?? '—'}${voice.personality ? ` — ${voice.personality}` : ''}`,
    `**Cadence:** ${p.cadence ?? '—'}`,
    mix ? `**Platform mix:** ${mix}` : '',
    p.gtm ? [
      `\n**GTM section:** stage \`${p.gtm.stage ?? '—'}\`${p.gtm.summary ? ` — ${p.gtm.summary}` : ''}`,
      p.gtm.platform_recs?.length ? p.gtm.platform_recs.map((r) => `- _${r.priority}_ **${r.platform}** — ${r.why}${r.organic_potential ? ` (${r.organic_potential})` : ''}`).join('\n') : '',
      p.gtm.plays?.length ? `\nPlays:\n${p.gtm.plays.map((x) => `- ${x}`).join('\n')}` : ''
    ].filter(Boolean).join('\n') : '',
    '',
    '## 3 · Weekly content calendar',
    renderWeeks(p.weeks),
    ''
  ].join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────
const base = await findBase();
if (!base) {
  console.error('Dev server not reachable on :5173 or :5174. Start it with `npm run dev` first.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(process.cwd(), 'strategy-runs', `${slug}-${stamp}`);
mkdirSync(outDir, { recursive: true });
console.log(`Base: ${base}`);
console.log(`Output: ${outDir}`);
console.log(`Running the agent ${runs}× for "${slug}" (locale ${locale})…\n`);

const manifest = [];
for (let i = 1; i <= runs; i++) {
  const started = Date.now();
  process.stdout.write(`[${pad(i)}/${runs}] generating… `);
  try {
    const res = await fetch(`${base}/api/v1/brands/${slug}/strategy-lab?locale=${locale}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      console.log(`FAILED (${res.status}): ${String(data.error).slice(0, 200)}`);
      manifest.push({ run: i, ok: false, error: data.error });
      writeFileSync(join(outDir, `strategy-${pad(i)}.error.json`), JSON.stringify(data, null, 2));
      continue;
    }
    writeFileSync(join(outDir, `strategy-${pad(i)}.json`), JSON.stringify(data, null, 2));
    writeFileSync(join(outDir, `strategy-${pad(i)}.md`), renderMd(data, i));
    const wk = data.plan?.weeks?.length ?? 0;
    const ph = (data.gtm?.phases_90d?.length ?? 0) + '+' + (data.gtm?.phases_6m?.length ?? 0);
    console.log(`ok — ${Math.round((Date.now() - started) / 1000)}s · GTM ${ph} phases · ${wk} weeks · cadence ${data.plan?.cadence ?? '?'}`);
    manifest.push({ run: i, ok: true, ms: data.timingsMs?.total, cadence: data.plan?.cadence, weeks: wk });
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    manifest.push({ run: i, ok: false, error: e.message });
  }
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ slug, runs, locale, base, generatedAt: new Date().toISOString(), results: manifest }, null, 2));
const okCount = manifest.filter((m) => m.ok).length;
console.log(`\nDone: ${okCount}/${runs} succeeded. Inspect: ${outDir}`);
