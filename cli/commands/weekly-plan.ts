import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, statusBadge, formatDate, c, table, info, ok, warn } from '../lib/display.ts';

export async function cmdWeeklyPlan(slug: string, opts: {
  action?: string;
  week?: number;
  verbose?: boolean;
}) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const action = opts.action ?? 'show';

  switch (action) {
    case 'show':
      return showWeeklyPlan(session.access_token, slug, opts.week);
    case 'plan':
      return planWeek(session.access_token, slug, opts.week);
    case 'produce':
      return produceWeek(session.access_token, slug, opts.week);
    case 'render':
      return renderWeek(session.access_token, slug, opts.week, opts.verbose);
    default:
      console.error(`Azione sconosciuta: ${action}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
${c.bold('Azioni Piano Settimanale:')}

  ${c.green('show')}                    Mostra piano settimanale (default)
    --week N                        Numero settimana (default: corrente)

  ${c.green('plan')}                    Genera seeds per una settimana
    --week N                        Numero settimana (0-3)

  ${c.green('produce')}                 Produci tutti i seeds in post
    --week N                        Numero settimana (0-3)

  ${c.green('render')}                  Genera le immagini di tutti i post della settimana
    --week N                        Numero settimana (default: tutti i pending)
`);
}

async function showWeeklyPlan(token: string, slug: string, week?: number) {
  const data = await api.getWeeklyPlan(token, slug);

  section('Piano Settimanale');

  if (!data.plan) {
    info('Nessun piano editoriale attivo.');
    console.log(`\n  ${c.dim('Usa:')} anomalia plan ${slug} propose  ${c.dim('per generare il piano')}`);
    console.log();
    return;
  }

  // Week navigator
  const weekIdx = week ?? data.currentWeekIdx;
  console.log('  Settimane:');
  const weekLine = data.plan.weeks.map((w, i) => {
    const isCurrent = i === weekIdx;
    return isCurrent ? c.green(`▶W${i + 1} ${w.theme.slice(0, 15)}`) : c.dim(`  W${i + 1} ${w.theme.slice(0, 15)}`);
  }).join(c.dim(' │ '));
  console.log(`  ${weekLine}`);

  // Current week info
  const currentWeek = weekIdx != null ? data.plan.weeks[weekIdx] : null;
  if (currentWeek) {
    console.log(`\n  ${c.bold(`Settimana ${weekIdx! + 1}:`)} ${currentWeek.theme}`);
  }

  // Posts
  if (data.posts.length) {
    section('Post generati');
    table(
      ['Platform', 'Slot', 'Status', 'Pillar', 'Caption'],
      data.posts.slice(0, 20).map(p => [
        p.platform ?? '—',
        formatDate(p.slot || p.scheduled_for),
        statusBadge(p.status),
        p.pillar ?? '—',
        (p.caption ?? '').slice(0, 40) + ((p.caption?.length ?? 0) > 40 ? '…' : ''),
      ])
    );
  }

  // Seeds
  if (data.seeds) {
    const seeds = (data.seeds.seeds ?? []) as Record<string, unknown>[];
    if (seeds.length) {
      section(`Seeds (${seeds.length})`);
      table(
        ['Platform', 'Format', 'Pillar', 'Angle'],
        seeds.map(s => [
          String(s.platform ?? '—'),
          String(s.format ?? '—'),
          String(s.pillar ?? '—'),
          String(s.angle ?? '—').slice(0, 50),
        ])
      );
      console.log(`\n  ${c.dim('Usa:')} anomalia weekly-plan ${slug} produce --week ${weekIdx ?? 0}  ${c.dim('→ produci tutti')}`);
    }
  } else {
    info('\n  Nessun seed per questa settimana.');
    console.log(`  ${c.dim('Usa:')} anomalia weekly-plan ${slug} plan --week ${weekIdx ?? 0}  ${c.dim('→ genera seeds')}`);
  }

  // Quota
  const q = data.quota;
  console.log(`\n  Quota: ${q.used}/${q.max} post questo mese`);

  console.log();
}

async function planWeek(token: string, slug: string, week?: number) {
  if (week === undefined) { console.error('--week è obbligatorio (0-3)'); process.exit(1); }
  console.log(c.yellow(`Generazione seeds per settimana ${week + 1}…`));
  const result = await api.planWeek(token, slug, week);
  ok(`Seeds generati. Usa ` + c.bold(`anomalia weekly-plan ${slug}`) + ` per vederli.`);
}

async function produceWeek(token: string, slug: string, week?: number) {
  // Get the draft
  const data = await api.getWeeklyPlan(token, slug);
  if (!data.seeds) { warn('Nessun seed da produrre.'); return; }

  console.log(c.yellow('Produzione post in corso…'));
  const result = await api.produceWeek(token, slug, data.seeds.id);
  ok(`${result.produced} post prodotti.`);
}

async function renderWeek(token: string, slug: string, week?: number, verbose?: boolean) {
  console.log(c.yellow('Generazione immagini in corso (review attivo)…'));
  const result = await api.renderWeek(token, slug, week);
  if (!result.results.length) { info('Nessun post da renderizzare (immagini già presenti o solo text).'); return; }
  for (const r of result.results) {
    const label = r.product ? c.dim(` [${r.product.slice(0, 40)}]`) : '';
    if (r.ok) console.log(`  ${c.green('✓')}${label} ${r.url}`);
    else console.log(`  ${c.red('✗')}${label} ${r.id}: ${r.error ?? 'errore'}`);
    if (verbose && r.qc) {
      const tag = r.qc.pass ? c.green(`QC ${r.qc.score}/10`) : c.yellow(`QC ${r.qc.score}/10${r.qc.retried ? ' (retry)' : ''}`);
      console.log(`     ${tag}${r.qc.issues.length ? c.dim(` — ${r.qc.issues.join('; ')}`) : ''}`);
    }
  }
  ok(`${result.rendered} immagini generate${result.failed ? `, ${result.failed} fallite` : ''}.`);
}
