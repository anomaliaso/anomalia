import { loadSession } from '../lib/auth.ts';
import { api } from '../lib/api.ts';
import { section, table, formatDate, c, info, ok, warn } from '../lib/display.ts';

export async function cmdPlan(slug: string, opts: {
  action?: string;
  feedback?: string;
  week?: number;
  brief?: string;
  products?: string;
  clearProducts?: boolean;
}) {
  const session = await loadSession();
  if (!session) { console.error('Sessione scaduta o non trovata. Esegui: anomalia login'); process.exit(1); }

  const action = opts.action ?? 'show';

  switch (action) {
    case 'show':
      return showPlan(session.access_token, slug);
    case 'propose':
      return proposePlan(session.access_token, slug);
    case 'revise':
      return revisePlan(session.access_token, slug, opts.feedback);
    case 'approve':
      return approvePlan(session.access_token, slug);
    case 'discard':
      return discardPlan(session.access_token, slug);
    case 'save-brief':
      return saveBrief(session.access_token, slug, opts.week, opts.brief, opts.products, opts.clearProducts);
    case 'replan':
      return replanWeek(session.access_token, slug, opts.week, opts.brief);
    default:
      console.error(`Azione sconosciuta: ${action}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
${c.bold('Azioni Piano Editoriale:')}

  ${c.green('show')}                    Mostra piano attivo (default)

  ${c.green('propose')}                 Genera primo piano editoriale
    Per brand senza piano attivo

  ${c.green('revise')}                  Richiedi revisione
    --feedback "Voglio più behind-the-scenes"

  ${c.green('approve')}                 Approva piano proposto

  ${c.green('discard')}                 Scarta piano proposto

  ${c.green('save-brief')}              Salva brief e/o prodotti per una settimana
    --week 0                        Indice settimana (0-3)
    --brief "Mostra il processo creativo"
    --products "TKD Pt.1,INTRO S100"  Prodotti da featuring (nomi esatti, separati da virgola)

  ${c.green('replan')}                  Rigenera una settimana
    --week 0                        Indice settimana (0-3)
    --brief "Dietro le quinte"      Brief obbligatorio
`);
}

async function showPlan(token: string, slug: string) {
  const data = await api.getEditorialPlan(token, slug);
  const plan = data.plan as Record<string, unknown> | null;
  const proposed = data.proposed as Record<string, unknown> | null;

  section('Piano Editoriale');

  // ── Proposed plan (if any) ──
  if (proposed) {
    console.log(c.yellow('\n  ⚠ PIANO PROPOSTO IN ATTESA'));
    if (data.proposedFeedback) {
      console.log(`  Feedback: ${c.dim(data.proposedFeedback)}`);
    }
    const changes = proposed.changes_summary as string[] | undefined;
    if (changes?.length) {
      console.log('  Modifiche:');
      for (const ch of changes) console.log(`    • ${ch}`);
    }
    console.log(`\n  ${c.dim('Usa:')} anomalia plan ${slug} approve  ${c.dim('per approvare')}`);
    console.log(`  ${c.dim('Usa:')} anomalia plan ${slug} discard  ${c.dim('per scartare')}`);
    console.log();
  }

  // ── Active plan ──
  if (!plan) {
    info('Nessun piano editoriale attivo.');
    console.log(`\n  ${c.dim('Usa:')} anomalia plan ${slug} propose  ${c.dim('per generare il primo piano')}`);
    console.log();
    return;
  }

  console.log(`  Cadenza:     ${c.bold(String(plan.cadence ?? '—'))}`);
  if (data.currentWeek != null) {
    console.log(`  Settimana:   ${c.green(String(data.currentWeek + 1))} di 4`);
  }

  // Voice
  const voice = plan.voice as Record<string, unknown> | undefined;
  if (voice) {
    console.log(`  Voice:       ${voice.mood ?? '—'} / ${voice.tone ?? '—'} / ${voice.goal ?? '—'}`);
  }

  // Platform mix
  const mix = plan.platform_mix as Array<{ platform: string; share: string }> | undefined;
  if (mix?.length) {
    const parts = mix.map(m => `${m.platform} ${m.share}`);
    console.log(`  Platform:    ${parts.join(' · ')}`);
  }

  // Strategy
  if (plan.strategy) {
    console.log(`\n  ${c.dim('Strategia:')}`);
    console.log(`  ${String(plan.strategy).slice(0, 300)}${String(plan.strategy).length > 300 ? '…' : ''}`);
  }

  // Weeks
  const weeks = (plan.weeks ?? []) as Record<string, unknown>[];
  section(`Settimane (${weeks.length})`);

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const isCurrent = i === data.currentWeek;
    const prefix = isCurrent ? c.green('▶') : ' ';
    const theme = String(w.theme ?? '—');
    const focus = String(w.focus ?? '');
    const status = String(w.status ?? 'planned');
    const brief = w.brief as string | null;

    console.log(`\n  ${prefix} ${c.bold(`Settimana ${i + 1}`)} ${c.dim(`[${status}]`)}  ${theme}`);
    if (focus) console.log(`    Focus: ${c.dim(focus.slice(0, 100))}`);
    if (brief) console.log(`    Brief: ${c.yellow(brief.slice(0, 100))}`);
    const weekProducts = w.products as string[] | null;
    if (weekProducts?.length) {
      console.log(`    Prodotti: ${c.cyan(weekProducts.join(', '))}`);
    }

    // Content mix
    const contentMix = w.content_mix as Array<{ type: string; count: number }> | undefined;
    if (contentMix?.length) {
      const parts = contentMix.map(cm => `${cm.count}× ${cm.type}`);
      console.log(`    Mix: ${c.dim(parts.join(', '))}`);
    }

    if (w.rationale) {
      console.log(`    ${c.dim(String(w.rationale).slice(0, 120))}`);
    }
  }

  // Commands
  console.log(`\n  ${c.dim('Comandi:')}`);
  console.log(`  anomalia plan ${slug} revise --feedback "..."   ${c.dim('→ richiedi revisione')}`);
  console.log(`  anomalia plan ${slug} save-brief --week 0 --brief "..."  ${c.dim('→ salva brief')}`);
  console.log(`  anomalia plan ${slug} replan --week 0 --brief "..."      ${c.dim('→ rigenera settimana')}`);

  console.log();
}

async function proposePlan(token: string, slug: string) {
  console.log(c.yellow('Generazione piano editoriale in corso…'));
  const result = await api.proposePlan(token, slug);
  ok('Piano proposto. Usa `anomalia plan ' + slug + '` per vederlo e `anomalia plan ' + slug + ' approve` per attivarlo.');
}

async function revisePlan(token: string, slug: string, feedback?: string) {
  if (!feedback) {
    console.error('--feedback è obbligatorio');
    process.exit(1);
  }
  console.log(c.yellow('Revisione in corso…'));
  await api.revisePlan(token, slug, feedback);
  ok('Revisione proposta. Usa `anomalia plan ' + slug + '` per vederla.');
}

async function approvePlan(token: string, slug: string) {
  await api.approvePlan(token, slug);
  ok('Piano editoriale attivato.');
}

async function discardPlan(token: string, slug: string) {
  await api.discardPlan(token, slug);
  ok('Piano proposto scartato.');
}

async function saveBrief(token: string, slug: string, week?: number, brief?: string, products?: string, clearProducts?: boolean) {
  if (week === undefined) { console.error('--week è obbligatorio (0-3)'); process.exit(1); }
  if (!brief && !products && !clearProducts) { console.error('--brief, --products o --clear-products è obbligatorio'); process.exit(1); }
  // --clear-products sends an explicit empty array; --products sends the parsed list.
  const productList = clearProducts ? [] : (products ? products.split(',').map(p => p.trim()).filter(Boolean) : undefined);
  await api.saveBrief(token, slug, week, brief ?? '', productList);
  const parts = [];
  if (brief) parts.push('brief');
  if (clearProducts) parts.push('prodotti azzerati');
  else if (productList?.length) parts.push(`${productList.length} prodotti`);
  ok(`${parts.join(' + ')} per settimana ${week + 1}.`);
}

async function replanWeek(token: string, slug: string, week?: number, brief?: string) {
  if (week === undefined) { console.error('--week è obbligatorio (0-3)'); process.exit(1); }
  if (!brief) { console.error('--brief è obbligatorio'); process.exit(1); }
  console.log(c.yellow(`Rigenerazione settimana ${week + 1}…`));
  await api.replanWeek(token, slug, week, brief);
  ok(`Settimana ${week + 1} rigenerata.`);
}
