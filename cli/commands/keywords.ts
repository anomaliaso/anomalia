import { requireSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, table, c, info, ok, fail, formatDate } from '../lib/display.ts';

export async function cmdKeywords(slug: string, opts: { action: string }) {
  const { access_token: t } = await requireSession();

  if (opts.action === 'refresh') {
    info('Keyword research in corso (DataForSEO + AI, può richiedere 1-2 min)…');
    const res = await api.refreshKeywords(t, slug);
    ok(`Strategy rigenerata — ${res.keywords} keyword`);
    return;
  }
  if (opts.action !== 'show') { fail(`Azione sconosciuta: ${opts.action} (show, refresh)`); process.exit(1); }

  const { strategy, citations, updatedAt } = await api.getKeywords(t, slug);

  section('Keyword strategy');
  if (!strategy) { info(`Nessuna strategy. Lancia: anomalia keywords ${slug} refresh\n`); return; }

  console.log(`  ${strategy.focusSummary}`);
  console.log(`  ${c.dim(`aggiornata ${formatDate(updatedAt)}`)}\n`);

  const color = (o?: string) => o === 'high' ? c.green : o === 'medium' ? c.yellow : c.dim;
  table(
    ['keyword', 'intent', 'volume', 'kd', 'opp.', 'azione'],
    strategy.keywords.map((k) => [
      k.keyword.slice(0, 40),
      k.intent ?? '—',
      k.volume ?? '—',
      k.difficulty ?? '—',
      color(k.opportunity)(k.opportunity ?? '—'),
      (k.action ?? '—').slice(0, 24)
    ])
  );

  if (strategy.competitorGaps.length) {
    section('Gap sui competitor');
    for (const g of strategy.competitorGaps) console.log(`  ${c.bold(g.competitor)} — ${g.gap}`);
  }
  if (citations.length) info(`\n${citations.length} fonti consultate`);
  console.log();
}
