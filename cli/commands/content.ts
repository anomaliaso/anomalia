import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, statusBadge, formatDate, c, table, info, ok } from '../lib/display.ts';

export async function cmdContent(slug: string, opts: { status?: string; clear?: string }) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  // Bulk-clear takes priority when requested.
  if (opts.clear) {
    const validClear = ['pending_user', 'approved', 'scheduled', 'failed'];
    if (!validClear.includes(opts.clear)) {
      console.error(`--clear "${opts.clear}" non valido. Usa: ${validClear.join(', ')}`);
      process.exit(1);
    }
    const res = await api.deletePostsByStatus(session.access_token, slug, opts.clear);
    ok(`${res.deleted} post (${opts.clear}) eliminati.`);
    return;
  }

  const filter = opts.status ?? 'all';
  const validFilters = ['all', 'pending_user', 'approved', 'scheduled', 'published', 'failed'];
  if (!validFilters.includes(filter)) {
    console.error(`Status "${filter}" non valido. Usa: ${validFilters.join(', ')}`);
    process.exit(1);
  }

  const posts = await api.getPosts(session.access_token, slug, filter === 'all' ? undefined : filter);

  section('Content Library');

  const filterLabels: Record<string, string> = {
    all: 'Tutti', pending_user: 'Pending', approved: 'Approved',
    scheduled: 'Scheduled', published: 'Published', failed: 'Failed',
  };
  console.log(`  Filtro: ${c.bold(filterLabels[filter] ?? filter)}`);
  console.log();

  if (!posts.length) {
    info('Nessun contenuto trovato.');
  } else {
    table(
      ['Platform', 'Slot', 'Status', 'Pillar', 'Prodotto', 'Caption'],
      posts.map(p => [
        p.platform ?? '—',
        formatDate(p.slot || p.scheduled_for),
        statusBadge(p.status),
        p.pillar ?? '—',
        p.product_name ?? '—',
        (p.caption ?? '').slice(0, 40) + ((p.caption?.length ?? 0) > 40 ? '…' : ''),
      ])
    );
  }

  // Status summary
  const allPosts = await api.getPosts(session.access_token, slug);
  const statusCounts = new Map<string, number>();
  for (const p of allPosts) statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);
  console.log();
  const summary = ['pending_user', 'approved', 'scheduled', 'published', 'failed']
    .filter(s => (statusCounts.get(s) ?? 0) > 0)
    .map(s => `${statusBadge(s)}: ${statusCounts.get(s)}`)
    .join('  ');
  console.log(`  ${summary}`);
  console.log();
}
