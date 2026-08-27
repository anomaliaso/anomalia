// Reads the strategy-lab JSON outputs and produces:
//   - Italian-labelled Markdown (strategy-NN.md, overwritten)
//   - a single self-contained index.html with all runs + sidebar nav
//
//   node scripts/build-strategy-page.mjs [runFolder]
// If no folder is given, uses the most recent strategy-runs/<slug>-<stamp> dir.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Locate the run folder ───────────────────────────────────────────────────
function latestRunDir() {
  const root = join(process.cwd(), 'strategy-runs');
  const dirs = readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => statSync(p).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!dirs.length) throw new Error('No strategy-runs/* folder found');
  return dirs[0];
}
const runDir = process.argv[2] || latestRunDir();

// ── Italian labels ──────────────────────────────────────────────────────────
const PRIO = { primary: 'primario', secondary: 'secondario', experiment: 'sperimentale' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const weights = (w) => (w ?? []).map((x) => `${x.platform} ${x.percent}%`).join(', ');

// ── Markdown (Italian labels) ───────────────────────────────────────────────
function mdPhases(phases) {
  if (!phases?.length) return '_(nessuna fase)_\n';
  return phases.map((p, i) => [
    `#### Fase ${i + 1} — ${p.name} _(${p.duration_weeks} sett.)_`,
    `- **Obiettivo:** ${p.objective}`,
    `- **Motivazione:** ${p.rationale}`,
    `- **Peso piattaforme:** ${weights(p.platform_weights)}`,
    p.pillars?.length ? `- **Pilastri:** ${p.pillars.join(' · ')}` : '',
    p.goals?.length ? `- **KPI:**\n${p.goals.map((g) => `  - ${g.kpi} → ${g.target}${g.why ? ` _(${g.why})_` : ''}`).join('\n')}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');
}
function mdWeeks(wks) {
  if (!wks?.length) return '_(nessuna settimana)_\n';
  return wks.map((w, i) => {
    const mix = (w.content_mix ?? []).map((m) => `${m.count}× ${m.type}`).join(', ');
    return [
      `### Settimana ${i + 1} — ${w.theme}`,
      w.focus ? `- **Focus:** ${w.focus}` : '',
      mix ? `- **Mix contenuti:** ${mix}` : '',
      w.rationale ? `- **Motivazione:** ${w.rationale}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
function renderMd(d, i) {
  const g = d.gtm ?? {}, p = d.plan ?? {}, v = p.voice ?? {};
  const mix = (p.platform_mix ?? []).map((m) => `**${m.platform}** ${m.share}${m.role ? ` — ${m.role}` : ''}`).join(' · ');
  return [
    `# Strategia ${String(i).padStart(2, '0')} — ${d.brand?.name ?? ''} (${d.brand?.slug ?? ''})`,
    `_Generata ${d.generatedAt} · GTM ${d.timingsMs?.gtm}ms · piano ${d.timingsMs?.plan}ms · lingua ${d.inputs?.outputLanguage} · zeroToOne ${d.inputs?.zeroToOne} · storico ${d.inputs?.historyCount}_`,
    '', '## 1 · Strategia GTM', `**Obiettivo di business:** ${g.objective ?? '—'}`,
    '', '### Roadmap 90 giorni', mdPhases(g.phases_90d),
    '', '### Roadmap 6 mesi', mdPhases(g.phases_6m),
    '', '## 2 · Piano editoriale', `**Strategia:** ${p.strategy ?? '—'}`,
    '', `**Voce:** ${v.mood ?? '—'} / ${v.tone ?? '—'} / ${v.goal ?? '—'}${v.personality ? ` — ${v.personality}` : ''}`,
    `**Cadenza:** ${p.cadence ?? '—'}`,
    mix ? `**Mix piattaforme:** ${mix}` : '',
    p.gtm ? [
      `\n**Sezione GTM:** stadio \`${p.gtm.stage ?? '—'}\`${p.gtm.summary ? ` — ${p.gtm.summary}` : ''}`,
      p.gtm.platform_recs?.length ? p.gtm.platform_recs.map((r) => `- _${PRIO[r.priority] ?? r.priority}_ **${r.platform}** — ${r.why}${r.organic_potential ? ` (${r.organic_potential})` : ''}`).join('\n') : '',
      p.gtm.plays?.length ? `\nAzioni:\n${p.gtm.plays.map((x) => `- ${x}`).join('\n')}` : ''
    ].filter(Boolean).join('\n') : '',
    '', '## 3 · Calendario editoriale settimanale', mdWeeks(p.weeks), ''
  ].join('\n');
}

// ── HTML fragments ──────────────────────────────────────────────────────────
function htmlPhases(phases) {
  if (!phases?.length) return '<p class="muted">nessuna fase</p>';
  return phases.map((p, i) => `
    <div class="phase">
      <h4>Fase ${i + 1} — ${esc(p.name)} <span class="dur">${p.duration_weeks} sett.</span></h4>
      <p><b>Obiettivo:</b> ${esc(p.objective)}</p>
      <p class="muted"><b>Motivazione:</b> ${esc(p.rationale)}</p>
      <p class="weights">${(p.platform_weights ?? []).map((w) => `<span class="chip">${esc(w.platform)} ${w.percent}%</span>`).join('')}</p>
      ${p.pillars?.length ? `<p><b>Pilastri:</b> ${p.pillars.map(esc).join(' · ')}</p>` : ''}
      ${p.goals?.length ? `<ul class="goals">${p.goals.map((g) => `<li><b>${esc(g.kpi)}</b> → ${esc(g.target)}${g.why ? `<span class="muted"> — ${esc(g.why)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    </div>`).join('');
}
function htmlWeeks(wks) {
  if (!wks?.length) return '<p class="muted">nessuna settimana</p>';
  return `<div class="weeks">${wks.map((w, i) => `
    <div class="week">
      <h4>Sett. ${i + 1}</h4>
      <p class="theme">${esc(w.theme)}</p>
      ${w.focus ? `<p class="muted">${esc(w.focus)}</p>` : ''}
      ${(w.content_mix?.length) ? `<p class="mix">${w.content_mix.map((m) => `<span class="chip sm">${m.count}× ${esc(m.type)}</span>`).join('')}</p>` : ''}
      ${w.rationale ? `<p class="rat muted">${esc(w.rationale)}</p>` : ''}
    </div>`).join('')}</div>`;
}
function htmlRun(d, i) {
  const g = d.gtm ?? {}, p = d.plan ?? {}, v = p.voice ?? {};
  const id = `run-${String(i).padStart(2, '0')}`;
  return `
  <section id="${id}" class="run">
    <div class="run-head">
      <span class="num">${String(i).padStart(2, '0')}</span>
      <div>
        <h2>${esc(g.objective || d.brand?.name)}</h2>
        <p class="meta">Cadenza <b>${esc(p.cadence)}</b> · GTM ${(g.phases_90d?.length ?? 0)}+${(g.phases_6m?.length ?? 0)} fasi · ${(p.weeks?.length ?? 0)} settimane · ${Math.round((d.timingsMs?.total ?? 0) / 1000)}s</p>
      </div>
    </div>

    <h3>1 · Strategia GTM</h3>
    <p class="lead"><b>Obiettivo di business:</b> ${esc(g.objective)}</p>
    <div class="cols">
      <div><h5>Roadmap 90 giorni</h5>${htmlPhases(g.phases_90d)}</div>
      <div><h5>Roadmap 6 mesi</h5>${htmlPhases(g.phases_6m)}</div>
    </div>

    <h3>2 · Piano editoriale</h3>
    <p class="lead">${esc(p.strategy)}</p>
    <div class="facts">
      <div><span class="k">Voce</span><span class="val">${esc(v.mood)} / ${esc(v.tone)} / ${esc(v.goal)}</span></div>
      <div><span class="k">Cadenza</span><span class="val">${esc(p.cadence)}</span></div>
      <div><span class="k">Mix piattaforme</span><span class="val">${(p.platform_mix ?? []).map((m) => `${esc(m.platform)} ${esc(m.share)}`).join(' · ')}</span></div>
    </div>
    ${v.personality ? `<p class="muted">${esc(v.personality)}</p>` : ''}
    ${p.gtm ? `
      <div class="gtm-box">
        <p><b>Sezione GTM</b> — <span class="tag">${esc(p.gtm.stage)}</span> ${esc(p.gtm.summary)}</p>
        ${(p.gtm.platform_recs?.length) ? `<ul>${p.gtm.platform_recs.map((r) => `<li><span class="tag ${r.priority}">${PRIO[r.priority] ?? esc(r.priority)}</span> <b>${esc(r.platform)}</b> — ${esc(r.why)}</li>`).join('')}</ul>` : ''}
        ${(p.gtm.plays?.length) ? `<p class="muted"><b>Azioni:</b></p><ul class="plays">${p.gtm.plays.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>` : ''}

    <h3>3 · Calendario editoriale settimanale</h3>
    ${htmlWeeks(p.weeks)}
  </section>`;
}

// ── Build ───────────────────────────────────────────────────────────────────
const files = readdirSync(runDir).filter((n) => /^strategy-\d+\.json$/.test(n)).sort();
const runs = files.map((f) => JSON.parse(readFileSync(join(runDir, f), 'utf8')));
const brandName = runs[0]?.brand?.name ?? 'brand';

// Re-render Italian markdown
runs.forEach((d, idx) => writeFileSync(join(runDir, files[idx].replace('.json', '.md')), renderMd(d, idx + 1)));

const nav = runs.map((d, i) => {
  const obj = (d.gtm?.objective ?? '').slice(0, 68);
  return `<a href="#run-${String(i + 1).padStart(2, '0')}"><span class="nnum">${String(i + 1).padStart(2, '0')}</span><span class="ntext">${esc(obj)}…</span></a>`;
}).join('');

const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Strategie — ${esc(brandName)}</title>
<style>
  :root{
    --bg:#f7f6f3; --panel:#fff; --ink:#1a1a1a; --muted:#6b6b6b; --line:#e6e3dd;
    --accent:#c9603a; --accent-soft:#f0e2da; --chip:#efece6;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#151412; --panel:#1f1e1b; --ink:#ececea; --muted:#9a968e; --line:#302e2a;
    --accent:#e08a5f; --accent-soft:#2c231d; --chip:#2a2824;
  }}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{display:grid;grid-template-columns:280px 1fr;max-width:1400px;margin:0 auto;gap:0}
  aside{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:24px 16px;border-right:1px solid var(--line)}
  aside h1{font-size:18px;margin:0 0 4px}
  aside .sub{color:var(--muted);font-size:13px;margin:0 0 18px}
  aside a{display:flex;gap:10px;text-decoration:none;color:var(--ink);padding:9px 10px;border-radius:9px;margin-bottom:3px;font-size:13px}
  aside a:hover{background:var(--accent-soft)}
  .nnum{color:var(--accent);font-weight:700;font-variant-numeric:tabular-nums}
  .ntext{color:var(--muted);overflow:hidden}
  main{padding:32px 40px;min-width:0}
  .run{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px 30px;margin-bottom:26px}
  .run-head{display:flex;gap:16px;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:18px}
  .run-head .num{font-size:30px;font-weight:800;color:var(--accent);line-height:1;font-variant-numeric:tabular-nums}
  .run-head h2{font-size:19px;margin:0 0 4px}
  .meta{color:var(--muted);font-size:13px;margin:0}
  h3{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--accent);margin:26px 0 10px}
  h5{font-size:13px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);margin:0 0 10px}
  .lead{margin:0 0 14px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  .phase{border-left:2px solid var(--line);padding:2px 0 12px 14px;margin-bottom:14px}
  .phase h4{margin:0 0 6px;font-size:14px}
  .phase p{margin:4px 0}
  .dur{color:var(--muted);font-weight:400;font-size:12px}
  .chip{display:inline-block;background:var(--chip);border-radius:20px;padding:2px 10px;font-size:12px;margin:2px 4px 2px 0}
  .chip.sm{font-size:11px;padding:1px 8px}
  .goals{margin:8px 0 0;padding-left:18px}
  .goals li{margin:4px 0;font-size:13.5px}
  .muted{color:var(--muted)}
  .facts{display:flex;flex-wrap:wrap;gap:22px;margin:12px 0}
  .facts .k{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .facts .val{font-weight:600}
  .gtm-box{background:var(--accent-soft);border-radius:12px;padding:14px 18px;margin-top:12px}
  .gtm-box ul{margin:6px 0;padding-left:18px}
  .gtm-box li{margin:5px 0;font-size:13.5px}
  .plays li{margin:3px 0}
  .tag{display:inline-block;background:var(--chip);border-radius:6px;padding:1px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  .tag.primary{background:var(--accent);color:#fff}
  .weeks{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .week{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px}
  .week h4{margin:0 0 6px;color:var(--accent);font-size:12px;text-transform:uppercase}
  .week .theme{font-weight:600;margin:0 0 6px}
  .week p{font-size:13px;margin:6px 0}
  .week .rat{font-size:12px}
  @media(max-width:900px){.wrap{grid-template-columns:1fr}aside{position:static;height:auto;border-right:none;border-bottom:1px solid var(--line)}main{padding:20px}.cols,.weeks{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
  <aside>
    <h1>Strategie — ${esc(brandName)}</h1>
    <p class="sub">${runs.length} run dell'agente · stessa base dati<br>${esc(runDir.split(/[\\/]/).pop())}</p>
    <nav>${nav}</nav>
  </aside>
  <main>${runs.map((d, i) => htmlRun(d, i + 1)).join('')}</main>
</div></body></html>`;

const outPath = join(runDir, 'index.html');
writeFileSync(outPath, html);
console.log(outPath);
