#!/usr/bin/env bun
import { Command } from 'commander';
import { loadEnv, assertEnv } from './lib/config.ts';

await loadEnv();

const program = new Command();

// Validate required env vars before any command runs (not before --help).
program.hook('preAction', () => assertEnv());

program
  .name('anomalia')
  .description('CLI per gestire Anomalia — social media AI autopilot')
  .version('0.1.0')
  .addHelpText('after', `
Esempi:
  $ anomalia brands                   Lista tutti i brand
  $ anomalia dashboard my-brand       Dashboard completa
  $ anomalia approve my-brand --all   Approva tutti i post pending
  $ anomalia seo my-brand             Grade SEO, iniziative, audit tecnico
  $ anomalia geo my-brand             Visibilità AI, share of voice, citazioni
  $ anomalia keywords my-brand        Keyword strategy e opportunità
  $ anomalia web my-brand             Articoli blog (draft + pubblicati)

Documentazione completa: cli/README.md
`);

program
  .command('login')
  .description('Accedi a Anomalia (default: apre il browser)')
  .option('--email <email>', 'email per login non interattivo (richiede --password)')
  .option('--password <password>', 'password per login non interattivo (richiede --email)')
  .action(async (options) => {
    const { cmdLogin } = await import('./commands/login.ts');
    await cmdLogin(options);
  });

program
  .command('logout')
  .description('Disconnettiti da Anomalia')
  .action(async () => {
    const { cmdLogout } = await import('./commands/logout.ts');
    await cmdLogout();
  });

program
  .command('brands')
  .description('Elenca tutti i brand con status e autopilot')
  .action(async () => {
    const { cmdBrands } = await import('./commands/brands.ts');
    await cmdBrands();
  });

program
  .command('status <slug>')
  .description('Status dettagliato di un brand (post pending, quota, ultimi run)')
  .action(async (slug: string) => {
    const { cmdStatus } = await import('./commands/status.ts');
    await cmdStatus(slug);
  });

program
  .command('health')
  .description('Verifica lo stato delle API (Supabase, Gemini, Zernio)')
  .action(async () => {
    const { cmdHealth } = await import('./commands/health.ts');
    await cmdHealth();
  });

program
  .command('approve <slug>')
  .description('Approva e pubblica i post pending di un brand')
  .option('--all', 'Approva senza chiedere conferma')
  .option('--dry', 'Mostra i post senza approvarli')
  .action(async (slug: string, opts: { all?: boolean; dry?: boolean }) => {
    const { cmdApprove } = await import('./commands/approve.ts');
    await cmdApprove(slug, opts);
  });

program
  .command('analytics <slug>')
  .description('Analytics di un brand: engagement, top post, attività recente')
  .action(async (slug: string) => {
    const { cmdAnalytics } = await import('./commands/analytics.ts');
    await cmdAnalytics(slug);
  });

program
  .command('plan <slug> [action]')
  .description('Piano editoriale: show, propose, revise, approve, discard, save-brief, replan')
  .option('--feedback <text>', 'Feedback per revisione')
  .option('--week <n>', 'Indice settimana (0-3)', parseInt)
  .option('--brief <text>', 'Brief per la settimana')
  .option('--products <list>', 'Prodotti da featuring (nomi esatti, separati da virgola)')
  .option('--clear-products', 'Azzera i prodotti featured della settimana (l\'AI sceglie liberamente)')
  .action(async (slug: string, action: string | undefined, opts: Record<string, string | number | boolean>) => {
    const { cmdPlan } = await import('./commands/plan.ts');
    await cmdPlan(slug, { action: action ?? 'show', ...opts as any });
  });

program
  .command('dashboard <slug>')
  .description('Dashboard completa di un brand: stats, pipeline, stato autopilot')
  .action(async (slug: string) => {
    const { cmdDashboard } = await import('./commands/dashboard.ts');
    await cmdDashboard(slug);
  });

program
  .command('weekly-plan <slug> [action]')
  .description('Piano settimanale: show, plan (genera seeds), produce (genera post), render (genera immagini)')
  .option('--week <n>', 'Numero settimana (0-3)', parseInt)
  .option('--verbose', 'Mostra il verdetto QC del review immagini (con render)')
  .action(async (slug: string, action: string | undefined, opts: { week?: number; verbose?: boolean }) => {
    const { cmdWeeklyPlan } = await import('./commands/weekly-plan.ts');
    await cmdWeeklyPlan(slug, { action: action ?? 'show', ...opts });
  });

program
  .command('products <slug> [action]')
  .description('Prodotti: list (elenca), sync (reimporta dal sito e-commerce)')
  .action(async (slug: string, action: string | undefined) => {
    const { cmdProducts } = await import('./commands/products.ts');
    await cmdProducts(slug, { action: action ?? 'list' });
  });

program
  .command('people <slug> [action]')
  .description('Persone: list, add (--name --gender …), remove (--id)')
  .option('--name <text>', 'Nome persona')
  .option('--role <text>', 'Ruolo')
  .option('--description <text>', 'Descrizione')
  .option('--gender <g>', 'Genere (female/male)')
  .option('--ageRange <range>', 'Fascia età (es. 26-35)')
  .option('--kind <kind>', 'ai (genera foto) o real (default)')
  .option('--id <id>', 'ID persona (per remove)')
  .action(async (slug: string, action: string | undefined, opts: Record<string, string>) => {
    const { cmdPeople } = await import('./commands/people.ts');
    await cmdPeople(slug, { action: action ?? 'list', ...opts as any });
  });

program
  .command('gtm <slug>')
  .description('GTM Roadmap: fasi di crescita, KPI, strategia platform')
  .action(async (slug: string) => {
    const { cmdGtm } = await import('./commands/gtm.ts');
    await cmdGtm(slug);
  });

program
  .command('studio <slug> [action]')
  .description('Studio: visualizza e gestisci knowledge base, brand kit, persone, competitors, knowledge')
  .option('--about <text>', 'Descrizione brand (kit-update)')
  .option('--category <text>', 'Categoria brand (kit-update)')
  .option('--audience <text>', 'Target audience (kit-update)')
  .option('--style <text>', 'Stile visivo (kit-update)')
  .option('--language <lang>', 'Lingua post (kit-update)')
  .option('--colors <hex>', 'Colori brand separati da virgola (colors)')
  .option('--name <name>', 'Nome persona/competitor')
  .option('--role <role>', 'Ruolo persona')
  .option('--description <text>', 'Descrizione persona')
  .option('--kind <kind>', 'Tipo: real|ai (people) o direct|indirect (competitors)')
  .option('--gender <gender>', 'Genere persona AI: female|male|non-binary')
  .option('--ageRange <range>', 'Fascia età AI: 18-25|26-35|36-50|50+')
  .option('--vibe <vibe>', 'Stile AI: professional|casual|luxury|sporty|creative|natural')
  .option('--title <title>', 'Titolo nota (add-note)')
  .option('--text <text>', 'Testo nota (add-note)')
  .option('--website <url>', 'Sito web competitor')
  .option('--compKind <kind>', 'Tipo competitor: direct|indirect')
  .option('--rationale <text>', 'Motivo competitor')
  .option('--id <uuid>', 'ID da eliminare (people-delete, delete-doc, delete-competitor)')
  .action(async (slug: string, action: string | undefined, opts: Record<string, string>) => {
    const { cmdStudio } = await import('./commands/studio.ts');
    await cmdStudio(slug, { action: action ?? 'show', ...opts });
  });

program
  .command('voice <slug>')
  .description('Voice: tono, registro, regole per platform, parole vietate')
  .action(async (slug: string) => {
    const { cmdVoice } = await import('./commands/voice.ts');
    await cmdVoice(slug);
  });

program
  .command('content <slug>')
  .description('Content Library: tutti i post con filtri per status')
  .option('--status <status>', 'Filtra per status: all, pending_user, approved, scheduled, published, failed')
  .option('--clear <status>', 'Elimina in blocco i post con questo status (es. pending_user)')
  .action(async (slug: string, opts: { status?: string; clear?: string }) => {
    const { cmdContent } = await import('./commands/content.ts');
    await cmdContent(slug, opts);
  });

program
  .command('calendar <slug>')
  .description('Calendario mensile dei post schedulati')
  .option('--month <YYYY-MM>', 'Mese da visualizzare (default: mese corrente)')
  .action(async (slug: string, opts: { month?: string }) => {
    const { cmdCalendar } = await import('./commands/calendar.ts');
    await cmdCalendar(slug, opts);
  });

program
  .command('post <slug> <postId> [action]')
  .description('Post singolo: show, edit, regenerate, slide, reorder, video, render, approve, publish, reject, reschedule')
  .option('--caption <text>', 'Nuova caption')
  .option('--title <text>', 'Titolo (Reddit, carosello, link post)')
  .option('--link <url>', 'URL del link post ("" per rimuoverlo)')
  .option('--subreddit <name>', 'Subreddit di destinazione')
  .option('--firstComment <text>', 'Primo commento (hashtag / CTA)')
  .option('--imagePrompt <text>', 'Nuovo prompt immagine')
  .option('--media <url>', 'Media URL ("" per renderlo text-only)')
  .option('--format <format>', 'single_image | carousel | text_post | link_post | video')
  .option('--platforms <list>', 'Piattaforme (separata da virgola)')
  .option('--platformCaption <pair>', 'Caption per piattaforma: x="testo" (ripetibile)', (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option('--contentType <type>', 'Tipo contenuto')
  .option('--slot <datetime>', 'Data/ora slot')
  .option('--product <name>', 'Prodotto associato')
  .option('--scheduledFor <datetime>', 'Nuova data programmazione (reschedule)')
  .option('--instruction <text>', 'Cosa cambiare (regenerate, slide, video)')
  .option('--prompt <text>', 'Prompt completo sostitutivo (regenerate, slide)')
  .option('--index <n>', 'Indice slide, 0 = copertina (slide)')
  .option('--order <list>', 'Nuovo ordine slide, es. "0,2,1" (reorder)')
  .option('--duration <seconds>', 'Durata del clip in secondi (video)')
  .option('--script <text>', 'Battuta parlata/on-screen, tagliata sulla durata (video)')
  .option('--aspectRatio <ratio>', '9:16 | 1:1 | 16:9 | 4:3 | 3:4 | 21:9 (video)')
  .action(async (slug: string, postId: string, action: string | undefined, opts: Record<string, unknown>) => {
    const { cmdPost } = await import('./commands/post.ts');
    await cmdPost(slug, postId, { action: action ?? 'show', ...opts as any });
  });

program
  .command('seo <slug> [action]')
  .description('SEO: show, run (audit tecnico), plan, more (altre iniziative), asset --id, article --id')
  .option('--id <id>', 'ID iniziativa (anche solo il prefisso mostrato in tabella)')
  .option('--guidance <text>', 'Indicazione per le nuove iniziative (more)')
  .action(async (slug: string, action: string | undefined, opts: { id?: string; guidance?: string }) => {
    const { cmdSeo } = await import('./commands/seo.ts');
    await cmdSeo(slug, { action: action ?? 'show', ...opts });
  });

program
  .command('geo <slug> [action]')
  .description('GEO: show (share of voice, citazioni), run (audit), fix (genera artifact)')
  .action(async (slug: string, action: string | undefined) => {
    const { cmdGeo } = await import('./commands/geo.ts');
    await cmdGeo(slug, { action: action ?? 'show' });
  });

program
  .command('keywords <slug> [action]')
  .description('Keyword strategy: show, refresh (rigenera la ricerca)')
  .action(async (slug: string, action: string | undefined) => {
    const { cmdKeywords } = await import('./commands/keywords.ts');
    await cmdKeywords(slug, { action: action ?? 'show' });
  });

program
  .command('web <slug> [action]')
  .description('Blog: list, generate --topic, publish/unpublish/optimize/delete --id')
  .option('--status <status>', 'Filtro: all, draft, scheduled, published', 'all')
  .option('--topic <text>', 'Argomento dell\'articolo (generate)')
  .option('--id <id>', 'ID articolo (anche solo il prefisso mostrato in tabella)')
  .action(async (slug: string, action: string | undefined, opts: { status?: string; topic?: string; id?: string }) => {
    const { cmdWeb } = await import('./commands/web.ts');
    await cmdWeb(slug, { action: action ?? 'list', ...opts });
  });

program
  .command('ads <slug>')
  .description('Ads via Zernio: list, propose boosts, approve spend, create standalone')
  .option('--propose', 'Crea proposte di boost dai post organici migliori')
  .option('--approve <id>', 'Approva e lancia una campagna proposta (spende budget)')
  .option('--reject <id>', 'Rifiuta una proposta')
  .option('--duplicate <id>', 'Duplica una campagna live (copia in pausa, poi approva)')
  .option('--delete <id>', 'Elimina una campagna sulla piattaforma (storico conservato)')
  .option('--pause <id>', 'Metti in pausa una campagna attiva')
  .option('--resume <id>', 'Riattiva una campagna in pausa')
  .option('--ad <adId>', 'Singola creatività: con --pause/--resume agisce solo su quella ad')
  .option('--sync', 'Sincronizza ad account + metrics da Zernio')
  .option('--budget <amount>', 'Budget daily (con --approve o --create)')
  .option('--create', 'Crea proposta standalone (serve --name --headline)')
  .option('--platform <platform>', 'metaads|googleads|tiktokads|linkedinads|xads|pinterestads', 'metaads')
  .option('--name <name>', 'Nome campagna (--create)')
  .option('--headline <text>', 'Headline creative (--create)')
  .option('--body <text>', 'Body creative (--create)')
  .option('--url <url>', 'Landing page (--create)')
  .option('--image <url>', 'Image URL (--create)')
  .option('--goal <goal>', 'engagement|traffic|awareness|…')
  .action(async (slug: string, opts) => {
    const { cmdAds } = await import('./commands/ads.ts');
    await cmdAds(slug, opts);
  });

program
  .command('upgrade <slug>')
  .description('Upgrade piano — apre la pagina di checkout nel browser')
  .action(async (slug: string) => {
    const { cmdUpgrade } = await import('./commands/upgrade.ts');
    await cmdUpgrade(slug);
  });

program
  .command('update')
  .description('Aggiorna Anomalia CLI all\'ultima versione')
  .action(async () => {
    const { cmdUpdate } = await import('./commands/update.ts');
    await cmdUpdate();
  });

program
  .command('ai <slug>')
  .description('Chatta con l\'AI di Anomalia — tutto ciò che fa il chatbot web, da CLI')
  .option('--message <text>', 'Messaggio da inviare all\'AI')
  .option('--pipe', 'Output raw (per agenti AI)')
  .action(async (slug: string, opts: { message?: string; pipe?: boolean }) => {
    const { cmdAi } = await import('./commands/ai.ts');
    await cmdAi(slug, opts);
  });

program.parse();
