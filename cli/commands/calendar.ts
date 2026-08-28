import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, c, info } from '../lib/display.ts';

export async function cmdCalendar(slug: string, opts: { month?: string }) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const data = await api.getCalendar(session.access_token, slug, opts.month);

  section('Calendario');
  console.log(`  ${c.bold(data.monthLabel)}`);
  console.log();

  // Group by day
  const byDay = new Map<string, Record<string, unknown>[]>();
  for (const p of data.posts) {
    const dateStr = String(p.scheduled_for ?? p.slot ?? '');
    const day = dateStr.slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(p);
  }

  // Calendar grid
  const dayNames = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  const colWidth = 14;
  console.log(dayNames.map(d => d.padEnd(colWidth)).join(''));

  const firstDay = new Date(data.year, data.month - 1, 1);
  const lastDay = new Date(data.year, data.month, 0);
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  let col = 0;
  let line = '';
  for (let i = 0; i < startDow; i++) {
    line += ' '.repeat(colWidth);
    col++;
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateKey = `${data.year}-${String(data.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayPosts = byDay.get(dateKey) ?? [];
    const dayStr = String(day).padStart(2);
    const count = dayPosts.length;
    const indicator = count > 0 ? c.green(`(${count})`.padEnd(4)) : '    ';
    line += `${dayStr} ${indicator}    `;
    col++;
    if (col === 7) { console.log(line); line = ''; col = 0; }
  }
  if (col > 0) console.log(line);

  // Upcoming
  const upcoming = data.posts.filter(p => !p.isDraft).slice(0, 7);
  if (upcoming.length) {
    section('Prossimi post');
    for (const p of upcoming) {
      const date = String(p.scheduled_for ?? p.slot ?? '').slice(0, 16);
      const cap = String(p.caption ?? '').slice(0, 45) + (String(p.caption ?? '').length > 45 ? '…' : '');
      const statusColor = p.status === 'scheduled' ? c.green : p.status === 'pending_user' ? c.yellow : c.dim;
      console.log(`  ${c.dim(date)}  ${String(p.platform ?? '—').padEnd(12)} ${statusColor(cap)}`);
    }
  }

  console.log();
  info(`  ${c.green('●')} scheduled   ${c.dim('○')} draft`);
  console.log();
}
