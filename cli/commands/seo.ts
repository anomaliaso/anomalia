import { requireSession } from '../lib/auth.ts';
import { api, type SeoInitiative } from '../lib/api.ts';
import { section, table, c, info, ok, fail } from '../lib/display.ts';
import { resolveByPrefix } from '../lib/select.ts';

type Opts = { action: string; id?: string; guidance?: string };

export async function cmdSeo(slug: string, opts: Opts) {
  const { access_token: t } = await requireSession();

  if (opts.action !== 'show') {
    const map: Record<string, string> = { run: 'audit', plan: 'plan', more: 'more', asset: 'asset', article: 'article' };
    const action = map[opts.action];
    if (!action) { fail(`Azione sconosciuta: ${opts.action} (show, run, plan, more, asset, article)`); process.exit(1); }
    let initiativeId = opts.id;
    if (action === 'asset' || action === 'article') {
      if (!initiativeId) { fail('Serve --id <initiativeId>'); process.exit(1); }
      // The table prints short ids — expand the prefix against the live plan.
      const { plan } = await api.getSeo(t, slug);
      const hit = resolveByPrefix(plan?.initiatives ?? [], initiativeId);
      if (!hit.ok) { fail(hit.reason === 'ambiguous' ? `Prefisso ambiguo: ${hit.count} iniziative` : 'Iniziativa non trovata'); process.exit(1); }
      initiativeId = hit.item.id;
    }

    info(action === 'audit' ? 'Audit tecnico + piano in corso (può richiedere 1-2 min)…' : 'Generazione in corso…');
    const res = await api.seoAction(t, slug, { action, initiativeId, guidance: opts.guidance });
    if (res.error) { fail(res.error); process.exit(1); }
    ok(
      action === 'audit' ? `Audit completato — tech score ${res.techScore ?? '—'}`
      : action === 'plan' ? `Piano generato — grade ${res.grade}, ${res.initiatives} iniziative`
      : action === 'more' ? `${res.added} iniziative aggiunte`
      : action === 'article' ? `Articolo generato — id ${res.articleId}`
      : `${res.generated} asset generati`
    );
    return;
  }

  const data = await api.getSeo(t, slug);

  section('SEO');
  const audit = data.audit;
  const tech = (audit?.tech ?? {}) as { issues?: { severity?: string; title?: string }[] };
  const search = (audit?.search ?? {}) as { clicks?: number; impressions?: number; position?: number };
  if (!audit) info('Nessun audit. Lancia: anomalia seo ' + slug + ' run');
  else {
    console.log(`  Tech score: ${c.bold(String(audit.tech_score ?? '—'))}/100`);
    if (search.clicks != null) console.log(`  Search: ${search.clicks} click · ${search.impressions} impression · pos. media ${search.position?.toFixed?.(1) ?? '—'}`);
    const issues = tech.issues ?? [];
    if (issues.length) {
      console.log(`  Problemi: ${c.yellow(String(issues.length))}`);
      for (const i of issues.slice(0, 5)) console.log(`   ${c.dim('·')} ${i.title ?? ''} ${c.dim(`[${i.severity ?? '—'}]`)}`);
    }
  }

  const plan = data.plan;
  if (!plan?.initiatives?.length) { info('\nNessun piano SEO. Lancia: anomalia seo ' + slug + ' plan\n'); return; }

  section(`Piano — grade ${plan.evaluation?.grade ?? plan.grade ?? '—'}`);
  if (plan.evaluation?.summary) console.log(`  ${plan.evaluation.summary}\n`);

  table(
    ['id', 'tipo', 'titolo', 'impatto', 'sforzo', 'asset'],
    plan.initiatives.map((i: SeoInitiative) => [
      i.id.slice(0, 8), i.type, i.title.slice(0, 48),
      i.impact ?? '—', i.effort ?? '—',
      data.assets[i.id] ? c.green('✓') : c.dim('—')
    ])
  );
  info(`\nGenera un asset:    anomalia seo ${slug} asset --id <id>`);
  info(`Genera un articolo: anomalia seo ${slug} article --id <id>\n`);
}
