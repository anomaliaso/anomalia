import ora from 'ora';
import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { ok, warn, c, table } from '../lib/display.ts';

export async function cmdApprove(slug: string, opts: { all?: boolean; dry?: boolean }) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const posts = await api.getPosts(session.access_token, slug);
  const pending = posts.filter(p => p.status === 'pending_user');

  if (!pending.length) {
    warn('Nessun post in attesa di approvazione.');
    return;
  }

  console.log(`\n${c.bold(slug)} — ${pending.length} post in pending:\n`);
  table(
    ['#', 'Platform', 'Slot', 'Caption'],
    pending.map((p, i) => [
      String(i + 1),
      p.platform ?? '—',
      p.slot ?? '—',
      (p.caption ?? '').slice(0, 60) + ((p.caption?.length ?? 0) > 60 ? '…' : ''),
    ])
  );

  if (opts.dry) {
    warn('Dry run — nessun post approvato.');
    return;
  }

  if (!opts.all) {
    console.log(`\n${c.dim('Usa --all per approvare tutti, --dry per vedere senza approvare.')}`);
    return;
  }

  const spinner = ora('Approvazione in corso…').start();
  try {
    const result = await api.approveAll(session.access_token, slug);
    const done = result.results?.filter(r => r.ok).length ?? 0;
    const failedCount = result.results?.filter(r => !r.ok).length ?? 0;
    spinner.stop();
    ok(`${done}/${pending.length} approvati${failedCount ? `, ${failedCount} falliti` : ''}.`);
  } catch (e) {
    spinner.fail(`Errore: ${String(e)}`);
  }
}
