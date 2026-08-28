import { requireSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, table, c, info, ok, fail, formatDate } from '../lib/display.ts';

export async function cmdGeo(slug: string, opts: { action: string }) {
  const { access_token: t } = await requireSession();

  if (opts.action === 'run' || opts.action === 'fix') {
    const action = opts.action === 'run' ? 'audit' : 'fix';
    info(action === 'audit' ? 'Probe di citazione in corso (può richiedere 1-2 min)…' : 'Generazione fix in corso…');
    const res = await api.geoAction(t, slug, action);
    ok(action === 'audit'
      ? `Audit completato — tech ${res.techScore ?? '—'}, share of voice ${Math.round((res.shareOfVoice ?? 0) * 100)}%`
      : `${res.generated} artifact generati`);
    return;
  }
  if (opts.action !== 'show') { fail(`Azione sconosciuta: ${opts.action} (show, run, fix)`); process.exit(1); }

  const data = await api.getGeo(t, slug);

  section('GEO — visibilità AI');
  if (!data.audit) { info(`Nessun audit. Lancia: anomalia geo ${slug} run\n`); return; }

  console.log(`  Share of voice: ${c.bold(`${Math.round((data.audit.share_of_voice ?? 0) * 100)}%`)}`);
  console.log(`  Tech score:     ${c.bold(String(data.audit.tech_score ?? '—'))}/100`);
  console.log(`  Ultimo run:     ${formatDate(data.audit.created_at)}`);

  if (data.trend.length > 1) {
    const spark = data.trend.map((p) => '▁▂▃▄▅▆▇█'[Math.min(7, Math.round(((p.shareOfVoice ?? 0) * 100) / 14))]).join('');
    console.log(`  Trend SoV:      ${c.cyan(spark)}`);
  }

  const cits = data.audit.citations ?? [];
  if (cits.length) {
    section('Citazioni per prompt');
    table(
      ['prompt', 'superficie', 'citato'],
      cits.slice(0, 20).map((x) => [
        String(x.prompt ?? '—').slice(0, 52),
        x.surface ?? '—',
        x.cited ? c.green('✓') : x.mentioned ? c.yellow('~') : c.dim('✗')
      ])
    );
  }

  if (data.artifacts.length) {
    section(`Fix pronti (${data.artifacts.length})`);
    for (const a of data.artifacts.slice(0, 10)) {
      console.log(`  ${c.dim('·')} ${a.title} ${c.dim(`[${a.kind}${a.target_path ? ` → ${a.target_path}` : ''}]`)}`);
    }
  } else {
    info(`\nNessun fix generato. Lancia: anomalia geo ${slug} fix`);
  }
  console.log();
}
