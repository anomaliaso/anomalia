import { requireSession } from '../lib/auth.ts';
import { api, type WebArticle } from '../lib/api.ts';
import { section, table, c, info, ok, fail, formatDate, statusBadge } from '../lib/display.ts';
import { resolveByPrefix } from '../lib/select.ts';

type Opts = { action: string; status?: string; topic?: string; id?: string };

export async function cmdWeb(slug: string, opts: Opts) {
  const { access_token: t } = await requireSession();

  if (opts.action === 'list') {
    const { articles } = await api.getWeb(t, slug, opts.status);
    section(`Articoli blog${opts.status && opts.status !== 'all' ? ` — ${opts.status}` : ''}`);
    if (!articles.length) { info(`Nessun articolo. Lancia: anomalia web ${slug} generate --topic "..."\n`); return; }

    table(
      ['id', 'titolo', 'status', 'meta', 'data'],
      articles.map((a: WebArticle) => [
        a.id.slice(0, 8),
        a.title.slice(0, 46),
        statusBadge(a.status),
        // The two SEO fields that decide the snippet — missing ones are the common defect.
        `${a.meta_title ? c.green('T') : c.red('T')}${a.meta_description ? c.green('D') : c.red('D')}`,
        formatDate(a.published_at ?? a.scheduled_for ?? a.created_at)
      ])
    );
    info(`\nPubblica:  anomalia web ${slug} publish --id <id>`);
    info(`Ottimizza: anomalia web ${slug} optimize --id <id>\n`);
    return;
  }

  if (opts.action === 'generate') {
    if (!opts.topic) { fail('Serve --topic "argomento"'); process.exit(1); }
    info('Generazione articolo in corso (può richiedere qualche minuto)…');
    const res = await api.webAction(t, slug, { action: 'generate', topic: opts.topic });
    ok(`Articolo generato in draft — id ${res.articleId}`);
    return;
  }

  if (['publish', 'unpublish', 'delete', 'optimize'].includes(opts.action)) {
    if (!opts.id) { fail('Serve --id <articleId>'); process.exit(1); }
    // The table prints short ids — expand the prefix against the live list.
    const { articles } = await api.getWeb(t, slug, 'all');
    const hit = resolveByPrefix(articles, opts.id);
    if (!hit.ok) { fail(hit.reason === 'ambiguous' ? `Prefisso ambiguo: ${hit.count} articoli` : 'Articolo non trovato'); process.exit(1); }
    const matches = [hit.item];

    if (opts.action === 'optimize') info('Ottimizzazione SEO in corso…');
    const res = await api.webAction(t, slug, { action: opts.action, id: matches[0].id });
    ok(
      opts.action === 'delete' ? `Eliminato: ${matches[0].title}`
      : opts.action === 'optimize' ? `Ottimizzato: ${matches[0].title}`
      : `${matches[0].title} → ${res.status}`
    );
    return;
  }

  fail(`Azione sconosciuta: ${opts.action} (list, generate, publish, unpublish, optimize, delete)`);
  process.exit(1);
}
