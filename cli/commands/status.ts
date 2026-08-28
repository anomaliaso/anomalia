import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, statusBadge, formatDate, autopilotBadge, c, table, info } from '../lib/display.ts';

export async function cmdStatus(slug: string) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const detail = await api.getBrand(session.access_token, slug);
  const brand = detail.brand;

  section(`${brand.name}  (${brand.slug})`);
  console.log(`  Piano:      ${c.bold(brand.plan ?? '—')}   Stato: ${statusBadge(brand.status ?? '')}`);
  console.log(`  Autopilot:  ${autopilotBadge(brand.autopilot_enabled)}` +
    (brand.autopilot_failure_count > 0 ? c.red(`  ⚠ ${brand.autopilot_failure_count} fallimenti consecutivi`) : ''));
  if (detail.runs[0]) {
    const runErr = detail.runs[0].status === 'failed' ? c.red(`  ✗ ${detail.runs[0].error ?? ''}`) : '';
    console.log(`  Ultimo run: ${formatDate(detail.runs[0].created_at)} — ${detail.runs[0].posts_created} post${runErr}`);
  }

  section('Post');
  const posts = await api.getPosts(session.access_token, slug);
  const pending = posts.filter(p => p.status === 'pending_user');
  const scheduled = posts.filter(p => p.status === 'scheduled');
  console.log(`  In approvazione: ${c.yellow(String(pending.length))}   Schedulati: ${c.green(String(scheduled.length))}   Totale: ${posts.length}`);

  if (pending.length) {
    table(
      ['Platform', 'Slot', 'Caption'],
      pending.slice(0, 10).map(p => [
        p.platform ?? '—',
        p.slot ?? '—',
        (p.caption ?? '').slice(0, 60) + ((p.caption?.length ?? 0) > 60 ? '…' : ''),
      ])
    );
  }

  section('Quota');
  console.log(`  Prodotti: ${detail.productCount}   Account: ${detail.accountCount}`);
  console.log();
}
