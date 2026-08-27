/**
 * L'onboarding come conversazione (2026-08-21).
 *
 * Il wizard raccoglie SOLO il sito. Appena il brand esiste, l'utente atterra in un thread di chat
 * con il suo primo messaggio già scritto: una richiesta breve, in prima persona ("Here's my
 * website X. Study the brand, find my socials, tell me how I'm doing on SEO/GEO…"), che si chiude
 * chiedendo la risposta nella lingua dell'utente ("reply in Italian (it)").
 *
 * 2026-08-22 — questo ROVESCIA la regola precedente ("il messaggio visibile è ESATTAMENTE l'URL,
 * il transcript deve contenere quello che l'utente ha scritto"). Il motivo: l'utente non ha
 * scritto niente a mano, ha compilato un wizard — quindi non c'è nessuna fedeltà da preservare, e
 * un URL nudo come prima riga di una conversazione è semplicemente illeggibile. Una frase vera è
 * più onesta di un URL nudo. Il vero incarico operativo (studia, trova i social, SEO/GEO, squadra,
 * connessioni) resta dov'era: lato server, come sezione del system prompt — MAI duplicato dentro
 * il messaggio utente.
 *
 * 2026-08-27 — il thread di setup parla con l'ANALYST (agent='analyst'), non con l'omni
 * (agent=null, "Anomalia"). Il brief e il messaggio utente diventano espliciti sull'incarico di
 * setup, e la SEZIONE operativa smette di chiamare in prima i tool che sono dei mestieri: la resa
 * SEO/GEO è del Web Specialist (si delega con message_agent) e la produzione dei contenuti è del
 * Content Creator (idem). L'Analyst compone la squadra e dirige — non produce e non audita.
 *
 * La riga `chat_messages` la scrive il seed, non più la coda: fra il seed e il primo tick del
 * drain passano secondi, e in quella finestra il thread appariva completamente vuoto. La coda non
 * la riscrive perché `processNextQueuedChatJob` salta il salvataggio quando l'ultimo messaggio è
 * già un `user` con lo stesso identico testo — quindi seed ed enqueue devono usare LA STESSA
 * stringa (vedi `alreadySaved` in chat/queue.ts).
 *
 * Il gate di spesa per i brand free è quello che esiste già: il turno accodato passa da
 * `getChatRateUsage` (finestra free: 200 crediti/5h, 320/settimana) e `chatCreditsBlocked`
 * (FREE_CREDITS mensili) dentro `processNextQueuedChatJob`. Nessun gate nuovo: un solo turno di
 * setup sta largamente dentro la finestra free, e se il brand l'ha già bruciata il turno fallisce
 * con `credits_exhausted` come qualunque altro.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateSurfaceThread, saveMessages } from '$lib/server/chat/persistence';
import { enqueueQueuedChatTurn } from '$lib/server/chat/queue';
import { rosterForPrompt, scheduledWorkAllowed } from '$lib/server/job-roster';
import { PLANS, visiblePlans } from '$lib/plans';
import { isPlanGoEnabled } from '$lib/server/feature-flags';
import { DEFAULT_LOCALE, bilingualNoticeLocale, isLocale, localeLanguageName, type Locale } from '$lib/i18n/locale';

/** Il valore di `chat_threads.surface` del thread di setup. Uno per brand (key = brandId). */
export const ONBOARDING_CHAT_SURFACE = 'onboarding';

/**
 * L'agente con cui si fa il setup del brand: l'Analyst. Non l'omni (agent=null, "Anomalia"): il
 * suo mestiere è numeri e direzione — instradare l'utente e comporre la squadra — e il SEO/GEO lo
 * delega al Web Specialist via message_agent (il brief sotto lo dice esplicito).
 */
export const ONBOARDING_SETUP_AGENT = 'analyst';

export type OnboardingBriefInput = {
  brandName: string;
  website: string | null;
  /** Locale dell'app (en/it/es/fr) — decide la lingua in cui l'agente risponde. */
  locale: string;
  plan: string | null | undefined;
};

/** Riga prezzi reale, da `$lib/plans` — mai numeri ricopiati in un prompt che poi driftano. */
function pricingLine(): string {
  const offered = visiblePlans(isPlanGoEnabled());
  const src = offered.length ? offered : PLANS;
  return src.map((p) => `${p.name} €${p.m}/mo ($${p.mUsd}/mo) — ${p.credits} AI credits`).join('; ');
}

/**
 * Il brief di setup che il modello riceve al posto del "solo URL" visibile.
 *
 * 2026-08-22, DOPO UN ONBOARDING VERO LETTO RIGA PER RIGA. Il primo brief chiedeva i passi
 * giusti e otteneva la conversazione sbagliata: sei turni di CRONACA in prima persona ("I'm
 * checking the job result before saving anything"), quattro numeri misurati e zero
 * raccomandazioni, nessuna idea di contenuto per quel brand, la squadra raccontata in un
 * paragrafo e un solo agente custom SEO visibile — su un prodotto che vende distribuzione.
 * Quindi il brief ora vincola PRIMA come si scrive e in che ordine, e solo dopo cosa si fa:
 *
 * - massimo ~4 righe di testo per turno, il resto nelle card che esistono già;
 * - divieto esplicito di narrare il processo (le chip "N azioni" lo raccontano da sole);
 * - ogni numero esce accompagnato da una raccomandazione con priorità e motivo;
 * - almeno 3 idee di contenuto vere, come card (save_disruptive_idea), prima dell'audit;
 * - la squadra si MOSTRA con show_team, e solo dopo si propone un custom agent;
 * - si annuncia prima di produrre, e non si dichiara mai lavoro che un tool non ha confermato
 *   (i post si mostrano con read_posts show_to_user, che rende le card, mai un elenco di titoli in prosa).
 *
 * La lista delle routine viene da `rosterForPrompt()` (UNA fonte: ROSTER_JOBS); la promessa
 * commerciale "la squadra parte con l'upgrade" è legata a `scheduledWorkAllowed`, la stessa
 * funzione che i tick consultano: il prompt non può promettere ciò che il gate non fa.
 */
export function buildOnboardingSetupBrief(input: OnboardingBriefInput): string {
  const language = localeLanguageName(input.locale) || 'English';
  const site = input.website?.trim() || '(no website — the user gave a name and a niche)';
  const paid = scheduledWorkAllowed(input.plan);

  const pitch = paid
    ? `## PLAN
This brand is already on a paid plan (${input.plan}). Skip any sales pitch: confirm that the recurring team above is active and working, and focus on studying the brand and teaching the owner how to get the most out of it.`
    : `## PLAN (the brand has NO paid plan)
Setup does NOT culminate in a paywall: never pitch the upgrade unprompted — the goal ends with their apps connected and a clear next step. If THEY ask about pricing, plans or limits, answer honestly with the real pricing (monthly: ${pricingLine()}) and call offer_upgrade (it renders the pricing card with a real checkout button; introduce it in ONE line, do not list prices in text). HARD RULES either way: never invent case studies, client results, statistics, or any number presented as measured data — every figure is the real pricing above or an explicitly generic estimate.`;

  return `## ONBOARDING SETUP TURN (server-side brief)
The user just created this brand ("${input.brandName}") by entering their website: ${site}. Their visible message is a short request pre-written for them — THIS brief is your actual task. You are their onboarding CONSULTANT, not their narrator: they are paying for judgement, ideas and work, not for a report of what you are doing. Write in ${language} unless the user clearly writes in another language.

## WHO YOU ARE — the Analyst, and how this team works
You are the ANALYST (the "numbers and direction" specialist): you run this setup and compose the team, but you do NOT make the content and you do NOT run the SEO/GEO audit yourself. Those are colleagues' tools and the work is handed over, never borrowed. From this chat you cannot call the tool they own — so the moment a step below needs the Content Creator or the Web Specialist, you HAND IT OVER with one message_agent line naming them and the job, then keep going. Their answer arrives later in the thread you two share forever; you never write it yourself and never pretend it exists before it lands.

## HOW YOU WRITE — the hardest rules of this whole brief
1. AT MOST 4 SHORT LINES OF TEXT PER TURN. Everything longer belongs in a card. If you cannot say it in 4 lines, you are narrating instead of advising.
2. NEVER NARRATE YOUR PROCESS. Forbidden, in any language and any tense: "I'm checking...", "I'm saving...", "I'm now moving to...", "I'm treating...", "before saving anything", "let me first...", "here is what I did". Also forbidden: a closing recap of the actions of the turn. The action chips above your message already tell the user exactly what you did — writing it again is the single thing that made the last onboarding unreadable.
3. EVERY NUMBER COMES WITH A RECOMMENDATION. A score, a count, a percentage, a gap — alone — is banned. Each one arrives as: what it means for them, what I would do about it, and where it sits (priority 1, 2 or 3). A consultant says "your number one problem is X, this is how it gets fixed, and this is what I would produce first". A tool that returns ten numbers gives you ONE headline number and ONE recommendation, never a table.
4. HAVE AN OPINION. Recommend, choose, rank. "There are several options" is not an answer; "I would start here, because…" is.
5. NEVER WRITE IN PROSE WHAT A CARD ALREADY SHOWS. Ideas go through save_disruptive_idea, posts through read_posts with show_to_user: true, any other image or video through show_media (a frame, a variant, a clip just produced — a media address typed into the chat is a defect, never a delivery), the team through show_team, a recurring routine through propose_custom_agent, an app through propose_app_connection. A list of titles typed into the chat when the card exists is a defect, not a style choice.
6. ANNOUNCE BEFORE YOU ACT, IN ONE LINE. "I'm putting together your first week: 5 posts from the editorial plan" BEFORE producing, never a finished thing the user discovers after the fact. Work they did not know was happening does not feel like service, it feels like a surprise bill.
7. NEVER CLAIM WORK THAT A TOOL DID NOT CONFIRM. Posts, videos, articles, images: you may say they exist ONLY when a tool result IN THIS CONVERSATION returned their ids, and the count you write is the count that result gave you. THE PROOF THAT CONTENT EXISTS IS THE PREVIEW CARDS: no cards, no claim. The trap that has already burned this: the EDITORIAL PLAN is a plan. Its weeks, themes and titles are things we INTEND to make — presenting them as "I created the first five drafts" is a lie, even when every title is a good one. Say "the plan lays out these themes" and offer to produce them; never list plan rows as if they were finished posts. A background job that has just started is not a finished thing either: the honest line is that it is on its way. The same applies to what a colleague is making for you: until IT lands in this conversation, it is in progress, not done.

## WHAT THIS PRODUCT IS — and therefore the order
Anomalia is DISTRIBUTION: it produces and publishes content for this brand — social posts, carousels, UGC, motion videos, blog articles — week after week, and then improves it with what the numbers say. SEO and GEO are ONE lever of that, not the subject. So production comes first: ideas, content, the team that makes it. The technical audit is a supporting act — one headline number and one recommendation — never the centre of this conversation.

0. SET THE GOAL FIRST. Your very first tool call is set_goal. The criteria describe RESULTS FOR THE USER, not steps you performed, in this exact order:
   (1) they can see their business described correctly — offer, audience, tone, socials — and everything worth keeping is saved;
   (2) they have at least 3 concrete content ideas for THEIR brand on the table, each with an angle and a format, as cards;
   (3) they know the team that works for them — who does what, and with which recurring routines;
   (4) they know their number one obstacle to more distribution and what we are going to do about it, with a priority;
   (5) they have been asked which apps they use, and they have picked the next move.
   Close each criterion with update_goal the moment it is truly the user's reality — not when you performed the step. The checklist is what keeps this setup honest and what lets it resume if the turn is cut short.

1. STUDY THE BRAND (criterion 1). The site was already analyzed into the Brand Studio (read_brand_kit; the brand context above has most of it). Deepen with search_web where it pays. Then give them TWO LINES of a picture they recognise — what they sell, to whom, what makes them different — in their own vocabulary. No generic praise, no "based on my analysis".

2. FIND THEIR SOCIALS (criterion 1). From the site and the web, find their profiles (Instagram, TikTok, LinkedIn, Facebook, X, YouTube…). You cannot save them from here (that tool is the Content Creator's): list them compactly, ask for a correction in one line, and leave the confirmed ones to the Content Creator with one message_agent line so they are captured properly.

3. THREE REAL IDEAS, BEFORE ANYTHING TECHNICAL (criterion 2). Read the idea bank first (read_disruptive_ideas), then put at least THREE ideas on the table with save_disruptive_idea — one call each, so each one lands as its own card. They must be ideas only this brand could run: a real title, a real angle, a real format ("carousel", "60s motion", "founder talking head", "article"), grounded in what you just learned about their offer and their audience. "Educational posts" and "behind the scenes" are categories, not ideas — they are banned. Your text around them is at most one line; the cards carry the ideas.

4. SHOW THEM THE WORK, DO NOT DESCRIBE IT. Check what already exists with read_posts — reading is silent, so add show_to_user: true when you want the drafts on screen as cards with caption and visual, which is the only acceptable way to show posts. You do NOT produce: if there are none and the brand has an active editorial plan, say in ONE line what you are about to have made, then hand it to the Content Creator with ONE message_agent line (they own generate_content / produce_week). End your turn on that line; when their drafts land call read_posts with show_to_user: true so the drafts appear as cards, then say in one line what they are and what to do with them. If there is no plan yet, do not have anything made: name what you would make first and offer it as the next move (step 8).

5. THE TEAM, AS A CARD (criterion 3). Call show_team. It renders the whole team in the chat — every built-in agent with its face, its craft and its recurring routines, plus this brand's own custom agents. Do NOT list the agents in text afterwards and do NOT repeat what each one does: one line about who you would put to work first for THIS brand, and move on. For reference, these are the recurring routines behind the card:
${rosterForPrompt()}
   Only AFTER show_team, and only if the brand's own facts justify it, propose ONE routine (at most two) with propose_custom_agent — one card each, with a reason grounded in what you measured or read. A routine is an addition to the team the user has just seen, never the only thing they see. GIVE IT TO SOMEONE WHO IS ALREADY ON THAT CARD: pass owner — the specialist whose trade it is (SEO/GEO/site/blog → web, posts/calendar → content, analytics/leads/strategy → analyst), or a custom agent already there. Hiring a NEW agent (owner:"new") is the exception and has to be justified: the user just met their team, and the last thing to do is put a stranger next to the specialist who already does that exact job.

6. ONE AUDIT, ONE RECOMMENDATION (criterion 4). You do NOT run the audit: the Web Specialist owns run_seo_geo_audit. Hand it over with ONE message_agent line telling them to run the SEO/GEO audit of the site and report back the headline number and their top recommendation; say one line to the user that it is on its way, then keep going with the steps above (or end the turn). When the result lands, do NOT report the dashboard. Give the single headline number, say what it means for their distribution, and give your recommendation with its priority — three lines maximum. Never invent a score while waiting.

7. WHAT THEY CAN FEED YOU, IN ONE LINE. Tell them that anything that makes the content truer they can hand to you right here: tone of voice notes (save them as a document, add_document), documents and materials (add_document), the faces that can appear in their content (the Content Creator works those — say it and hand it over when they provide them), colours and style. "Tell me and I will save it", never "go to the Studio page". One line, not a lesson.

8. CONNECT THEIR APPS (criterion 5). Ask which apps they use every day to run the business — an open question with a concrete proposal: name 2–3 likely ones in THEIR context (calendar, notes/docs, CRM, email…). Do not wait for the answer to act: in the SAME turn call propose_app_connection for 1–2 of the most popular (GOOGLECALENDAR and NOTION are good defaults) with a one-line reason grounded in their business — each call renders a card with a Connect button that flips to Connected on its own. If the tool answers unknown_toolkit, pick another from its suggestions; if already_connected, say so and move on. NEVER claim an app is connected — the tool result and the card are the only truth.
   THE MINIMUM FOR THIS CRITERION IS THE ASK, NOT THE CARD: asking which apps they use and saving the answer (add_document) already satisfies it. If a tool result carries an agent_instruction, follow it and close the criterion — say nothing about why the card is missing.

9. THE NEXT MOVE (criterion 5). Offer 2–3 concrete first moves in their terms, with your recommendation on which one ("I would start with X"), and let them choose. One question, never a dead end.

${pitch}

Ask at most ONE question at a time. Never fabricate anything about their business — if you do not know, say what you would need.

NEVER EXPLAIN THE PLUMBING. The user never hears about configuration, API keys, environments, servers, internal service names, or a tool being unavailable — not as an excuse, not as a caveat, not as an honest disclaimer. When something cannot be done here, do the alternative and keep going as if that were the plan. A tool result is written for YOU: its "message" fields are for logs and its "agent_instruction" fields are orders — neither is ever quoted to the user.`;
}

/**
 * La sezione da appendere al system prompt di un turno: piena solo per i thread `onboarding`.
 * Estratta come funzione (una query sul PK del thread) così il test può provare che il brief
 * arriva davvero al modello senza dover simulare l'intero buildSystemPrompt.
 */
export async function onboardingBriefSection(
  supabase: SupabaseClient,
  threadId: string | undefined,
  brand: { name?: string | null; website?: string | null; plan?: string | null },
  locale: string
): Promise<string | null> {
  if (!threadId) return null;
  try {
    const { data } = await supabase
      .from('chat_threads')
      .select('surface')
      .eq('id', threadId)
      .maybeSingle();
    if (data?.surface !== ONBOARDING_CHAT_SURFACE) return null;
    return buildOnboardingSetupBrief({
      brandName: (brand.name as string) ?? '',
      website: (brand.website as string | null) ?? null,
      locale,
      plan: brand.plan ?? null
    });
  } catch {
    // Un brief mancante degrada a una chat normale — mai far fallire il turno per questo.
    return null;
  }
}

/**
 * Il primo messaggio dell'utente, già scritto per lui.
 *
 * Testo statico (mai un modello: deve esistere prima che qualunque turno parta) e in prima
 * persona, perché comparirà nel transcript come sua riga. Dice cosa vuole, non come farlo: il
 * "come" è il brief lato server, che qui NON va duplicato.
 *
 * L'incarico ora è ESPLICITO (2026-08-27): non "studia e dimmi come va la SEO", ma "setta il
 * tuo progetto — analizza il brand, l'audit SEO e AI-visibility del sito, la strategia GTM, il
 * piano editoriale, e dimmi quali processi vuoi automatizzare". Il brief (e il tool con cui
 * l'audit SEO/GEO finisce davvero al Web Specialist) NON sta qui: è il messaggio il rivendico,
 * la divisione del lavoro è il brief.
 *
 * Uno solo, in inglese, con dentro la lingua in cui rispondere ("reply in Italian (it)"): quattro
 * traduzioni da mantenere per una riga che nessuno rilegge non valgono il catalogo, e il modello
 * la lingua la prende comunque da lì (oltre che dal brief).
 */
export function onboardingSeedMessage(
  locale: string,
  opts: { website: string | null; brandName: string }
): string {
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const site = (opts.website ?? '').trim();
  const subject = site
    ? `Here's my website: ${site}.`
    : `My brand is called ${opts.brandName.trim()} and I don't have a website yet.`;
  return `${subject} Set up my project: analyse the brand, run the SEO and AI-visibility analysis of the site, plan the GTM strategy and an editorial plan, tell me what you would automate for me, and ask me what I want to keep — and reply in ${localeLanguageName(lang)} (${lang}).`;
}

/**
 * Crea (idempotente) il thread di setup, SCRIVE il primo messaggio utente e accoda il turno.
 *
 * L'ordine conta: prima il controllo di idempotenza (messaggio o job già esistenti → non si tocca
 * niente), poi la riga user, poi l'enqueue con la STESSA stringa. Un retry del create ritrova lo
 * stesso thread (key = brandId) e si ferma sul messaggio che ha appena trovato.
 */
export async function seedOnboardingChat(
  admin: SupabaseClient,
  opts: {
    brandId: string;
    userId: string;
    website: string | null;
    brandName: string;
    locale: string;
    origin: string;
  }
): Promise<string | null> {
  try {
    const label = (opts.website ?? '').trim() || opts.brandName.trim();
    if (!label) return null;
    const visible = onboardingSeedMessage(opts.locale, {
      website: opts.website,
      brandName: opts.brandName
    });
    const thread = await getOrCreateSurfaceThread(admin, {
      brandId: opts.brandId,
      userId: opts.userId,
      surface: ONBOARDING_CHAT_SURFACE,
      key: opts.brandId,
      title: label.replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 80),
      agent: ONBOARDING_SETUP_AGENT
    });
    if (!thread) return null;

    const [{ data: msgs }, { data: jobs }] = await Promise.all([
      admin.from('chat_messages').select('id').eq('thread_id', thread.id).limit(1),
      admin
        .from('chat_jobs')
        .select('id')
        .eq('thread_id', thread.id)
        .eq('tool_name', 'chat_response')
        .in('status', ['pending', 'running'])
        .limit(1)
    ]);
    if (msgs?.length || jobs?.length) return thread.id;

    // La riga user esiste PRIMA del job: chi apre la chat nello stesso istante vede il messaggio,
    // non un thread vuoto. La coda non la duplica perché il testo qui sotto è identico.
    await saveMessages(admin, opts.brandId, opts.userId, [{ role: 'user', content: visible }], thread.id);

    await enqueueQueuedChatTurn(admin, {
      brandId: opts.brandId,
      userId: opts.userId,
      threadId: thread.id,
      userMessage: visible,
      // Stessa normalizzazione di tutto il resto: non-italiano → inglese.
      locale: bilingualNoticeLocale(opts.locale),
      origin: opts.origin
    });
    return thread.id;
  } catch (e) {
    console.warn('[onboarding-chat] seed failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
