import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, table, formatDate, c, info } from '../lib/display.ts';

export async function cmdAnalytics(slug: string) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const data = await api.getAnalytics(session.access_token, slug);

  console.log(c.bold(`\nAnalytics — ${slug}\n`));

  // Status distribution
  section('Distribuzione post');
  // Tuple-typed so the `n > 0` filter sees a number, not `string | number`.
  const statusRows: [string, number][] = [
    ['pending', data.pending],
    ['scheduled', data.scheduled],
    ['failed', data.failed],
    ['total', data.total],
  ];
  table(['Status', 'Count'], statusRows.filter(([, n]) => n > 0));

  // Platform distribution
  if (data.platforms.length) {
    console.log();
    table(
      ['Platform', 'Post totali'],
      data.platforms.map(([p, n]) => [p, n])
    );
  }

  // Top posts
  if (data.topPosts.length) {
    section('Top post');
    table(
      ['Platform', 'Data', 'Likes', 'Commenti', 'Caption'],
      data.topPosts.map((p) => [
        p.platform ?? '—',
        formatDate(p.published_at),
        String(p.metrics?.likes ?? 0),
        String(p.metrics?.comments ?? 0),
        (p.caption ?? '').slice(0, 55) + ((p.caption?.length ?? 0) > 55 ? '…' : ''),
      ])
    );
  }

  // Engagement per platform
  if (data.socialPerformance.length) {
    section('Engagement per platform');
    table(
      ['Platform', 'Post', 'Likes', 'Commenti', 'Views', 'Shares'],
      data.socialPerformance.map(sp => [
        sp.platform,
        String(sp.posts),
        String(sp.totals.likes),
        String(sp.totals.comments),
        String(sp.totals.views),
        String(sp.totals.shares),
      ])
    );
  }

  // Upcoming
  if (data.upcomingPosts.length) {
    section('Prossimi post');
    for (const p of data.upcomingPosts) {
      console.log(`  ${c.dim(p.scheduled_for?.slice(0, 16) ?? '—')}  ${(p.platform ?? '—').padEnd(15)}${(p.caption ?? '').slice(0, 40)}`);
    }
  }

  // Recent activity
  if (data.recentActivity.length) {
    section('Attività recente');
    for (const a of data.recentActivity.slice(0, 5)) {
      const color = a.status === 'published' ? c.green : a.status === 'failed' ? c.red : c.yellow;
      console.log(`  ${c.dim(a.created_at?.slice(0, 16) ?? '—')}  ${(a.platform ?? '—').padEnd(15)}${color(a.status)}`);
    }
  }

  console.log();
}
