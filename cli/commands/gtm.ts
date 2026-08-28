import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, c, info } from '../lib/display.ts';

export async function cmdGtm(slug: string) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const data = await api.getGtm(session.access_token, slug);
  const gtm = data.gtm as Record<string, unknown> | null;

  section('GTM Roadmap');

  if (!gtm) {
    info('Nessun piano GTM attivo.');
    console.log();
    return;
  }

  console.log(`  Orizzonte: ${c.bold(String(gtm.horizon ?? '—'))}`);
  if (gtm.objective) console.log(`  Obiettivo: ${gtm.objective}`);
  console.log();

  const phases = (gtm.phases ?? []) as Record<string, unknown>[];
  section('Fasi');

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const status = data.phaseStatuses[i] ?? 'next';
    const color = status === 'done' ? c.green : status === 'now' ? c.yellow : c.dim;
    const prefix = status === 'now' ? c.yellow('▶') : ' ';
    const name = String(phase.name ?? `Fase ${i + 1}`);
    const obj = String(phase.objective ?? '—').slice(0, 70);

    console.log(`${prefix} ${color(name)}  ${c.dim(`[${status}]`)}`);
    console.log(`   ${obj}`);

    if (status === 'now') {
      const sd = phase.start_date ? new Date(phase.start_date as string) : null;
      const ed = phase.end_date ? new Date(phase.end_date as string) : null;
      if (sd && ed) {
        const now = new Date();
        const total = ed.getTime() - sd.getTime();
        const elapsed = now.getTime() - sd.getTime();
        const pct = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
        const barLen = 25;
        const filled = Math.round((pct / 100) * barLen);
        const bar = c.green('█'.repeat(filled)) + c.dim('░'.repeat(barLen - filled));
        console.log(`   [${bar}] ${c.bold(`${pct}%`)}`);
      }
      if (phase.platform_weights) {
        const weights = phase.platform_weights as Record<string, number>;
        const parts = Object.entries(weights).sort(([, a], [, b]) => (b as number) - (a as number)).map(([p, w]) => `${p} ${Math.round((w as number) * 100)}%`);
        console.log(`   Platform: ${c.dim(parts.join(' · '))}`);
      }
      if (Array.isArray(phase.pillars) && phase.pillars.length) {
        console.log(`   Pilastri: ${c.dim((phase.pillars as string[]).join(', '))}`);
      }
      if (Array.isArray(phase.goals) && phase.goals.length) {
        for (const goal of (phase.goals as Record<string, unknown>[]).slice(0, 5)) {
          console.log(`   KPI: ${String(goal.kpi ?? '—')} → ${c.bold(String(goal.target ?? '—'))}`);
        }
      }
    }
    console.log();
  }
}
