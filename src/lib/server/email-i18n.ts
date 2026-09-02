import { IntlMessageFormat } from 'intl-messageformat';
import { DEFAULT_LOCALE, isLocale, type Locale } from '$lib/i18n/locale';

// Server-side email copy. We deliberately do NOT use the svelte-i18n store here: it's a
// client/component-oriented singleton, unsafe under concurrent server requests. A plain
// dictionary rendered with intl-messageformat gives us correct ICU plurals per recipient.
// Note: ICU uses ' as an escape char, so we use typographic apostrophes (’) in copy.

type Dict = Record<string, string>;

const EMAIL: Record<Locale, Dict> = {
  en: {
    // Notifica scritta da un agente della chat (notify_user): il testo è suo, la cornice è nostra.
    'agent.subject': '{brand}: {subject}',
    'agent.eyebrow': 'From your {brand} AI agent',
    'agent.cta': 'Open Anomalia →',
    'agent.footer':
      'You’re getting this because you’re part of the {brand} project on Anomalia. Manage email and push notifications in Settings.',
    'approval.subject': '{brand}: {count, plural, one {# post} other {# posts}} ready to approve',
    'approval.heading': '{brand}: {count, plural, one {# post} other {# posts}} ready',
    'approval.intro':
      'Anomalia planned this week. Approve and it’ll post on schedule — no login needed.',
    'approval.cta': 'Approve all & schedule →',
    'approval.footer': 'If you didn’t expect this, just ignore it. Link expires in 3 days.',
    'scheduler.subject':
      '{brand}: {count, plural, one {# new post} other {# new posts}} ready to approve',
    'scheduler.heading': '{brand}: {count, plural, one {# new post} other {# new posts}} ready',
    'scheduler.intro':
      'Your recurring planner just put together {count, plural, one {# on-brand post} other {# on-brand posts}}. Approve and they’ll post on schedule — no login needed.',
    'scheduler.cta': 'Approve all & schedule →',
    'scheduler.footer':
      'Anomalia runs your planner automatically. Manage or pause it in Settings. Link expires in 3 days.',
    'conflict.subject': '{brand}: {count, plural, one {# time slot is} other {# time slots are}} double-booked',
    'conflict.heading': '{brand}: {count, plural, one {# calendar clash} other {# calendar clashes}}',
    'conflict.intro':
      'You have {count, plural, one {# time slot with two or more posts} other {# time slots with two or more posts each}} set to go out at the same moment. Open the calendar and let the AI rebalance the schedule for you.',
    'conflict.cta': 'Fix the calendar →',
    'conflict.footer': 'On the calendar, tap “Rearrange with AI” and it’ll spread the posts out for you.',
    'recap.subject': '{brand}: your social strategy is ready',
    'recap.heading': '{brand} is ready to launch',
    'recap.intro':
      'Anomalia finished building your strategy: {competitors, plural, one {# competitor} other {# competitors}} analysed, buyer personas, a {weeks}-week editorial plan and a full strategy report. Review everything and start whenever you are ready.',
    'recap.cta': 'Review & start →',
    'recap.footer':
      'Everything is saved to your workspace — nothing was published. You decide what goes live.',
    'strategy_plan.subject': '{brand}: strategy and editorial plan ready',
    'strategy_plan.heading': 'Strategy and editorial plan ready',
    'strategy_plan.intro':
      'Anomalia finished studying your market. Your strategy report and {weeks}-week editorial plan for {brand} are ready to review.',
    'strategy_plan.cta': 'Review strategy & plan →',
    'strategy_plan.footer':
      'Nothing was published — open the link to review and continue onboarding whenever you like.',
    'auth.reset.subject': 'Reset your Anomalia password',
    'auth.reset.heading': 'Reset your password',
    'auth.reset.intro':
      'We got a request to reset the password for your Anomalia account. Tap the button below to choose a new one. The link expires in 1 hour.',
    'auth.reset.cta': 'Set a new password →',
    'auth.reset.footer': 'If you didn’t request this, you can safely ignore this email — your password won’t change.',
    'recap_weekly.subject': '{brand} — your weekly recap ({week})',
    'recap_weekly.heading': '{brand}: weekly recap',
    'recap_weekly.subheading': 'Week of {week}',
    'recap_weekly.stats_title': 'This week\u2019s numbers',
    'recap_weekly.stat_published': 'Posts published',
    'recap_weekly.stat_engagement': 'Engagement',
    'recap_weekly.stat_impressions': 'Impressions',
    'recap_weekly.delta_label': 'Trend vs last week',
    'recap_weekly.no_prev_data': 'First week \u2014 no comparison data yet',
    'recap_weekly.prev_week': 'last week',
    'recap_weekly.saves': 'Saves',
    'recap_weekly.stat_link_clicks': 'Link clicks',
    'recap_weekly.visual_insights': 'Visual insights',
    'recap_weekly.webkpis.title': 'Rank tracking',
    'recap_weekly.webkpis.summary': 'tracked: {tracked} · improved: {improved} · worsened: {worsened}',
    'recap_weekly.webkpis.top_movers': 'Top improvements',
    'recap_weekly.pending_posts': '{count, plural, one {# post waiting for your approval} other {# posts waiting for your approval}}',
    'recap_weekly.top_post': 'Top post',
    'recap_weekly.weak_reviews.title': 'Weakest media this week',
    'recap_weekly.weak_reviews.lede':
      'These posts scored lowest this week. Want to redo the visual, or leave them as-is?',
    'recap_weekly.weak_reviews.open_post': 'Open post \u2192',
    'recap_weekly.weak_reviews.see_all': 'See all reviews \u2192',
    'recap_weekly.weak_reviews.verdict.fix': 'Needs a fix',
    'recap_weekly.weak_reviews.verdict.kill': 'Redo',
    'recap_weekly.weak_reviews.verdict.ship': 'OK',
    'recap_weekly.weak_reviews.score': '{score}/10',
    'recap_weekly.by_platform': 'By platform',
    'recap_weekly.trends': 'Trending in your space',
    'recap_weekly.suggestions': 'AI suggestions',
    'recap_weekly.actions': 'Action items',
    'recap_weekly.scheduled': 'scheduled',
    'recap_weekly.connected_accounts': 'Connected accounts',
    'recap_weekly.accounts_note': 'Data collected from these platforms.',
    'recap_weekly.no_accounts_title': 'No social accounts connected',
    'recap_weekly.no_accounts_desc': 'Connect your social accounts so Anomalia can publish posts, track engagement, and give you better suggestions.',
    'recap_weekly.cta': 'Open dashboard \u2192',
    'recap_weekly.footer': 'Sent every Monday by Anomalia. Manage your preferences in Settings.',
    'recap_weekly.growth.title': 'Growth data readiness',
    'recap_weekly.growth.blocked': '{n, plural, one {# required fix before produce} other {# required fixes before produce}}',
    'recap_weekly.growth.warn': '{n, plural, one {# recommended improvement} other {# recommended improvements}}',
    'recap_weekly.growth.lede_blocked':
      'Produce and autopilot are paused until you fix the items below. Thin brand data yields generic posts that will not grow organically.',
    'recap_weekly.growth.lede_warn':
      'You can produce, but strengthening these inputs makes captions and visuals more distinctive.',
    'recap_weekly.growth.fix': 'Fix \u2192',
    'recap_weekly.growth.required': 'Required',
    'recap_weekly.growth.check.about': 'Add a clear brand About in Studio',
    'recap_weekly.growth.check.voice': 'Define voice / personality',
    'recap_weekly.growth.check.history': 'Sync at least 5 past posts with metrics',
    'recap_weekly.growth.check.historyDepth': 'Sync more past posts (aim for 12+)',
    'recap_weekly.growth.check.competitors': 'Add at least one competitor',
    'recap_weekly.growth.check.audience': 'Define the target audience',
    'recap_weekly.growth.check.products': 'Add products / services',
    'recap_weekly.growth.check.visual': 'Set visual style',
    'recap_weekly.growth.check.knowledge': 'Add Studio Knowledge notes or docs',
    'recap_weekly.growth.check.plan': 'Approve an editorial plan with personality',
    'digest.subject': 'Yesterday on {brand}: {count, plural, one {# post} other {# posts}}',
    'digest.heading': '{brand}: {count, plural, one {# post} other {# posts}} published yesterday',
    'digest.intro':
      'Here’s what went live for {brand} yesterday — tap a post to see it live.',
    'digest.footer': 'Sent daily by Anomalia. Manage your preferences in Settings.',
    'invite.subject': '{inviter} invited you to {brand} on Anomalia',
    'invite.heading': 'Join {brand} on Anomalia',
    'invite.intro':
      '{inviter} invited you to collaborate on {brand}. Accept the invite to plan, review and manage its content together.',
    'invite.cta': 'Accept invite \u2192',
    'invite.footer':
      'The invite expires in 7 days. If you don\u2019t have an Anomalia account yet, sign up with this email address ({email}) to see it.',
    'credit_warning.subject': '{brand}: {percent}% of AI credits used',
    'credit_warning.heading': 'AI credits alert',
    'credit_warning.intro':
      '{brand} has used {used} of {quota} AI credits this billing period ({percent}%). Your credits reset on {resetDate}.',
    'credit_warning.cta': 'View usage \u2192',
    'credit_warning.footer':
      'Upgrade your plan for more credits, or wait for the reset. This is a one-time alert per billing period.',
    // ── Lifecycle drip (welcome + day-1 call + day-2/3 next-step) ────────────────────────────
    'welcome.subject': 'Welcome to Anomalia 👋 let’s set up {brand}',
    'welcome.heading': 'Welcome to Anomalia, {name} 👋',
    'welcome.intro':
      'From here, AI plans, writes and designs your social content in {brand}’s voice. You just approve — the rest runs on autopilot.',
    'welcome.call_lead':
      'The fastest way to start right? 15 minutes with us: we set your brand up and show you how to ship a full week of content in 10 minutes.',
    'welcome.cta': 'Book your call →',
    'welcome.steps_title': 'Your next steps to set up {brand}:',
    'welcome.step.studio': 'Complete Brand Studio',
    'welcome.step.strategy': 'Generate your strategy',
    'welcome.step.plan': 'Generate your editorial plan',
    'welcome.step.blog': 'Customize your blog',
    'welcome.step.radar': 'Activate Radar for news and leads',
    'welcome.step.seo': 'SEO/GEO analysis for your site',
    'welcome.footer': 'Questions? Just reply to this email — it comes straight to us.',
    'lifecycle.day1.subject': '{name}, 15 minutes to get {brand} live?',
    'lifecycle.day1.heading': 'Let’s set up {brand} together',
    'lifecycle.day1.intro':
      'Yesterday you created {brand} on Anomalia — don’t leave it half-done. The “wow” moment (a full week of on-brand posts) is just a couple of steps away.',
    'lifecycle.day1.body':
      'Easiest way is to do it together: 15 minutes, we set it all up and you leave with your first week ready.',
    'pending.subject': 'Your Anomalia access — one call away',
    'pending.heading': 'One last step',
    'pending.body':
      'You signed up for Anomalia. We open access after a short call: fifteen minutes to understand what you sell and set up the first week together. Pick a time — your access switches on right after.',
    'lifecycle.cta_call': 'Book your call →',
    'lifecycle.or_self': 'Prefer solo? Pick up your next steps:',
    'lifecycle.footer': 'Reply to this email anytime — it comes straight to us.',
    'lifecycle.step.subject': '{brand}: your next step → {step}',
    'lifecycle.step.heading': '{brand}: your next step',
    'lifecycle.step.intro_day3': 'Still a step away — let’s not lose momentum.',
    'lifecycle.step.or_call': 'Want us to do it with you? Book 15 minutes:',
    'lifecycle.step.cta_call': 'Book a call →',
    'lifecycle.step.title.studio': 'Complete Brand Studio',
    'lifecycle.step.title.strategy': 'Generate your strategy',
    'lifecycle.step.title.plan': 'Generate your editorial plan',
    'lifecycle.step.title.generate': 'Generate your content',
    'lifecycle.step.title.approve': 'Approve your posts',
    'lifecycle.step.title.connect': 'Connect your socials',
    'lifecycle.step.title.publish': 'Go live',
    'lifecycle.step.line.studio': 'Give Anomalia a little more about {brand} so it can write just like you.',
    'lifecycle.step.line.strategy': 'Your Brand Studio is set 👏 Now generate your strategy — it guides every post.',
    'lifecycle.step.line.plan': 'Your strategy is ready 👏 Next, generate your editorial plan.',
    'lifecycle.step.line.generate': 'Your editorial plan is ready 👏 Time for the fun part: generate your first week of posts.',
    'lifecycle.step.line.approve': 'Your week of posts is ready 👏 Review and approve them.',
    'lifecycle.step.line.connect': 'Posts approved 👏 Connect your social accounts to publish.',
    'lifecycle.step.line.publish': 'You’re connected 👏 Turn on autopilot and go live.',
    'prepublish.subject':
      '{brand}: {count, plural, one {# scheduled post was held back} other {# scheduled posts were held back}}',
    'prepublish.heading':
      '{brand}: {count, plural, one {a post did not go live} other {# posts did not go live}}',
    'prepublish.intro':
      'Anomalia stopped this from publishing because it looked broken or empty. It is back in your drafts — fix it and approve again.',
    'prepublish.reason': 'Why: {reason}',
    'prepublish.cta': 'Open drafts →',
    'prepublish.footer': 'This last-minute check runs just before publish so empty or broken posts never go out.'
  },
  it: {
    // Notifica scritta da un agente della chat (notify_user): il testo è suo, la cornice è nostra.
    'agent.subject': '{brand}: {subject}',
    'agent.eyebrow': 'Dal tuo agente AI di {brand}',
    'agent.cta': 'Apri Anomalia →',
    'agent.footer':
      'Ricevi questa email perché fai parte del progetto {brand} su Anomalia. Gestisci email e notifiche push dalle Impostazioni.',
    'approval.subject': '{brand}: {count, plural, one {# post} other {# post}} da approvare',
    'approval.heading': '{brand}: {count, plural, one {# post pronto} other {# post pronti}}',
    'approval.intro':
      'Anomalia ha pianificato questa settimana. Approva e pubblicherà secondo il programma — senza login.',
    'approval.cta': 'Approva tutto e programma →',
    'approval.footer':
      'Se non te lo aspettavi, ignora pure questa email. Il link scade tra 3 giorni.',
    'scheduler.subject':
      '{brand}: {count, plural, one {# nuovo post} other {# nuovi post}} da approvare',
    'scheduler.heading':
      '{brand}: {count, plural, one {# nuovo post pronto} other {# nuovi post pronti}}',
    'scheduler.intro':
      'Il tuo planner ricorrente ha appena preparato {count, plural, one {# post on-brand} other {# post on-brand}}. Approva e pubblicheranno secondo il programma — senza login.',
    'scheduler.cta': 'Approva tutto e programma →',
    'scheduler.footer':
      'Anomalia gestisce il tuo planner in automatico. Gestiscilo o mettilo in pausa nelle Impostazioni. Il link scade tra 3 giorni.',
    'conflict.subject': '{brand}: {count, plural, one {# orario in conflitto} other {# orari in conflitto}}',
    'conflict.heading': '{brand}: {count, plural, one {# sovrapposizione nel calendario} other {# sovrapposizioni nel calendario}}',
    'conflict.intro':
      'Hai {count, plural, one {# orario con due o più post} other {# orari con due o più post ciascuno}} in uscita nello stesso momento. Apri il calendario e lascia che l’AI riorganizzi la programmazione per te.',
    'conflict.cta': 'Sistema il calendario →',
    'conflict.footer': 'Nel calendario, tocca “Riorganizza con l’AI” e distribuirà i post al posto tuo.',
    'recap.subject': '{brand}: la tua strategia social è pronta',
    'recap.heading': '{brand} è pronto a partire',
    'recap.intro':
      'Anomalia ha costruito la tua strategia: {competitors, plural, one {# competitor analizzato} other {# competitor analizzati}}, le buyer personas, un piano editoriale di {weeks} settimane e un report di strategia completo. Rivedi tutto e parti quando sei pronto.',
    'recap.cta': 'Rivedi e parti →',
    'recap.footer':
      'È tutto salvato nel tuo workspace — non è stato pubblicato niente. Decidi tu cosa va online.',
    'strategy_plan.subject': '{brand}: strategia e piano editoriale pronti',
    'strategy_plan.heading': 'Strategia e piano editoriale pronti',
    'strategy_plan.intro':
      'Anomalia ha finito di studiare il tuo mercato. Il report di strategia e il piano editoriale di {weeks} settimane per {brand} sono pronti da rivedere.',
    'strategy_plan.cta': 'Rivedi strategia e piano →',
    'strategy_plan.footer':
      'Non è stato pubblicato niente — apri il link per rivedere e continuare l’onboarding quando vuoi.',
    'auth.reset.subject': 'Reimposta la tua password Anomalia',
    'auth.reset.heading': 'Reimposta la password',
    'auth.reset.intro':
      'Abbiamo ricevuto una richiesta di reimpostazione della password per il tuo account Anomalia. Tocca il pulsante qui sotto per sceglierne una nuova. Il link scade tra 1 ora.',
    'auth.reset.cta': 'Imposta una nuova password →',
    'auth.reset.footer':
      'Se non sei stato tu, ignora pure questa email — la tua password non cambierà.',
    'recap_weekly.subject': '{brand} — il tuo recap settimanale ({week})',
    'recap_weekly.heading': '{brand}: recap settimanale',
    'recap_weekly.subheading': 'Settimana del {week}',
    'recap_weekly.stats_title': 'I numeri di questa settimana',
    'recap_weekly.stat_published': 'Post pubblicati',
    'recap_weekly.stat_engagement': 'Engagement',
    'recap_weekly.stat_impressions': 'Impressioni',
    'recap_weekly.delta_label': 'Trend vs settimana scorsa',
    'recap_weekly.no_prev_data': 'Prima settimana — nessun dato di confronto',
    'recap_weekly.prev_week': 'sett. scorsa',
    'recap_weekly.saves': 'Salvataggi',
    'recap_weekly.stat_link_clicks': 'Click sui link',
    'recap_weekly.visual_insights': 'Insight visivi',
    'recap_weekly.webkpis.title': 'Monitoraggio posizioni',
    'recap_weekly.webkpis.summary': 'tracciate: {tracked} · migliorate: {improved} · peggiorate: {worsened}',
    'recap_weekly.webkpis.top_movers': 'Miglioramenti principali',
    'recap_weekly.pending_posts': '{count, plural, one {# post in attesa di approvazione} other {# post in attesa di approvazione}}',
    'recap_weekly.top_post': 'Post migliore',
    'recap_weekly.weak_reviews.title': 'Media da rivedere',
    'recap_weekly.weak_reviews.lede':
      'Questi post hanno lo score più basso della settimana. Vuoi rifare il visual, o li lasci così?',
    'recap_weekly.weak_reviews.open_post': 'Apri post \u2192',
    'recap_weekly.weak_reviews.see_all': 'Vedi tutte le review \u2192',
    'recap_weekly.weak_reviews.verdict.fix': 'Da sistemare',
    'recap_weekly.weak_reviews.verdict.kill': 'Da rifare',
    'recap_weekly.weak_reviews.verdict.ship': 'Ok',
    'recap_weekly.weak_reviews.score': '{score}/10',
    'recap_weekly.by_platform': 'Per piattaforma',
    'recap_weekly.trends': 'Trend nel tuo settore',
    'recap_weekly.suggestions': 'Suggerimenti AI',
    'recap_weekly.actions': 'Azioni da compiere',
    'recap_weekly.scheduled': 'schedulati',
    'recap_weekly.connected_accounts': 'Account connessi',
    'recap_weekly.accounts_note': 'Dati raccolti da queste piattaforme.',
    'recap_weekly.no_accounts_title': 'Nessun account social connesso',
    'recap_weekly.no_accounts_desc': 'Connetti i tuoi account social così Anomalia può pubblicare post, tracciare l\u2019engagement e darti suggerimenti migliori.',
    'recap_weekly.cta': 'Apri dashboard \u2192',
    'recap_weekly.footer': 'Inviata ogni lunedì da Anomalia. Gestisci le preferenze nelle Impostazioni.',
    'recap_weekly.growth.title': 'Dati pronti per la crescita',
    'recap_weekly.growth.blocked': '{n, plural, one {# correzione obbligatoria prima di produrre} other {# correzioni obbligatorie prima di produrre}}',
    'recap_weekly.growth.warn': '{n, plural, one {# miglioramento consigliato} other {# miglioramenti consigliati}}',
    'recap_weekly.growth.lede_blocked':
      'Produce e autopilot sono in pausa finché non sistemi i punti sotto. Dati brand troppo magri generano post generici che non crescono.',
    'recap_weekly.growth.lede_warn':
      'Puoi produrre, ma rafforzare questi input rende caption e visual più distintivi.',
    'recap_weekly.growth.fix': 'Sistema \u2192',
    'recap_weekly.growth.required': 'Obbligatorio',
    'recap_weekly.growth.check.about': 'Aggiungi un About chiaro in Studio',
    'recap_weekly.growth.check.voice': 'Definisci voce / personalità',
    'recap_weekly.growth.check.history': 'Sincronizza almeno 5 post passati con metriche',
    'recap_weekly.growth.check.historyDepth': 'Sincronizza più post passati (punta a 12+)',
    'recap_weekly.growth.check.competitors': 'Aggiungi almeno un competitor',
    'recap_weekly.growth.check.audience': 'Definisci il pubblico target',
    'recap_weekly.growth.check.products': 'Aggiungi prodotti / servizi',
    'recap_weekly.growth.check.visual': 'Imposta lo stile visuale',
    'recap_weekly.growth.check.knowledge': 'Aggiungi note o documenti in Knowledge',
    'recap_weekly.growth.check.plan': 'Approva un piano editoriale con personalità',
    'digest.subject': 'Ieri su {brand}: {count, plural, one {# post} other {# post}} pubblicati',
    'digest.heading': '{brand}: {count, plural, one {# post} other {# post}} pubblicati ieri',
    'digest.intro':
      'Ecco cosa è andato online per {brand} ieri — tocca un post per vederlo live.',
    'digest.footer': 'Inviata ogni giorno da Anomalia. Gestisci le preferenze nelle Impostazioni.',
    'invite.subject': '{inviter} ti ha invitato su {brand} in Anomalia',
    'invite.heading': 'Unisciti a {brand} su Anomalia',
    'invite.intro':
      '{inviter} ti ha invitato a collaborare su {brand}. Accetta l’invito per pianificare, rivedere e gestire i contenuti insieme.',
    'invite.cta': 'Accetta l’invito →',
    'invite.footer':
      'L\u2019invito scade tra 7 giorni. Se non hai ancora un account Anomalia, registrati con questo indirizzo email ({email}) per vederlo.',
    'credit_warning.subject': '{brand}: {percent}% dei crediti AI utilizzati',
    'credit_warning.heading': 'Avviso crediti AI',
    'credit_warning.intro':
      '{brand} ha utilizzato {used} di {quota} crediti AI in questo periodo di fatturazione ({percent}%). I crediti si rinnovano il {resetDate}.',
    'credit_warning.cta': 'Vedi utilizzo \u2192',
      'credit_warning.footer':
        'Passa a un piano superiore per avere pi\u00f9 crediti, o attendi il rinnovo. Questo \u00e8 un avviso una tantum per periodo di fatturazione.',
    // \u2500\u2500 Lifecycle drip (welcome + day-1 call + day-2/3 next-step) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    'welcome.subject': 'Benvenuto in Anomalia \ud83d\udc4b impostiamo {brand}',
    'welcome.heading': 'Benvenuto in Anomalia, {name} \ud83d\udc4b',
    'welcome.intro':
      'Da qui l\u2019AI pianifica, scrive e disegna i tuoi contenuti social nella voce di {brand}. Tu approvi \u2014 il resto \u00e8 in autopilota.',
    'welcome.call_lead':
      'Il modo pi\u00f9 veloce per partire col piede giusto? 15 minuti con noi: ti impostiamo il brand e ti mostriamo come sfornare una settimana di contenuti in 10 minuti.',
    'welcome.cta': 'Prenota la tua call \u2192',
    'welcome.steps_title': 'I tuoi prossimi passi per impostare {brand}:',
    'welcome.step.studio': 'Completa il Brand Studio',
    'welcome.step.strategy': 'Genera la strategia',
    'welcome.step.plan': 'Genera il piano editoriale',
    'welcome.step.blog': 'Personalizza il blog',
    'welcome.step.radar': 'Attiva il Radar per notizie e lead',
    'welcome.step.seo': 'Analisi SEO/GEO per il tuo sito',
    'welcome.footer': 'Domande? Rispondi a questa email \u2014 arriva dritta a noi.',
    'lifecycle.day1.subject': '{name}, ci prendiamo 15 minuti per {brand}?',
    'lifecycle.day1.heading': 'Impostiamo {brand} insieme',
    'lifecycle.day1.intro':
      'Ieri hai creato {brand} su Anomalia \u2014 non lasciarlo a met\u00e0. Il momento \u201cwow\u201d (una settimana di post nel tuo stile) \u00e8 a un paio di step.',
    'lifecycle.day1.body':
      'Il modo pi\u00f9 semplice \u00e8 farlo insieme: 15 minuti, impostiamo tutto noi e parti gi\u00e0 con la prima settimana.',
    'pending.subject': 'Il tuo accesso ad Anomalia — manca una call',
    'pending.heading': 'Manca un ultimo passo',
    'pending.body':
      'Ti sei iscritto ad Anomalia. Apriamo l’accesso dopo una call breve: quindici minuti per capire cosa vendi e impostare insieme la prima settimana. Scegli quando ti va meglio — l’accesso si accende appena finita.',
    'lifecycle.cta_call': 'Prenota la tua call \u2192',
    'lifecycle.or_self': 'Preferisci da solo? Riparti dai prossimi passi:',
    'lifecycle.footer': 'Rispondi a questa email quando vuoi \u2014 arriva dritta a noi.',
    'lifecycle.step.subject': '{brand}: il tuo prossimo passo \u2192 {step}',
    'lifecycle.step.heading': '{brand}: il tuo prossimo passo',
    'lifecycle.step.intro_day3': 'Sei ancora a un passo \u2014 non perdiamo lo slancio.',
    'lifecycle.step.or_call': 'Vuoi che lo facciamo insieme? Prenota 15 minuti:',
    'lifecycle.step.cta_call': 'Prenota una call \u2192',
    'lifecycle.step.title.studio': 'Completa il Brand Studio',
    'lifecycle.step.title.strategy': 'Genera la strategia',
    'lifecycle.step.title.plan': 'Genera il piano editoriale',
    'lifecycle.step.title.generate': 'Genera i contenuti',
    'lifecycle.step.title.approve': 'Approva i post',
    'lifecycle.step.title.connect': 'Collega i social',
    'lifecycle.step.title.publish': 'Vai live',
    'lifecycle.step.line.studio': 'Dai ad Anomalia qualche dettaglio in pi\u00f9 su {brand}, cos\u00ec scrive proprio come te.',
    'lifecycle.step.line.strategy': 'Il Brand Studio \u00e8 pronto \ud83d\udc4f Ora genera la strategia \u2014 guida ogni post.',
    'lifecycle.step.line.plan': 'La strategia \u00e8 pronta \ud83d\udc4f Ora genera il piano editoriale.',
    'lifecycle.step.line.generate': 'Il piano editoriale \u00e8 pronto \ud83d\udc4f Arriva la parte bella: genera la tua prima settimana di post.',
    'lifecycle.step.line.approve': 'La tua settimana di post \u00e8 pronta \ud83d\udc4f Rivedila e approva.',
    'lifecycle.step.line.connect': 'Post approvati \ud83d\udc4f Collega i tuoi profili social per pubblicare.',
    'lifecycle.step.line.publish': 'Sei collegato \ud83d\udc4f Attiva l\u2019autopilota e vai live.',
    'prepublish.subject':
      '{brand}: {count, plural, one {# post programmato bloccato} other {# post programmati bloccati}}',
    'prepublish.heading':
      '{brand}: {count, plural, one {un post non \u00e8 andato online} other {# post non sono andati online}}',
    'prepublish.intro':
      'Anomalia ha fermato la pubblicazione perch\u00e9 il post sembrava rotto o vuoto. \u00c8 di nuovo tra le bozze \u2014 sistemalo e approva di nuovo.',
    'prepublish.reason': 'Perch\u00e9: {reason}',
    'prepublish.cta': 'Apri le bozze \u2192',
    'prepublish.footer':
      'Questo controllo all\u2019ultimo minuto parte poco prima della pubblicazione, cos\u00ec i post vuoti o rotti non escono.'
  },
  es: {
    // Notifica escrita por un agente del chat (notify_user): el texto es suyo, el marco es nuestro.
    'agent.subject': '{brand}: {subject}',
    'agent.eyebrow': 'De tu agente de IA de {brand}',
    'agent.cta': 'Abrir Anomalia →',
    'agent.footer':
      'Recibes este email porque formas parte del proyecto {brand} en Anomalia. Gestiona los emails y las notificaciones push en Ajustes.',
    'approval.subject': '{brand}: {count, plural, one {# post} other {# posts}} por aprobar',
    'approval.heading': '{brand}: {count, plural, one {# post listo} other {# posts listos}}',
    'approval.intro':
      'Anomalia planificó esta semana. Aprueba y publicará según el calendario — sin iniciar sesión.',
    'approval.cta': 'Aprobar todo y programar →',
    'approval.footer': 'Si no esperabas este mensaje, ignóralo. El enlace expira en 3 días.',
    'scheduler.subject':
      '{brand}: {count, plural, one {# nuevo post} other {# nuevos posts}} por aprobar',
    'scheduler.heading':
      '{brand}: {count, plural, one {# nuevo post listo} other {# nuevos posts listos}}',
    'scheduler.intro':
      'Tu planificador recurrente acaba de preparar {count, plural, one {# post fiel a la marca} other {# posts fieles a la marca}}. Aprueba y se publicarán según el calendario — sin iniciar sesión.',
    'scheduler.cta': 'Aprobar todo y programar →',
    'scheduler.footer':
      'Anomalia gestiona tu planificador automáticamente. Gestionalo o pausalo en Configuración. El enlace expira en 3 días.',
    'conflict.subject': '{brand}: {count, plural, one {# horario en conflicto} other {# horarios en conflicto}}',
    'conflict.heading': '{brand}: {count, plural, one {# conflicto en el calendario} other {# conflictos en el calendario}}',
    'conflict.intro':
      'Tienes {count, plural, one {# horario con dos o más posts} other {# horarios con dos o más posts cada uno}} programados para el mismo momento. Abre el calendario y deja que la IA reorganice el horario por ti.',
    'conflict.cta': 'Corregir el calendario →',
    'conflict.footer': 'En el calendario, pulsa "Reorganizar con la IA" y distribuirá los posts por ti.',
    'recap.subject': '{brand}: tu estrategia social está lista',
    'recap.heading': '{brand} está listo para arrancar',
    'recap.intro':
      'Anomalia terminó de construir tu estrategia: {competitors, plural, one {# competidor analizado} other {# competidores analizados}}, las buyer personas, un plan editorial de {weeks} semanas y un informe de estrategia completo. Revisa todo y arranca cuando estés listo.',
    'recap.cta': 'Revisar y arrancar →',
    'recap.footer':
      'Todo está guardado en tu espacio de trabajo — no se publicó nada. Tú decides qué se publica.',
    'strategy_plan.subject': '{brand}: estrategia y plan editorial listos',
    'strategy_plan.heading': 'Estrategia y plan editorial listos',
    'strategy_plan.intro':
      'Anomalia terminó de estudiar tu mercado. El informe de estrategia y el plan editorial de {weeks} semanas para {brand} están listos para revisar.',
    'strategy_plan.cta': 'Revisar estrategia y plan →',
    'strategy_plan.footer':
      'No se publicó nada — abre el enlace para revisar y continuar el onboarding cuando quieras.',
    'auth.reset.subject': 'Restablecer tu contraseña de Anomalia',
    'auth.reset.heading': 'Restablecer tu contraseña',
    'auth.reset.intro':
      'Recibimos una solicitud para restablecer la contraseña de tu cuenta de Anomalia. Pulsa el botón de abajo para elegir una nueva. El enlace expira en 1 hora.',
    'auth.reset.cta': 'Establecer nueva contraseña →',
    'auth.reset.footer':
      'Si no fuiste tú, simplemente ignora este correo — tu contraseña no cambiará.',
    'recap_weekly.subject': '{brand} — tu resumen semanal ({week})',
    'recap_weekly.heading': '{brand}: resumen semanal',
    'recap_weekly.subheading': 'Semana del {week}',
    'recap_weekly.stats_title': 'Los números de esta semana',
    'recap_weekly.stat_published': 'Posts publicados',
    'recap_weekly.stat_engagement': 'Engagement',
    'recap_weekly.stat_impressions': 'Impresiones',
    'recap_weekly.delta_label': 'Tendencia vs semana pasada',
    'recap_weekly.no_prev_data': 'Primera semana — sin datos de comparación',
    'recap_weekly.prev_week': 'sem. pasada',
    'recap_weekly.saves': 'Guardados',
    'recap_weekly.pending_posts': '{count, plural, one {# post esperando aprobación} other {# posts esperando aprobación}}',
    'recap_weekly.top_post': 'Mejor post',
    'recap_weekly.weak_reviews.title': 'Media a revisar',
    'recap_weekly.weak_reviews.lede':
      'Estos posts tienen la puntuación más baja de la semana. ¿Quieres rehacer el visual o dejarlos así?',
    'recap_weekly.weak_reviews.open_post': 'Abrir post \u2192',
    'recap_weekly.weak_reviews.see_all': 'Ver todas las reviews \u2192',
    'recap_weekly.weak_reviews.verdict.fix': 'Hay que corregir',
    'recap_weekly.weak_reviews.verdict.kill': 'Hay que rehacer',
    'recap_weekly.weak_reviews.verdict.ship': 'OK',
    'recap_weekly.weak_reviews.score': '{score}/10',
    'recap_weekly.by_platform': 'Por plataforma',
    'recap_weekly.trends': 'Tendencias en tu sector',
    'recap_weekly.suggestions': 'Sugerencias IA',
    'recap_weekly.actions': 'Acciones a realizar',
    'recap_weekly.scheduled': 'programados',
    'recap_weekly.connected_accounts': 'Cuentas conectadas',
    'recap_weekly.accounts_note': 'Datos recopilados de estas plataformas.',
    'recap_weekly.no_accounts_title': 'Ninguna cuenta social conectada',
    'recap_weekly.no_accounts_desc': 'Conecta tus cuentas sociales para que Anomalia pueda publicar posts, rastrear el engagement y darte mejores sugerencias.',
    'recap_weekly.cta': 'Abrir dashboard →',
    'recap_weekly.footer': 'Enviada cada lunes por Anomalia. Gestiona tus preferencias en Configuración.',
    'recap_weekly.growth.title': 'Datos listos para crecer',
    'recap_weekly.growth.blocked': '{n, plural, one {# corrección obligatoria antes de producir} other {# correcciones obligatorias antes de producir}}',
    'recap_weekly.growth.warn': '{n, plural, one {# mejora recomendada} other {# mejoras recomendadas}}',
    'recap_weekly.growth.lede_blocked':
      'Produce y el piloto automático están en pausa hasta que corrijas los puntos de abajo. Datos de marca pobres generan posts genéricos que no crecen.',
    'recap_weekly.growth.lede_warn':
      'Puedes producir, pero reforzar estos inputs hace captions y visuales más distintivos.',
    'recap_weekly.growth.fix': 'Corregir →',
    'recap_weekly.growth.required': 'Obligatorio',
    'recap_weekly.growth.check.about': 'Añade un About claro en Studio',
    'recap_weekly.growth.check.voice': 'Define voz / personalidad',
    'recap_weekly.growth.check.history': 'Sincroniza al menos 5 posts pasados con métricas',
    'recap_weekly.growth.check.historyDepth': 'Sincroniza más posts pasados (apunta a 12+)',
    'recap_weekly.growth.check.competitors': 'Añade al menos un competidor',
    'recap_weekly.growth.check.audience': 'Define el público objetivo',
    'recap_weekly.growth.check.products': 'Añade productos / servicios',
    'recap_weekly.growth.check.visual': 'Define el estilo visual',
    'recap_weekly.growth.check.knowledge': 'Añade notas o docs en Knowledge',
    'recap_weekly.growth.check.plan': 'Aprueba un plan editorial con personalidad',
    'invite.subject': '{inviter} te ha invitado a {brand} en Anomalia',
    'invite.heading': 'Únete a {brand} en Anomalia',
    'invite.intro':
      '{inviter} te ha invitado a colaborar en {brand}. Acepta la invitación para planificar, revisar y gestionar el contenido juntos.',
    'invite.cta': 'Aceptar invitación →',
    'invite.footer':
      'La invitación expira en 7 días. Si aún no tienes una cuenta de Anomalia, regístrate con esta dirección de correo ({email}) para verla.',
    'credit_warning.subject': '{brand}: {percent}% de créditos IA utilizados',
    'credit_warning.heading': 'Alerta de créditos IA',
    'credit_warning.intro':
      '{brand} ha utilizado {used} de {quota} créditos IA en este período de facturación ({percent}%). Tus créditos se restablecen el {resetDate}.',
    'credit_warning.cta': 'Ver uso →',
    'credit_warning.footer':
      'Cambia a un plan superior para obtener más créditos, o espera al restablecimiento. Esta es una alerta única por período de facturación.',
    // ── Lifecycle drip (welcome + day-1 call + day-2/3 next-step) ────────────────────────────
    'welcome.subject': 'Bienvenido a Anomalia 👋 configuremos {brand}',
    'welcome.heading': 'Bienvenido a Anomalia, {name} 👋',
    'welcome.intro':
      'Desde aquí la IA planifica, escribe y diseña tu contenido social con la voz de {brand}. Tú solo apruebas — el resto va en piloto automático.',
    'welcome.call_lead':
      '¿La forma más rápida de empezar bien? 15 minutos con nosotros: configuramos tu marca y te mostramos cómo publicar una semana de contenido en 10 minutos.',
    'welcome.cta': 'Reserva tu llamada →',
    'welcome.steps_title': 'Tus próximos pasos para configurar {brand}:',
    'welcome.step.studio': 'Completa el Brand Studio',
    'welcome.step.strategy': 'Genera tu estrategia',
    'welcome.step.plan': 'Genera tu plan editorial',
    'welcome.step.blog': 'Personaliza tu blog',
    'welcome.step.radar': 'Activa el Radar para noticias y leads',
    'welcome.step.seo': 'Análisis SEO/GEO para tu sitio',
    'welcome.footer': '¿Dudas? Responde a este email — nos llega directamente.',
    'lifecycle.day1.subject': '{name}, ¿15 minutos para poner {brand} en marcha?',
    'lifecycle.day1.heading': 'Configuremos {brand} juntos',
    'lifecycle.day1.intro':
      'Ayer creaste {brand} en Anomalia — no lo dejes a medias. El momento “wow” (una semana de posts con tu estilo) está a un par de pasos.',
    'lifecycle.day1.body':
      'Lo más fácil es hacerlo juntos: 15 minutos, lo configuramos todo y sales con tu primera semana lista.',
    'pending.subject': 'Tu acceso a Anomalia — falta una llamada',
    'pending.heading': 'Falta un último paso',
    'pending.body':
      'Te registraste en Anomalia. Abrimos el acceso tras una llamada breve: quince minutos para entender qué vendes y preparar juntos la primera semana. Elige cuándo — tu acceso se activa justo después.',
    'lifecycle.cta_call': 'Reserva tu llamada →',
    'lifecycle.or_self': '¿Prefieres solo? Retoma tus próximos pasos:',
    'lifecycle.footer': 'Responde a este email cuando quieras — nos llega directamente.',
    'lifecycle.step.subject': '{brand}: tu próximo paso → {step}',
    'lifecycle.step.heading': '{brand}: tu próximo paso',
    'lifecycle.step.intro_day3': 'Aún te falta un paso — no perdamos el impulso.',
    'lifecycle.step.or_call': '¿Quieres que lo hagamos contigo? Reserva 15 minutos:',
    'lifecycle.step.cta_call': 'Reservar una llamada →',
    'lifecycle.step.title.studio': 'Completa el Brand Studio',
    'lifecycle.step.title.strategy': 'Genera tu estrategia',
    'lifecycle.step.title.plan': 'Genera tu plan editorial',
    'lifecycle.step.title.generate': 'Genera tu contenido',
    'lifecycle.step.title.approve': 'Aprueba tus posts',
    'lifecycle.step.title.connect': 'Conecta tus redes',
    'lifecycle.step.title.publish': 'Publica en vivo',
    'lifecycle.step.line.studio': 'Dale a Anomalia un poco más sobre {brand} para que escriba igual que tú.',
    'lifecycle.step.line.strategy': 'Tu Brand Studio está listo 👏 Ahora genera tu estrategia — guía cada post.',
    'lifecycle.step.line.plan': 'Tu estrategia está lista 👏 Ahora genera tu plan editorial.',
    'lifecycle.step.line.generate': 'Tu plan editorial está listo 👏 Llega lo divertido: genera tu primera semana de posts.',
    'lifecycle.step.line.approve': 'Tu semana de posts está lista 👏 Revísala y apruébala.',
    'lifecycle.step.line.connect': 'Posts aprobados 👏 Conecta tus cuentas sociales para publicar.',
    'lifecycle.step.line.publish': 'Ya estás conectado 👏 Activa el piloto automático y publica.',
    'prepublish.subject':
      '{brand}: {count, plural, one {# post programado retenido} other {# posts programados retenidos}}',
    'prepublish.heading':
      '{brand}: {count, plural, one {un post no se publicó} other {# posts no se publicaron}}',
    'prepublish.intro':
      'Anomalia detuvo la publicación porque el post parecía roto o vacío. Volvió a tus borradores — corrígelo y aprueba de nuevo.',
    'prepublish.reason': 'Por qué: {reason}',
    'prepublish.cta': 'Abrir borradores →',
    'prepublish.footer':
      'Esta comprobación de último minuto se ejecuta justo antes de publicar para que los posts vacíos o rotos no salgan.'
  },
  fr: {
    // Notification écrite par un agent du chat (notify_user) : le texte est le sien, le cadre est le nôtre.
    'agent.subject': '{brand} : {subject}',
    'agent.eyebrow': 'De votre agent IA {brand}',
    'agent.cta': 'Ouvrir Anomalia →',
    'agent.footer':
      'Vous recevez cet email parce que vous faites partie du projet {brand} sur Anomalia. Gérez les emails et les notifications push dans les Réglages.',
    'approval.subject': '{brand}\u00a0: {count, plural, one {# post \u00e0 approuver} other {# posts \u00e0 approuver}}',
    'approval.heading': '{brand}\u00a0: {count, plural, one {# post pr\u00eat} other {# posts pr\u00eats}}',
    'approval.intro':
      'Anomalia a planifi\u00e9 cette semaine. Approuvez et elle publiera selon le calendrier \u2014 sans connexion.',
    'approval.cta': 'Tout approuver et programmer \u2192',
    'approval.footer':
      'Si vous ne vous attendiez pas \u00e0 ce message, ignorez-le. Le lien expire dans 3 jours.',
    'scheduler.subject':
      '{brand}\u00a0: {count, plural, one {# nouveau post} other {# nouveaux posts}} \u00e0 approuver',
    'scheduler.heading':
      '{brand}\u00a0: {count, plural, one {# nouveau post pr\u00eat} other {# nouveaux posts pr\u00eats}}',
    'scheduler.intro':
      'Votre planificateur r\u00e9current vient de pr\u00e9parer {count, plural, one {# post fid\u00e8le \u00e0 la marque} other {# posts fid\u00e8les \u00e0 la marque}}. Approuvez et ils seront publi\u00e9s selon le calendrier \u2014 sans connexion.',
    'scheduler.cta': 'Tout approuver et programmer \u2192',
    'scheduler.footer':
      'Anomalia g\u00e8re votre planificateur automatiquement. G\u00e9rez-le ou mettez-le en pause dans les Param\u00e8tres. Le lien expire dans 3 jours.',
    'conflict.subject': '{brand}\u00a0: {count, plural, one {# cr\u00e9neau en conflit} other {# cr\u00e9neaux en conflit}}',
    'conflict.heading': '{brand}\u00a0: {count, plural, one {# conflit dans le calendrier} other {# conflits dans le calendrier}}',
    'conflict.intro':
      'Vous avez {count, plural, one {# cr\u00e9neau avec deux posts ou plus} other {# cr\u00e9neaux avec deux posts ou plus chacun}} pr\u00e9vus au m\u00eame moment. Ouvrez le calendrier et laissez l\u2019IA r\u00e9\u00e9quilibrer le planning pour vous.',
    'conflict.cta': 'Corriger le calendrier \u2192',
    'conflict.footer': 'Dans le calendrier, appuyez sur \u00ab\u00a0R\u00e9organiser avec l\u2019IA\u00a0\u00bb et elle r\u00e9partira les posts pour vous.',
    'recap.subject': '{brand}\u00a0: votre strat\u00e9gie social est pr\u00eate',
    'recap.heading': '{brand} est pr\u00eat \u00e0 d\u00e9marrer',
    'recap.intro':
      'Anomalia a termin\u00e9 la construction de votre strat\u00e9gie\u00a0: {competitors, plural, one {# concurrent analys\u00e9} other {# concurrents analys\u00e9s}}, les buyer personas, un plan \u00e9ditorial de {weeks} semaines et un rapport de strat\u00e9gie complet. R\u00e9visez tout et lancez-vous quand vous \u00eates pr\u00eat.',
    'recap.cta': 'R\u00e9viser et d\u00e9marrer \u2192',
    'recap.footer':
      'Tout est sauvegard\u00e9 dans votre espace de travail \u2014 rien n\u2019a \u00e9t\u00e9 publi\u00e9. Vous d\u00e9cidez ce qui est mis en ligne.',
    'strategy_plan.subject': '{brand}\u00a0: strat\u00e9gie et plan \u00e9ditorial pr\u00eats',
    'strategy_plan.heading': 'Strat\u00e9gie et plan \u00e9ditorial pr\u00eats',
    'strategy_plan.intro':
      'Anomalia a fini d\u2019\u00e9tudier votre march\u00e9. Le rapport de strat\u00e9gie et le plan \u00e9ditorial de {weeks} semaines pour {brand} sont pr\u00eats \u00e0 revoir.',
    'strategy_plan.cta': 'Revoir strat\u00e9gie et plan \u2192',
    'strategy_plan.footer':
      'Rien n\u2019a \u00e9t\u00e9 publi\u00e9 \u2014 ouvrez le lien pour revoir et continuer l\u2019onboarding quand vous voulez.',
    'auth.reset.subject': 'R\u00e9initialiser votre mot de passe Anomalia',
    'auth.reset.heading': 'R\u00e9initialiser votre mot de passe',
    'auth.reset.intro':
      'Nous avons re\u00e7u une demande de r\u00e9initialisation du mot de passe pour votre compte Anomalia. Appuyez sur le bouton ci-dessous pour en choisir un nouveau. Le lien expire dans 1 heure.',
    'auth.reset.cta': 'D\u00e9finir un nouveau mot de passe \u2192',
    'auth.reset.footer':
      'Si vous n\u2019\u00eates pas \u00e0 l\u2019origine de cette demande, ignorez simplement cet e-mail \u2014 votre mot de passe ne changera pas.',
    'recap_weekly.subject': '{brand} \u2014 votre r\u00e9cap hebdomadaire ({week})',
    'recap_weekly.heading': '{brand}\u00a0: r\u00e9cap hebdomadaire',
    'recap_weekly.subheading': 'Semaine du {week}',
    'recap_weekly.stats_title': 'Les chiffres de cette semaine',
    'recap_weekly.stat_published': 'Posts publi\u00e9s',
    'recap_weekly.stat_engagement': 'Engagement',
    'recap_weekly.stat_impressions': 'Impressions',
    'recap_weekly.delta_label': 'Tendance vs semaine derni\u00e8re',
    'recap_weekly.no_prev_data': 'Premi\u00e8re semaine \u2014 pas encore de donn\u00e9es de comparaison',
    'recap_weekly.prev_week': 'sem. derni\u00e8re',
    'recap_weekly.saves': 'Enregistrements',
    'recap_weekly.pending_posts': '{count, plural, one {# post en attente d\u2019approbation} other {# posts en attente d\u2019approbation}}',
    'recap_weekly.top_post': 'Meilleur post',
    'recap_weekly.weak_reviews.title': 'Médias à revoir',
    'recap_weekly.weak_reviews.lede':
      'Ces posts ont le score le plus bas de la semaine. Voulez-vous refaire le visuel, ou les laisser tels quels\u00a0?',
    'recap_weekly.weak_reviews.open_post': 'Ouvrir le post \u2192',
    'recap_weekly.weak_reviews.see_all': 'Voir toutes les reviews \u2192',
    'recap_weekly.weak_reviews.verdict.fix': 'À corriger',
    'recap_weekly.weak_reviews.verdict.kill': 'À refaire',
    'recap_weekly.weak_reviews.verdict.ship': 'OK',
    'recap_weekly.weak_reviews.score': '{score}/10',
    'recap_weekly.by_platform': 'Par plateforme',
    'recap_weekly.trends': 'Tendances dans votre secteur',
    'recap_weekly.suggestions': 'Suggestions IA',
    'recap_weekly.actions': 'Actions \u00e0 mener',
    'recap_weekly.scheduled': 'programm\u00e9s',
    'recap_weekly.connected_accounts': 'Comptes connect\u00e9s',
    'recap_weekly.accounts_note': 'Donn\u00e9es collect\u00e9es depuis ces plateformes.',
    'recap_weekly.no_accounts_title': 'Aucun compte social connect\u00e9',
    'recap_weekly.no_accounts_desc': 'Connectez vos comptes sociaux pour qu\u2019Anomalia puisse publier des posts, suivre l\u2019engagement et vous donner de meilleures suggestions.',
    'recap_weekly.cta': 'Ouvrir le tableau de bord \u2192',
    'recap_weekly.footer': 'Envoy\u00e9e chaque lundi par Anomalia. G\u00e9rez vos pr\u00e9f\u00e9rences dans les Param\u00e8tres.',
    'recap_weekly.growth.title': 'Donn\u00e9es pr\u00eates pour la croissance',
    'recap_weekly.growth.blocked': '{n, plural, one {# correction obligatoire avant de produire} other {# corrections obligatoires avant de produire}}',
    'recap_weekly.growth.warn': '{n, plural, one {# am\u00e9lioration recommand\u00e9e} other {# am\u00e9liorations recommand\u00e9es}}',
    'recap_weekly.growth.lede_blocked':
      'Produce et le pilote automatique sont en pause jusqu\u2019\u00e0 ce que vous corrigiez les points ci-dessous. Des donn\u00e9es de marque trop minces donnent des posts g\u00e9n\u00e9riques qui ne croissent pas.',
    'recap_weekly.growth.lede_warn':
      'Vous pouvez produire, mais renforcer ces entr\u00e9es rend captions et visuels plus distinctifs.',
    'recap_weekly.growth.fix': 'Corriger \u2192',
    'recap_weekly.growth.required': 'Obligatoire',
    'recap_weekly.growth.check.about': 'Ajoutez un About clair dans Studio',
    'recap_weekly.growth.check.voice': 'D\u00e9finissez voix / personnalit\u00e9',
    'recap_weekly.growth.check.history': 'Synchronisez au moins 5 posts pass\u00e9s avec m\u00e9triques',
    'recap_weekly.growth.check.historyDepth': 'Synchronisez plus de posts pass\u00e9s (visez 12+)',
    'recap_weekly.growth.check.competitors': 'Ajoutez au moins un concurrent',
    'recap_weekly.growth.check.audience': 'D\u00e9finissez l\u2019audience cible',
    'recap_weekly.growth.check.products': 'Ajoutez produits / services',
    'recap_weekly.growth.check.visual': 'D\u00e9finissez le style visuel',
    'recap_weekly.growth.check.knowledge': 'Ajoutez notes ou docs dans Knowledge',
    'recap_weekly.growth.check.plan': 'Approuvez un plan \u00e9ditorial avec personnalit\u00e9',
    'invite.subject': '{inviter} vous a invit\u00e9 sur {brand} dans Anomalia',
    'invite.heading': 'Rejoignez {brand} sur Anomalia',
    'invite.intro':
      '{inviter} vous a invit\u00e9 \u00e0 collaborer sur {brand}. Acceptez l\u2019invitation pour planifier, r\u00e9viser et g\u00e9rer le contenu ensemble.',
    'invite.cta': 'Accepter l\u2019invitation \u2192',
    'invite.footer':
      'L\u2019invitation expire dans 7 jours. Si vous n\u2019avez pas encore de compte Anomalia, inscrivez-vous avec cette adresse e-mail ({email}) pour la voir.',
    'credit_warning.subject': '{brand}\u00a0: {percent}% des cr\u00e9dits IA utilis\u00e9s',
    'credit_warning.heading': 'Alerte cr\u00e9dits IA',
    'credit_warning.intro':
      '{brand} a utilis\u00e9 {used} sur {quota} cr\u00e9dits IA pour cette p\u00e9riode de facturation ({percent}%). Vos cr\u00e9dits se r\u00e9initialisent le {resetDate}.',
    'credit_warning.cta': 'Voir l\u2019utilisation \u2192',
    'credit_warning.footer':
      'Passez \u00e0 un forfait sup\u00e9rieur pour obtenir plus de cr\u00e9dits, ou attendez la r\u00e9initialisation. Ceci est une alerte unique par p\u00e9riode de facturation.',
    // \u2500\u2500 Lifecycle drip (welcome + day-1 call + day-2/3 next-step) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    'welcome.subject': 'Bienvenue sur Anomalia \ud83d\udc4b configurons {brand}',
    'welcome.heading': 'Bienvenue sur Anomalia, {name} \ud83d\udc4b',
    'welcome.intro':
      '\u00c0 partir d\u2019ici, l\u2019IA planifie, r\u00e9dige et con\u00e7oit ton contenu social dans la voix de {brand}. Tu valides \u2014 le reste tourne en pilote automatique.',
    'welcome.call_lead':
      'Le moyen le plus rapide de bien d\u00e9marrer ? 15 minutes avec nous : on configure ta marque et on te montre comment publier une semaine de contenu en 10 minutes.',
    'welcome.cta': 'R\u00e9serve ton appel \u2192',
    'welcome.steps_title': 'Tes prochaines \u00e9tapes pour configurer {brand} :',
    'welcome.step.studio': 'Compl\u00e8te le Brand Studio',
    'welcome.step.strategy': 'G\u00e9n\u00e8re ta strat\u00e9gie',
    'welcome.step.plan': 'G\u00e9n\u00e8re ton plan \u00e9ditorial',
    'welcome.step.blog': 'Personnalise ton blog',
    'welcome.step.radar': 'Active le Radar pour actus et leads',
    'welcome.step.seo': 'Analyse SEO/GEO pour ton site',
    'welcome.footer': 'Des questions ? R\u00e9ponds \u00e0 cet email \u2014 il nous arrive directement.',
    'lifecycle.day1.subject': '{name}, 15 minutes pour lancer {brand} ?',
    'lifecycle.day1.heading': 'Configurons {brand} ensemble',
    'lifecycle.day1.intro':
      'Hier tu as cr\u00e9\u00e9 {brand} sur Anomalia \u2014 ne le laisse pas \u00e0 moiti\u00e9. Le moment \u201cwaouh\u201d (une semaine de posts \u00e0 ton image) est \u00e0 quelques \u00e9tapes.',
    'lifecycle.day1.body':
      'Le plus simple, c\u2019est de le faire ensemble : 15 minutes, on configure tout et tu repars avec ta premi\u00e8re semaine pr\u00eate.',
    'pending.subject': 'Votre accès à Anomalia — un appel suffit',
    'pending.heading': 'Une dernière étape',
    'pending.body':
      'Vous vous êtes inscrit à Anomalia. Nous ouvrons l’accès après un court appel : quinze minutes pour comprendre ce que vous vendez et préparer ensemble la première semaine. Choisissez un créneau — votre accès s’active juste après.',
    'lifecycle.cta_call': 'R\u00e9serve ton appel \u2192',
    'lifecycle.or_self': 'Tu pr\u00e9f\u00e8res en solo ? Reprends tes prochaines \u00e9tapes :',
    'lifecycle.footer': 'R\u00e9ponds \u00e0 cet email quand tu veux \u2014 il nous arrive directement.',
    'lifecycle.step.subject': '{brand} : ta prochaine \u00e9tape \u2192 {step}',
    'lifecycle.step.heading': '{brand} : ta prochaine \u00e9tape',
    'lifecycle.step.intro_day3': 'Il te reste une \u00e9tape \u2014 ne perdons pas l\u2019\u00e9lan.',
    'lifecycle.step.or_call': 'Tu veux qu\u2019on le fasse avec toi ? R\u00e9serve 15 minutes :',
    'lifecycle.step.cta_call': 'R\u00e9server un appel \u2192',
    'lifecycle.step.title.studio': 'Compl\u00e8te le Brand Studio',
    'lifecycle.step.title.strategy': 'G\u00e9n\u00e8re ta strat\u00e9gie',
    'lifecycle.step.title.plan': 'G\u00e9n\u00e8re ton plan \u00e9ditorial',
    'lifecycle.step.title.generate': 'G\u00e9n\u00e8re ton contenu',
    'lifecycle.step.title.approve': 'Valide tes posts',
    'lifecycle.step.title.connect': 'Connecte tes r\u00e9seaux',
    'lifecycle.step.title.publish': 'Passe en ligne',
    'lifecycle.step.line.studio': 'Donne \u00e0 Anomalia un peu plus d\u2019infos sur {brand} pour qu\u2019elle \u00e9crive comme toi.',
    'lifecycle.step.line.strategy': 'Ton Brand Studio est pr\u00eat \ud83d\udc4f G\u00e9n\u00e8re maintenant ta strat\u00e9gie \u2014 elle guide chaque post.',
    'lifecycle.step.line.plan': 'Ta strat\u00e9gie est pr\u00eate \ud83d\udc4f G\u00e9n\u00e8re maintenant ton plan \u00e9ditorial.',
    'lifecycle.step.line.generate': 'Ton plan \u00e9ditorial est pr\u00eat \ud83d\udc4f Place au meilleur : g\u00e9n\u00e8re ta premi\u00e8re semaine de posts.',
    'lifecycle.step.line.approve': 'Ta semaine de posts est pr\u00eate \ud83d\udc4f Relis-la et valide.',
    'lifecycle.step.line.connect': 'Posts valid\u00e9s \ud83d\udc4f Connecte tes comptes sociaux pour publier.',
    'lifecycle.step.line.publish': 'Tu es connect\u00e9 \ud83d\udc4f Active le pilote automatique et passe en ligne.',
    'prepublish.subject':
      '{brand}\u00a0: {count, plural, one {# post programm\u00e9 bloqu\u00e9} other {# posts programm\u00e9s bloqu\u00e9s}}',
    'prepublish.heading':
      '{brand}\u00a0: {count, plural, one {un post n\u2019est pas parti} other {# posts ne sont pas partis}}',
    'prepublish.intro':
      'Anomalia a stopp\u00e9 la publication parce que le post semblait cass\u00e9 ou vide. Il est de nouveau dans tes brouillons \u2014 corrige-le et r\u00e9approuve.',
    'prepublish.reason': 'Pourquoi\u00a0: {reason}',
    'prepublish.cta': 'Ouvrir les brouillons \u2192',
    'prepublish.footer':
      'Cette v\u00e9rification de derni\u00e8re minute tourne juste avant la publication pour que les posts vides ou cass\u00e9s ne sortent pas.'
  }
};

export function emailLocale(v: string | null | undefined): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export function tEmail(locale: Locale, key: string, vars?: Record<string, unknown>): string {
  const dict = EMAIL[locale] ?? EMAIL[DEFAULT_LOCALE];
  const msg = dict[key] ?? EMAIL[DEFAULT_LOCALE][key] ?? key;
  return new IntlMessageFormat(msg, locale).format(vars) as string;
}
