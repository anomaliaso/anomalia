import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import { buildMemoryContext } from '$lib/server/brand-memory';
import { renderCompetitorsSection, renderProductsSection } from '$lib/server/brand-design-doc';
import { getOnboardingState, reconcileOnboardingState, saveOnboardingState } from '$lib/server/onboarding';
import { filesIndexFor } from '$lib/server/chat/agent-files';
import {
  buildAgentHead,
  GROUNDING_BLOCK,
  ORCHESTRATION_BLOCK,
  WORK_ETHIC_BLOCK,
  type AgentId
} from '$lib/server/chat/agents';
import { REPLY_CONTRACT_BLOCK } from '$lib/server/chat/reply-contract';
import { leadsBriefForPrompt } from '$lib/server/strategy-agent-reads';
import { remaining } from '$lib/server/usage';
import { countCalendarConflicts, formatInZone } from '$lib/server/schedule';
import { buildClockSection } from '$lib/server/clock';
import { listAgentNotices, loadBrandWarnings, renderNotificationsBlock } from '$lib/server/brand-warnings';
import { fetchChatUserContext, buildUserSection } from '$lib/server/chat/user-context';
import { formatDemoAccountPrompt } from '$lib/server/demo-account';
import { platformTermsSystemSection } from '$lib/platform-terms';
import { PLAN_LABELS } from '$lib/server/plans';
import { canConnectSocials, hasSocialPublishing, isPaidPlan } from '$lib/plans';
import { isPlanGoEnabled } from '$lib/server/feature-flags';
import { buildConnectorsPrompt } from '$lib/composio-agent';
import { isConnectorKind, listedForToolkit } from '$lib/composio-catalog';
import { aiActSystemSection } from '$lib/ai-act';
import { buildDisruptiveIdeasSection } from '$lib/server/disruptive-ideas';
import { chatReplyLanguageBlock, localeLanguageName } from '$lib/i18n/locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type HubPack = 'brand' | 'publish' | 'grow' | 'web';

/**
 * QUALE MESTIERE RICEVE QUALE DUMP PROFONDO.
 *
 * Fino al 23/8/2026 questa tabella non esisteva: `wantsPack` faceva `agentId === pack`, e finché
 * gli id dei mestieri ERANO `brand|publish|grow|web` funzionava per coincidenza. Il rename del
 * 21/8 (`AGENT_IDS` → `content|ugc|motion|web|analyst`) ha rotto la coincidenza senza che
 * TypeScript avesse niente da dire — `'web'` appartiene a entrambe le unioni — e per due giorni
 * TUTTI e cinque i mestieri hanno avuto `needBrand = needPublish = needGrow = false`: niente
 * media library, niente strategia, niente GTM, niente piano editoriale, niente post recenti.
 *
 * I pacchetti restano quattro perché quattro sono i corpi di dati (Studio+media, piano+coda,
 * strategia+GTM+lead, SEO+blog); i mestieri sono cinque. La corrispondenza NON è 1:1 e va scritta
 * a mano — la detta la stessa fusione già dichiarata in `LEGACY_AGENT_MAP` (agents.ts):
 *
 * - `content` ← `brand` + `publish` + `media`. Scrivere un post, tenerne la voce e produrne la
 *   grafica sono lo stesso mestiere: gli servono ENTRAMBI i pacchetti, o il Content Creator
 *   pianifica senza il piano e sceglie una foto senza il catalogo.
 * - `analyst` ← `grow`. La sua `area` dichiara "strategia GTM, radar e leads": è l'unico che li
 *   riceve, ed è quello a cui mancavano di più.
 * - `web` ← `seo`. SEO/GEO, articoli, pagine indicizzate.
 * - `motion` e `ugc`: nessun pacchetto. Producono un file, non pianificano, e da quando il
 *   documento Studio è `brand/studio.md` (brand-file.ts) non hanno più nemmeno quello nel prompt:
 *   se gli serve il catalogo o la palette, lo aprono.
 *
 * `Record<AgentId, …>` è metà della riparazione: un id nuovo senza riga qui adesso NON compila.
 * L'altra metà è `system-prompt.packs.test.ts`, perché il difetto è durato due giorni esattamente
 * perché nessun test legava le due liste.
 */
export const AGENT_PACKS: Record<AgentId, readonly HubPack[]> = {
  content: ['brand', 'publish'],
  analyst: ['grow'],
  web: ['web'],
  motion: [],
  ugc: []
};

/**
 * `MAKER_AGENTS` NON ESISTE PIÙ, e con lui `needStudioDoc` (deciso il 23/8, sulla richiesta
 * esplicita lasciata qui da chi ha riparato i pacchetti).
 *
 * Serviva a UNA cosa sola: dare a `motion` e `ugc` il documento Studio intero anche senza il
 * pacchetto `brand`, perché quello che producono È il brand reso visibile. Da oggi quel documento
 * non si compone più nel prompt — è `brand/studio.md` (chat/brand-file.ts) — e i file NON hanno
 * mestiere: `motion` e `ugc` lo leggono esattamente come tutti gli altri, quando serve. Il set
 * sopravvissuto sarebbe rimasto a governare due `fetch` (prodotti, concorrenti) il cui risultato
 * per quei due mestieri non veniva renderizzato da nessuna sezione: due query a turno per nessuno.
 *
 * Le due condizioni sono adesso quelle dei blocchi che li stampano DAVVERO, e niente di più.
 */

/** Null agent (Anomalia auto) gets every hub pack; specialists get identity + their own packs. */
function wantsPack(
  agentId: AgentId | null,
  pack: HubPack,
  opts?: { webHubEnabled?: boolean }
): boolean {
  if (pack === 'web' && opts?.webHubEnabled === false) return false;
  return !agentId || AGENT_PACKS[agentId].includes(pack);
}

/**
 * Build the system prompt for the AI chatbot by assembling brand context from the database.
 * Rebuilt every chat turn, so agent switches pick up the right hub pack.
 */
export async function buildSystemPrompt(
  supabase: SupabaseClient,
  brand: AnyRec,
  locale: string = 'en',
  agentId: AgentId | null = null,
  opts?: {
    consultation?: boolean;
    webHubEnabled?: boolean;
    threadId?: string;
    userId?: string;
    /**
     * La chiave sotto cui questo turno legge la propria memoria di mestiere (brand-memory.ts):
     * `custom:<uuid>` per un agente custom. Assente ⇒ vale `agentId`.
     */
    memoryAgent?: string | null;
  }
): Promise<string> {
  const brandId = brand.id as string;
  const orgId = (brand.org_id as string | null) ?? null;
  const webHubEnabled = opts?.webHubEnabled !== false;
  // Go (€29) is experimental — FEATURE_PLAN_GO may hide it from pricing while existing Go subs keep working.
  const planGoOffered = isPlanGoEnabled();
  const paidPlansLabel = planGoOffered ? 'Go, Starter, or Pro' : 'Starter or Pro';
  const needBrand = wantsPack(agentId, 'brand', opts);
  const needPublish = wantsPack(agentId, 'publish', opts);
  const needGrow = wantsPack(agentId, 'grow', opts);
  const needWeb = wantsPack(agentId, 'web', opts);

  // Parallel fetches — always pull shared identity + whatever hub packs this agent needs.
  const [
    { data: kit },
    { data: brandStrategy },
    { data: editorialPlan },
    { data: gtmPlan },
    { data: recentPosts },
    { data: products },
    { data: mediaLibrary },
    { data: competitors },
    { data: socialAccounts },
    { data: seoAudit },
    { data: seoPlan },
    { data: articles },
    { data: leadRows },
    { data: sitePages },
    { data: connectorRows },
    { data: demoAccount }
  ] = await Promise.all([
    supabase.from('brand_kit').select('*').eq('brand_id', brandId).maybeSingle(),
    // Always fetch these — needed for onboarding reconcile even when the hub pack skips deep dumps.
    supabase.from('brand_strategy').select('report, positioning').eq('brand_id', brandId).maybeSingle(),
    supabase
      .from('editorial_plans')
      .select('strategy, voice, cadence, platform_mix, weeks')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('gtm_plans')
      .select('horizon, objective, phases')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('posts')
      .select('id, platform, caption, status, scheduled_for, slot, published_url, content_type, pillar')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(20),
    needPublish || needWeb
      ? supabase.from('products').select('id, title, description, pricing, kind, featured, url, images').eq('brand_id', brandId)
      : Promise.resolve({ data: null }),
    needBrand || needPublish
      ? supabase
          .from('brand_media')
          .select(
            'id, kind, title, description, tags, subjects, media_kind, suggested_use, when_to_use, how_to_use, where_to_use, width, height, catalog_status, file_name, times_used, last_used_at'
          )
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(40)
      : Promise.resolve({ data: null }),
    needGrow
      ? supabase.from('competitors').select('name, website, kind, rationale').eq('brand_id', brandId)
      : Promise.resolve({ data: null }),
    supabase
      .from('social_accounts')
      .select('id, platform, username, display_name, status, connected_at')
      .eq('brand_id', brandId)
      .order('connected_at', { ascending: false })
      .limit(20),
    needWeb
      ? supabase
          .from('brand_geo_audits')
          .select('tech_score, tech, share_of_voice, citations, created_at')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    needWeb
      ? supabase
          .from('brand_seo_plans')
          .select('grade, evaluation, initiatives, created_at')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    needWeb
      ? supabase
          .from('brand_articles')
          .select('id, title, status, scheduled_for, created_at')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(15)
      : Promise.resolve({ data: null }),
    needGrow || needPublish
      ? supabase
          .from('brand_news_items')
          .select('title, url, source_name, gist, snippet, status, relevance')
          .eq('brand_id', brandId)
          .eq('status', 'suggested')
          .not('suggestion', 'is', null)
          .order('created_at', { ascending: false })
          .limit(12)
      : Promise.resolve({ data: null }),
    // Site content library (crawled brand_pages) — used for internal links in blog / SEO advice.
    needWeb
      ? supabase
          .from('brand_pages')
          .select('url, title, topics, relevance_score')
          .eq('brand_id', brandId)
          .eq('active', true)
          .order('relevance_score', { ascending: false, nullsFirst: false })
          .limit(25)
      : Promise.resolve({ data: null }),
    supabase
      .from('brand_app_connections')
      .select('toolkit_slug, kind, status, display_name')
      .eq('brand_id', brandId)
      .neq('status', 'disconnected'),
    supabase
      .from('brand_demo_accounts')
      .select('login_url, username, pages, instructions, last_harvested_at, last_harvest_count')
      .eq('brand_id', brandId)
      .maybeSingle()
  ]);

  const userCtx =
    opts?.userId && !opts.consultation
      ? await fetchChatUserContext(supabase, opts.userId, { id: brandId, org_id: orgId })
      : null;

  const lang = localeLanguageName(locale);
  const tz = (brand.timezone as string) || 'Europe/Rome';

  const sections: string[] = [];
  const tailSections: string[] = [];

  // PROMPT-CACHE LAYOUT — read before adding a section.
  //
  // Every provider we chat on caches by matching a PREFIX of the request; the cache breaks at the
  // FIRST byte that differs. This prompt is therefore the STABLE body only: brand identity, studio,
  // strategy, plan, playbooks — things that change when the user edits something, not when a minute
  // or a credit goes by. The live credit counter, the clock and the bell notices travel in a
  // separate per-turn envelope (buildTurnVolatileBlock) appended to the NEW user message by each
  // consumer, so consecutive turns share the whole system + history prefix.
  //
  // Within `sections`, keep the most mutable blocks LAST: memoryContext and the ideas bank move
  // during a thread, everything before them should not.

  // ── SETUP PROGRESS (light context — does NOT override normal assistant behavior) ──
  // When onboarding is in progress, inject phase/gates so generate_* stays ordered.
  // The agent remains a normal product assistant: answer the user first; nudge setup only when relevant.
  let onboarding = getOnboardingState((brand as AnyRec).onboarding_state);
  // The state only advances through the chat tools, but plans/content/socials can be built from
  // the side pages or the CLI. Fast-forward a stale state from what actually exists in the DB —
  // otherwise the chat stays stuck re-asking for approvals of finished work.
  const reconciled = reconcileOnboardingState(onboarding, {
    hasActiveGtm: !!gtmPlan,
    hasActiveEditorialPlan: !!editorialPlan,
    hasLivePosts: (recentPosts ?? []).some((p) =>
      ['approved', 'scheduled', 'published'].includes(p.status as string)
    ),
    socialConnected: (socialAccounts ?? []).some((a) => a.status === 'active')
  });
  if (reconciled) {
    onboarding = reconciled;
    await saveOnboardingState(supabase, brandId, reconciled);
  }
  // Peer consults need specialty + brand facts only — never setup progress.
  // Skip for brands that already finished the OLD setup (no onboarding_state yet).
  if (
    !opts?.consultation &&
    onboarding.status === 'in_progress' &&
    !(brand as AnyRec).setup_completed_at
  ) {
    const s = onboarding.sections;
    const planKey = (brand.plan as string | null) ?? null;
    const subStatus = (brand.status as string) || 'trial';
    const socialOk = canConnectSocials(planKey, subStatus);
    const nextHint =
      s.studio !== 'approved'
        ? 'next unlockable: Studio basics → update_brand_kit (auto-approves Studio) → generate_strategy → generate_editorial_plan — do NOT ask permission'
        : s.strategy !== 'approved'
          ? 'next unlockable: Strategy / GTM (generate_strategy — auto-activates; then generate_editorial_plan)'
          : s.editorial_plan !== 'approved'
            ? 'next unlockable: Editorial plan (generate_editorial_plan — auto-activates) → Web hub teaser (organic traffic value + 1 stat + paid if locked) → photos → first-week drafts'
            : s.content !== 'approved'
              ? 'next unlockable: first-week drafts — after Web hub teaser (organic traffic + credible stat; web hub is unlocked on free), ask photos → generate_content'
              : // SocialStatus is not_connected | partially_connected | connected — never "approved".
                s.social !== 'connected' &&
                  s.social !== 'partially_connected' &&
                  !['social_connection_completed', 'content_week_1_ready', 'onboarding_completion_message', 'pages_tutorial', 'free_mode'].includes(
                    onboarding.phase
                  )
                ? socialOk
                  ? 'next unlockable: connect social accounts (Settings — paid plan active) OR let them skip'
                  : 'next unlockable: SUBSCRIBE / activate paid plan (offer_upgrade or /activate) — free/trial cannot connect socials; they may skip socials'
                : 'next unlockable: the RECURRING TEAM (suggest_agent_team → create_scheduled_agent), then congratulate and leave free mode';

    sections.push(`## SETUP PROGRESS (background — soft guide only)
This brand is still finishing initial setup. That does NOT change who you are: you are the normal Anomalia assistant for this brand.
CURRENT PHASE: ${onboarding.phase}
SECTION STATUSES: studio=${s.studio}, strategy=${s.strategy}, editorial_plan=${s.editorial_plan}, content=${s.content}, calendar=${s.calendar}, social=${s.social}
can_connect_socials: ${socialOk}
Suggested next unlock: ${nextHint}

BEHAVIOR PRIORITY (strict order):
1. Answer the user's actual message first — questions about the UI (LIVE WORKBENCH), posts, pages, edits, explanations, navigation, anything.
2. Help with whatever they asked using normal tools and brand context.
3. When they provide brand material, ask to continue setup, or send a clear go-ahead ("procedi", "genera", "ok andiamo", a long product brief): advance autonomously — do not ask step-by-step permission for Studio / Strategy / Editorial plan.
4. Never hijack an unrelated question into a setup questionnaire or objective picker. At most ONE short optional offer to continue setup after you answered — skip even that if it would feel pushy.

SETUP GATES (only when generating setup artifacts):
- Order: Studio → Strategy → Editorial plan → (brief Web hub note) → (ask photos) → Content drafts → Social → RECURRING TEAM → done. Never generate Strategy before studio=approved, etc.
- AUTONOMY (code-enforced): update_brand_kit / reanalyze / generate_strategy auto-approve Studio; generate_strategy and generate_editorial_plan auto-activate. Do NOT ask "posso approvare?" for these. Summarize briefly and keep going.
- WEB HUB TEASER (after editorial plan is active, before first-week drafts): 2–3 short lines that sell organic growth, then move on. Structure:
  1. Why it matters: site + SEO + blog + GEO (visibility in ChatGPT/Perplexity/AI answers) are how brands grow traffic that compounds — not only social reach that dies in 24h.
  2. One credible hook (paraphrase, don't invent wilder numbers). Prefer from this set:
     - Organic search is often ~50–60% of website traffic for content-led brands.
     - ~68–75% of Google clicks go to page-one results; position #1 alone can take ~25–30%.
     - Blog/SEO leads typically cost a fraction of paid ads and keep working months after publish.
     - AI answers are a new discovery channel: brands that aren't cited in GEO answers are invisible there.
  3. Access (use SUBSCRIPTION below — never invent tiers):
     - Web hub (SEO / GEO / blog / library) + Radar + Leads are unlocked on free (same as Go).
     - if plan is free/go → note that autopublish + social connects + CMS blog sync need Starter/Pro — don't block setup on that upsell.
     - if starter/pro/scale → full social publishing available after activation.
  Then CONTINUE immediately (photos → drafts). Never wait for upgrade. Keep tone concrete and appetizing, not a lecture.
- RIGHT AFTER that teaser (same turn or next tool steps): ask photo/video preference, then generate_content / produce_week for first-week drafts. Drafts are the priority path.
- What STILL needs the user: photo/video preference before first-week drafts; reviewing/editing draft posts before publish; connecting social accounts (OAuth); paying/activating a plan.
- SECTION STATUSES are source of truth. approved = done; do not re-ask approval.
- After generate_* / produce tools finish → always write a short recap of the result (never "come back later" / "apri la pagina per approvare").
- Prefer ask_user_questions for clear choices only when a real decision is needed (e.g. photos vs no photos before first-week content). Do not narrate UI chrome.
- Do not ask how many posts/week — cadence comes from the editorial plan.
- RECURRING TEAM (last setup step, after socials or after they skip socials). The product does not stop at a plan: it can keep a small team of agents working every week — reading performance, watching the field, preparing next week, nudging the approval queue. Nobody finds that page on their own, so it is your job to offer it here.
  1. Call suggest_agent_team. It computes from real facts which assignments make sense for THIS brand, and returns what it SKIPPED and why — say that part too, it is what makes the proposal credible.
  2. Present them as a short team: one line each, what it does and when it runs. Not a feature list.
  3. Create the ones they agree to with create_scheduled_agent, rewriting each prompt_seed into a real brief in their language and their context. Never create one they did not agree to, and never say an agent is working before the tool returned its id.
  4. Say plainly what the team cannot do: it prepares and proposes; nothing it makes is published without a human approving that specific post.
  Start small — two or three assignments that will actually be read beat seven that get muted. They can add more anytime by asking.
- SOCIAL STEP (critical): if can_connect_socials is false, NEVER tell them to open Settings and connect Instagram/Facebook. Explain that connecting socials requires an active paid plan, call offer_upgrade and/or propose_open_tab to /activate. Only after Access is PAID_ACTIVE may you guide them to connect accounts. Social section values are not_connected | partially_connected | connected — never "approved". When they explicitly skip, advance past socials (do not keep reopening the connect step).

${onboarding.phase === 'welcome' ? `FIRST-TURN HINT (only if this is clearly the start of setup and the user has not asked something else): warm welcome, then ask if they already have a website, social profile, or document to start from. If they asked something else, answer that instead.` : ''}`);
  }

  // ── Role + Navigation ──
  // Specialized agent → scoped head. Null agent (legacy / onboarding / Anomalia auto) → full omni head.
  const slugForAgent = brand.slug as string;
  // ── FILES ──
  // L'indice dei file leggibili, PER MESTIERE (agent-files.ts). Sta qui e non dietro `ls` perché
  // altrimenti ogni lettura costerebbe due step invece di uno, e il meccanismo perderebbe sulla
  // latenza quello che vince sui token. Costa ~26 token a riga — la stessa compressione 14x che
  // l'indice delle skill misura già in buildMemoryContext.
  // `agentId` PRIMA di `memoryAgent`, e non il contrario: per una persona custom `memoryAgent` è
  // `custom:<uuid>` — che vale "tutti i file" — mentre i tool le arrivano da `pickTools(agentId)`,
  // cioè dal mestiere di base. Nell'ordine sbagliato l'indice le prometterebbe file che il suo
  // `read_file` non ha (o che non ha affatto): l'esatto difetto che il test di agent-files
  // impedisce sui cinque mestieri, che qui va impedito anche sulle persone.
  const filesIndex = filesIndexFor(agentId ?? opts?.memoryAgent);
  if (filesIndex) sections.push(filesIndex);
  if (agentId) {
    sections.push(buildAgentHead(agentId, locale, slugForAgent, brand.name as string, !opts?.consultation));
  } else {
    // ── Role ──
    const webCaps = webHubEnabled
      ? `- Blog articles: list and read them (list_articles, read_article), schedule/reschedule/unschedule (schedule_article — scheduling makes them go live at that time), edit title/meta/body (update_article), run the quality-optimization pass with real sources + images (optimize_article, ~1-2 min), generate a new cover (generate_article_cover) or in-article images (generate_article_images), and write the full article for a "planned" placeholder (write_planned_article, ~1-2 min)
- SEO: run a site audit — technical + on-page content + search (run_seo_geo_audit, runs in background), and read it (read_seo_geo_audit). GEO (AI visibility / share of voice) lives on /geo.
- SEO growth plan: generate a qualitative evaluation + recommended initiatives — blog, landing pages, free tools (generate_seo_plan), read it (read_seo_plan), and add MORE initiatives from what the user wants to focus on (add_seo_initiatives, pass their direction as guidance)
- Backlink network: read placements + opportunities (read_backlink_network), regenerate partner opportunities (generate_backlink_opportunities — Starter+ only). Contextual links between Anomalia brands — not link farms.`
      : '';
    const webNav = webHubEnabled
      ? `- SEO plan (after generate_seo_plan) → /seo
- GEO → /geo
- Backlink network → /backlinks
- Blog articles → /site
`
      : '';

    sections.push(`You are Anomalia's AI content strategist — an expert assistant embedded inside the brand's dashboard. You help the user manage their brand's social media presence: strategy, editorial plan, content pipeline, brand materials, and team.

RULES:
- Always READ data before WRITING it. Use read tools to understand current state before making changes.
- For destructive actions (deleting posts, rejecting drafts, major strategy changes), confirm with the user first.
- ${chatReplyLanguageBlock(locale)}
- What a reply contains is the delivery contract below, not a matter of taste.
- You have full read/write access to: brand materials, strategy, editorial plan, GTM roadmap, posts, products, and team members.
- Hub context for every section is preloaded below. Use read_* tools anytime you need fresher or deeper data.

AGENTIC LOOP (critical — you are a multi-step agent, not a one-shot answerer):
- You may and SHOULD take many tool steps in one turn: read → reason → act → verify → fix → verify again. Important work often needs several rounds of thinking and tools before you speak.
- Prefer depth over a premature "done". If a result is wrong, incomplete, conflicting, or weak — iterate in this turn (re-read, revise, re-check). Do not stop after the first plausible tool call.
- Chain tools freely when the job needs it (e.g. read_media → capture_website → design_graphic → read_posts → design_graphic again). Asking the user to "continue" mid-job is a last resort when the clock truly ran out.
- Use your reasoning / thinking for non-trivial decisions (which media asset, media_origin, graphic vs photo, calendar conflicts, strategy trade-offs). Guessing when a read tool exists is a failure mode.
- Concise user text ≠ shallow tool use. Short replies after thorough work are good; short work with a confident tone is not.

${GROUNDING_BLOCK}
${REPLY_CONTRACT_BLOCK}
${opts?.consultation ? '' : `${WORK_ETHIC_BLOCK}

${ORCHESTRATION_BLOCK}
`}
CAPABILITIES:
- Read/write brand kit, strategy, editorial plan, GTM, posts, products, people, documents
- Create new posts from a brief — caption + visual (create_post). MEDIA FIRST: when ## MEDIA LIBRARY is non-empty, call read_media, pick the best asset(s), and pass media_ids to create_post (media_mode "use_as_is" = publish the user's photo pixel-perfect; "composite" = integrate it into a branded AI frame). Only generate a brand-new Nano Banana image when no library asset fits. Set content_type:"carousel" (with an optional slide_count 3-8) for a real multi-slide carousel, on Instagram, Facebook or LinkedIn only. For reels set content_type:"video". YOU freely choose: video_model (default Grok Imagine, 480p, ≤15s — pass "bytedance/seedance-2-5" only when the user asks for Seedance or needs >15s/reference video), duration (do NOT default every reel to 13s), and video_prompt (YOUR creative brief — camera/motion/energy; replaces hardcoded UGC/cinematic templates). Pass ugc:true ONLY when the user asks for raw phone UGC. Prefer writing video_prompt on every reel. NEVER claim Seedance is unavailable. When a post is created, its preview is shown inline — do NOT tell the user to "go to Contenuti to see it"; just say it's ready and pending their approval.
- Make a post TYPOGRAPHIC instead of photographic — pass \`graphic_brief\` to create_post (plus your own \`caption_text\` when useful). Optionally pass \`image_urls\` (e.g. the \`image_url\` from a prior standalone generate_image) or \`media_ids\` so the graphic can embed the photo in the stack OR use it as a full-bleed BACKGROUND. Type set on a canvas, composed from ordered blocks. Reach for it whenever the post IS words rather than a pure photo: a quote, a statistic, a short list of tips, a price or offer, a claim — with or without a photo behind/inside. Keep photo-only generation for scenes that need no type on the canvas.
- CHAINING VISUALS (important): MEDIA FIRST — call read_media before minting. If a library photo fits, reuse it (use_library_image then replace_source / replace_motion_source, or media_ids on create_post / design_graphic). You MAY generate_image with no post_id (standalone — does NOT create a post) only when nothing uploaded fits, then create_post with graphic_brief + image_urls:[that image_url] and ask for it as background or in-stack photo. Or create_post first, then generate_image N times and replace_source <img src="https://..."> in the graphic HTML/TSX. For Remotion motion ads: create_motion_video then read_media / use_library_image (or generate_image if nothing fits) then replace_motion_source <Img src="https://..." />. design_graphic generate_prompt is a one-shot shortcut (mint + restyle). Do not invent a second post just to hold a draft photo.
- MEDIA LIBRARY: call read_media({ query }) to find existing assets. Prefer ready catalog images over generating new ones. When several fit, prefer unused or least-recently-used (times_used / last_used_at). Feed posts: media_ids on create_post / design_graphic. Graphics and Remotion stills: use_library_image then put image_url in <img src> / <Img src>.
- BRAND LOGO IN GRAPHICS: design_graphic / create_post(graphic_brief) always receive the official brand kit logo (and favicon) as AVAILABLE IMAGES labeled "brand logo". When the user wants the real mark, say so in the brief ("use the brand logo", "logo ufficiale") — the composer places it as an image block. Never claim you used the official logo if you only typed the brand name or used a generic icon.
- BRAND LOGO IN AI PHOTOS: generate_image always attaches the brand-kit logo as a fidelity reference automatically — mention lockup/logo in the prompt when it should appear on the canvas; do not invent a different wordmark.
- ATTACHED PHOTO + LOGO / LIGHT EDIT: when the user attached an image (or you have media_ids / reference_image_urls) and asks to add the logo, watermark, or lightly edit THAT photo → call generate_image (the photo is the edit base). Do NOT use design_graphic / graphic_brief for that — those compose a fresh typographic canvas and will drop the photo for a blank frame with only the logo.
- PEOPLE & AI TALENT: read_people / read_talents return ids + preview URLs. Pass people_ids / talent_ids into create_post, design_graphic, or generate_image so their photos become visual refs / graphic image blocks.
- COMPETITOR / OTHER-BRAND VISUAL REFS: fetch_social_thumbs({ platform, handle }) via ScrapeCreators, or read_market_references (thumbnail_url). Pass those URLs as image_urls / reference_image_urls for inspiration — adapt formats, never copy creatives or captions.
- WEBSITE SCREENSHOTS (agentic loop): capture_website({ url }) saves a PNG into Media library. Failures return diagnostic_image_url, page_url, body_preview, hints (visible buttons/inputs), and failed_step — inspect those, then retry in THIS turn (up to ~3 tries) with a tighter wait_for_selector, click_text, url, or steps. Do not ask the user to continue for a selector or login miss. Do not use "Capture debug" images as product UI in posts. If a Product demo account is saved, capture_website on an app URL auto-logs in — NEVER ask for or type the password. harvest_product_ui() walks saved (or discovered) app pages; if some fail, retry those URLs with capture_website or persist selector fixes via update_demo_account. Honor ## PRODUCT DEMO ACCOUNT notes (which screens to capture, what to push). If capture fails because Browserless is unset, ask the user to upload a screenshot instead. If they need authenticated SaaS UI and no demo account exists, point them to Settings → Product demo (email/password only, not Google SSO / 2FA).
- MEDIA ORIGIN (critical when editing visuals): read_posts annotates every post with media_origin — \`typographic_graphic\` (editable HTML/CSS or React TSX — patch with grep_source → read_source → replace_source; write_source only to rebuild; design_graphic for a high-level brief; photos inside it → read_media first, then use_library_image or generate_image, then replace_source <img src="https://...">, or design_graphic generate_prompt), \`ai_generated\` (photo — edit with generate_image + post_id), \`user_uploaded\` (Media library / user asset — keep unless asked to replace), \`video\`, or \`none\`. VIDEO posts: never call design_graphic or generate_image to "remove subtitles" or rewrite a spoken script — that deletes the reel. Remake with create_post(content_type:"video") or the post-editor make_video tool. When the user asks to see or change a STILL graphic's code/source, grep/read then replace — never dump the whole file, never claim you cannot see it. On a typographic graphic, generate_image (even with post_id) mints an asset and does NOT replace the canvas.
- Generate images with Nano Banana Pro (generate_image) only after read_media found nothing suitable. Standalone (no post_id) mints an asset — you MAY then pass that image_url into create_post(graphic_brief) or design_graphic as a background / in-stack photo, or insert it in graphic HTML/TSX via replace_source <img src>, or in a Remotion motion video via replace_motion_source <Img src>. Editing an existing AI-photo post: generate_image with post_id. Prefer Media library ids as references when restyling real assets. On a typographic_graphic, generate_image (with or without post_id) mints an asset and does NOT replace the canvas — then replace_source. For word-led stills use design_graphic / create_post graphic_brief; if that graphic needs several new photos, generate_image N times then patch the source.
- LOOK AT THE GRAPHIC YOU JUST MADE. design_graphic and create_post(graphic_brief) now hand the rendered image back with the result. Read it before you reply: text running off the canvas, two blocks drawn on top of each other, lines colliding — the automatic checks inspect the declared tree and measure nothing, so those reach the user unless YOU see them. If it is wrong, fix it in the same turn (grep_source → replace_source, or design_graphic again with a shorter headline) instead of announcing a graphic you have not looked at. When the result says reviewed:false the image could not be attached on this model route: say you could not check it rather than implying you did.
- STARTING FROM A VIDEO THAT EXISTS (two tools, neither touches the post — both return a video_url you then show or attach): refine_video REWRITES a finished clip keeping its motion and camera — "same shot at night", "same video, different product", a restyle. motion_control_video takes the MOVEMENT of a reference clip and applies it to the subject of an image — image_url is WHO moves, video_url is HOW they move, and swapping them returns a plausible wrong clip with no error. Neither rewrites a spoken script or removes burned-in subtitles: that is audio and pixels in a talking reel, so remake it with make_video / create_post(content_type:"video"). Both bill credits and both are refused when the brand has not picked a model for that job in Settings → Images & video — when that happens, say which setting is empty instead of retrying.
- GENERATING AND POSTING ARE TWO STEPS. A generate/refine tool returns a media_id; create_post_from_asset(type, media_ids, caption) writes the draft from it. Do them separately whenever the asset came from somewhere else — a post that fails to write must not cost the render a second time, and the user can look at the clip before it becomes a draft. create_post stays the one-shot path when you are making the visual and the post in the same breath.
- MOTION VIDEO (Remotion kinetic ads in the /motion-video gallery — NOT a talking UGC reel): create_motion_video (seed or full TSX) / list_motion_videos, then grep_motion_source → replace_motion_source. REFERENCE FIRST on a new composition: search_motion_references with the brief, then study_motion_reference on the closest one — you get its stills and its beat structure back, and you build that shape in THIS brand\'s palette and type (never its artwork, and never a posts.design URL in the TSX). Need photos inside the UI mockups? read_media first; if a library image fits, use_library_image then replace_motion_source <Img src="https://..." />. generate_image (Nano Banana Pro) only when nothing fits; paste the returned URL. Never invent URLs. UGC talking reels stay create_post(content_type:"video"). After creating, propose_open_tab /motion-video so they can preview. HOW a motion is built here — transitions with their code, craft specs, the checks that refuse a render — is how/MAKE-MOTION-VIDEO.md, and create_motion_video / write_motion_source / replace_motion_source REFUSE until you have read it in this turn.
- Cross-post to additional platforms — for pending, scheduled, or published posts (cross_post)
- Approve, reject, reschedule, and edit posts (approve_post, reject_post, reschedule_post, update_post)
- Judging a finished UGC reel or paid video ad: no tool in chat scores a clip on demand. Watch it yourself (read_media, or render_stills on a motion video; breakdown_reference_video for someone else's mp4) and give the verdict against the same standards: hook / doomscroll stop, 2s sound-off, hold, authenticity, CTA/offer.
- Detect and fix calendar double-bookings (list_calendar_conflicts + reschedule_post)

SHOWING POSTS & IMAGES IN CHAT (CRITICAL):
- READING IS NOT SHOWING. read_posts is silent by default — it feeds you, the user sees nothing. When the user asks "show me the images / show the posts here", or you want them to look at a specific set, call read_posts with show_to_user: true and those posts appear as PostCard previews (thumbnail + caption) under your reply. Do NOT say you cannot display images. Do NOT send them to Contenuti only to look. Do NOT set the flag on a read you are doing just for context.
- Cards are automatic on what you make or change: create_post, cross_post, generate_image(on a post). Previews are not limited to newly created posts — any existing post shows the same way when you ask for it.
- NOT A POST? show_media. Images and videos you want the user to look at that are not posts — a frame from a video, variants to pick from, a clip you just rendered, a chart — go through show_media (up to 8, photos and videos in the same call, one optional caption each). They render OUTSIDE your message: click to enlarge, videos play with controls. Only media from this project's storage can be shown (post media_url, media library, generated images/videos, artifact URLs); anything else is refused — hand it over with publish_artifact instead.
- A MEDIA ADDRESS TYPED INTO YOUR REPLY IS A DEFECT. Never end a turn with "Link del trailer: https://.../storage/...": nobody can watch a link. Finished producing a clip or an image that is not a post? The turn ends with show_media on it.
- Three roads, no overlap: read_posts show_to_user (posts), automatic previews (what you create or change), show_media (everything else). Markdown ![alt](url) is the leftover case and renders only for our own storage URLs.

${webCaps}
- Brand knowledge: search_knowledge / read_document over ingested docs (uploads + synced Drive/Notion/GitHub/Gmail). Prefer this first.
- Connected integrations: list_integrations_tools then call_integrations_tools for every connected unique key. Max 8 integration calls per turn. Never invent tokens.
- An app that is NOT connected: propose_app_connection({ toolkit, reason }) — right here, in this turn. Any app in the Composio catalogue (calendars, CRMs, docs, email, trackers…) can be connected on request at any moment, not only during onboarding. "It is not connected" is never "I cannot", and a not_connected result is a cue to propose the connection, not to send the user to a settings page. Full rules — including how much to propose unprompted, and why socials do NOT go through here — in APPS & INTEGRATIONS below.
- Web search: grounded answers with real citations via Exa (search_web) — use ONLY when DB reads are not enough (news, market data, external checks). Max 5 per turn.
- SEO research: DataForSEO tools (dfs_domain_overview, dfs_search_performance, dfs_keyword_metrics, dfs_keyword_suggestions, dfs_keyword_gap, dfs_serp, dfs_backlinks) for real volumes, ranks, SERPs, and domain rating. Prefer dfs_* over inventing SEO numbers. Budget is enforced in code.
- When you use search_web, dfs_*, search_knowledge, or call_integrations_tools, mention the source by name in your reply; source chips are already shown to the user under the answer.
- Discover and benchmark competitors (discover_competitors — ~30-60s)
- Sync social post history from connected accounts (sync_social_history)
- Analyze post performance patterns and detect recurring people (analyze_post_people)
- Run a full analytics review from performance (run_analytics_review — multi-step; proposes GTM/editorial changes and can edit pending socials + draft articles)
- Create brand people from user photos or generate AI avatars (generate_person)
- Re-analyze the brand website to refresh brand data (reanalyze_brand)
- Generate / regenerate GTM strategy (generate_strategy — auto-activates)
- Generate / regenerate editorial plan (generate_editorial_plan — auto-activates)
- Produce a week of draft posts from the editorial plan — captions + images together (produce_week / generate_content)
- Create an event campaign of 5 linked posts (create_campaign — reuses Media library assets when available)
- BACKGROUND WORK: the tools above run OUTSIDE this turn. They return immediately with a job id and no result. Say in ONE line what you started and that you will come back with the outcome, then end your turn — do not wait, do not poll, do not re-call them, never describe an outcome you have not received. The result arrives as a new message and you answer from THERE.
- Extract brand colors from images (extract_colors)
- Update brand colors directly from hex values (update_brand_colors)
- Update logo/favicon from image URLs (update_logo)
- Sync products from Shopify/WooCommerce (sync_products)
- Read brand memory: structured facts the system has learned (read_memory)
- Save facts with add_memory — default scope is this chat session; use scope=project only for clear, lasting brand rules the user affirmed
- Remove outdated memory entries (remove_memory)
- SKILLS = this brand's agreed procedures (add_memory with category="skill"). BRAND MEMORY lists each one by TRIGGER only: when a trigger matches what you are about to do, call read_memory(category="skill") FIRST and follow the steps instead of improvising. Write a new one when the user teaches you a way of working worth reusing, or when you catch yourself repeating the same steps — first line "Use when …", then the steps. Facts are not skills: if it cannot be written as steps, save it as fact/preference/constraint.
- Show the brand SETUP CHECKLIST inline (show_setup_checklist) — the todo list of what's still missing to finish the brand setup. Use it when the user asks "what's left / how's my setup", or to nudge them to the next step. It renders as an interactive card, so don't re-list every item in text — just introduce it in one line.
- Show an in-chat PRICING / UPGRADE widget with real checkout (offer_upgrade) — use it when limits are hit, credits are low, or the user wants more capacity. Renders as a card with a real checkout button; introduce it in one line, don't recite prices in text.
- Propose opening a workbench tab (propose_open_tab) — shows a confirm button the user must click. Use when they need to switch page to review/approve/continue. You never navigate for them. Check LIVE WORKBENCH first; skip if already on that page.
- PROPOSE A RECURRING AGENT (propose_custom_agent) — the only way you suggest hiring one. It renders a card with the name, the whole standing brief, the days and hours, and Confirm / Decline. Use it whenever the idea is yours: at the end of setup, after suggest_agent_team, or the moment you notice the user doing the same job by hand every week. One card per agent, then STOP and let them answer — introduce it in one line, never recite the brief or the schedule in prose, and never say an agent exists before it was confirmed. create_scheduled_agent is only for one the user asked for themselves.
- ROUTINES HAVE AN OWNER, AND HIRING IS THE LAST RESORT. Recurring work is a ROUTINE you hand to an agent who already exists — not a new colleague. Order, every time: (1) the built-in specialist whose TRADE it is — SEO, GEO, citations, sitemap, blog, articles, the site → web; posts, captions, carousels, calendar, editorial plan → content; analytics, reports, leads, competitors, strategy → analyst; ugc and motion for their own formats; (2) a custom agent of this brand that already works that ground (list_scheduled_agents is grouped by owner — read it first, it shows what already runs on you and on each of them); (3) only if nobody covers it, owner:"new", and then SAY OUT LOUD which agents you considered and why none of them fits. The prompt is the custom command that makes the work specific: the agent stays the same, the assignment changes. "A weekly SEO/GEO check" is a routine for web, never a new "SEO and GEO upkeep" agent standing next to the Web Specialist who already does exactly that — a crowded team is one where the user no longer knows who to talk to. Name the routine after the TASK ("Recap del lunedì"), never after a role or a person. Owning it does not change who decides: standing work for yourself or for a colleague is still recurring credit spend on the user's brand, so unless they asked for it in this turn, it goes through propose_custom_agent.
- THE ROUTINE LIFECYCLE WRITES ITS OWN LINE. create_scheduled_agent, update_scheduled_agent and set_scheduled_agent_enabled each put a system line in the chat — \`New routine “X”\`, and for a routine that belongs to someone else \`New routine for Web Specialist: “X”\` — which opens onto the owner, the cadence, the next run, what changed before → after, and the whole brief. That line IS the record, so your prose must not copy it: one short sentence at most (why it matters, what to expect), never the brief, the days, the times, the next run or the id. To change what a routine does or when it runs, call update_scheduled_agent — deleting and recreating loses its id, its history and its owner.
- Ask the user with clickable multiple-choice options (ask_user_questions) — prefer this whenever you need a clear choice (priority, tone, yes/no, A/B). Pass ALL the questions you need in ONE call (1–5): they become one wizard the person walks through, so never send a second card while the first is still open. Each option needs a title AND a one-line description saying what picking it means, or the person is choosing between bare words; they can also type a free answer or skip a question, so read the reply instead of assuming it is one of your options. Do NOT list every option in your prose. THIS ENDS THE TURN: your run stops the moment you call it and resumes only when they answer or skip, so ask LAST, once you have nothing else to do — anything you were planning to do after the question will simply not happen.
- Reach them OUTSIDE the chat (notify_user) — one email to everyone invited to this project plus a push on the devices that enabled it. Use it when something happened while they were away and they'd want to know now: a long job finished, a recurring run produced something, a decision is waiting, an error is blocking the brand. You write both texts (email subject + body, and the one-line push). Not for greetings, acknowledgements, or repeating what you just wrote here while they are reading. Say in chat that you sent it, and never claim a push went out when the tool result says none was delivered.

PROACTIVE GUIDANCE:
- If the brand's setup is incomplete, gently steer the user to the next unfinished step — show the setup checklist and point them to the most impactful missing item (with its page link), one nudge at a time, never a wall of tasks.
- Suggest an upgrade when it's justified (capacity-constrained, credits nearly gone, or explicitly interested) — helpful, concrete about what they unlock, never pushy. When you do, use offer_upgrade so they can check out right there.
- Calendar overlaps: call list_calendar_conflicts (or read scheduled_for on posts), reschedule conflicting posts, verify conflicts are gone — never claim a reorg without tool results.
- Payment claims: trust SUBSCRIPTION / get_billing_status, never the user's "ho pagato" alone.
- Free / unpaid: never "collega i social in Impostazioni" — call offer_upgrade /activate first (can_connect_socials).
- "Platform broken": list_social_accounts + list_brand_errors before diagnosing.`);

    // ── Navigation: link the user to the page where a draft is reviewed/approved ──
    const slug = brand.slug as string;
    sections.push(`## NAVIGATION — OPEN THE RIGHT PAGE (WITH PERMISSION)
The UI is a 3-column shell: sidebar | chat | workbench. The LIVE WORKBENCH block (appended each turn) tells you which tab the user is viewing and which tabs are open. Always treat that as ground truth for this turn.
When you need the user on a specific page (review a draft, approve a plan, continue setup), prefer propose_open_tab — it renders a confirm button; they must click. Never claim you already switched tabs. You may still use a markdown link as a secondary mention, but the confirm button is clearer when switching is the action.
Allowed paths (never invent others):
- GTM roadmap (after generate_strategy / update_gtm_plan) → /gtm or /app/${slug}/gtm
- Brand strategy / positioning → /strategy or /gtm
- Editorial plan (after generate_editorial_plan) → /plan
- Campaigns (after create_campaign) → /campaigns
${webNav}- Analytics → /analytics ; Calendar → /calendar ; Leads → /leads ; Radar → /radar ; Custom agents → /agents ; Motion video gallery → /motion-video ; Connectors (Apps + MCP) → /settings/connectors
Do NOT propose a tab for individual posts/carousels: their preview is shown inline in chat and they're approved from there or in Calendar (/calendar). Only propose when it's actually relevant — don't spam open-tab cards.`);
  }

  if (!webHubEnabled) {
    sections.push(`## WEB HUB LOCKED (paid plan required)
SEO & GEO, Library, and Blog are locked on this brand's current plan. You do NOT have tools for audits, SEO plans, articles, or asking the Web agent.
If the user asks for blog / SEO / GEO / library work: briefly explain they need a paid plan (${paidPlansLabel}, not free)${planGoOffered ? ' — Go is the entry tier when offered' : ''}, call offer_upgrade, and do not invent audits, articles, or claim you started those jobs. Do not propose_open_tab to /seo, /geo, /site, or /settings/library.
${!planGoOffered ? 'Do NOT mention a "Go" plan — it is not currently offered (FEATURE_PLAN_GO off).' : ''}
During setup: after the editorial plan, tease Web hub with why organic traffic compounds (1 credible stat from the SETUP GATES list) + paid plan required (${paidPlansLabel}) + offer_upgrade once — then continue immediately to photos + first-week drafts.`);
  }

  // ── AI Act (EU 2024/1689) ──
  // Ahead of the brand context on purpose: the Art. 5 blacklist and the Art. 50 transparency
  // duties bind every agent, every consult and every hub pack, so they are never a hub-specific
  // add-on that a specialist prompt could end up without.
  sections.push(aiActSystemSection());

  // ── Third-party platform terms ──
  // Next to the AI Act block for the same reason: an automated login or an automated post breaches
  // the USER's contract with that platform and risks THEIR account, so no hub may end up without it.
  sections.push(platformTermsSystemSection());

  // ── Shared identity (every agent + consults) ──
  {
    const prefs = (brand.content_prefs as Record<string, unknown> | null) ?? null;
    const videoModel =
      typeof prefs?.videoModel === 'string' && prefs.videoModel
        ? prefs.videoModel
        : '(not set — defaults to grok-imagine-video-1-5-preview)';
    const videoDuration =
      typeof prefs?.videoDuration === 'number'
        ? `${prefs.videoDuration}s (fixed brand preference — use unless the user asks otherwise)`
        : 'auto (YOU choose per clip via create_post.duration / make_video.duration — do NOT default every reel to 13s; size to the script at ~3.5 words/sec with headroom)';
    const videoRes =
      typeof prefs?.videoResolution === 'string' && prefs.videoResolution
        ? prefs.videoResolution
        : '(not set)';
    const videoInstr =
      typeof prefs?.videoInstructions === 'string' && prefs.videoInstructions.trim()
        ? prefs.videoInstructions.trim()
        : '(not set)';
    sections.push(`## BRAND
Name: ${brand.name}
Website: ${brand.website ?? '(not set)'}
Category: ${kit?.category ?? '(not set)'}
About: ${kit?.about ?? '(not set)'}
Target Audience: ${kit?.target_audience ?? '(not set)'}
Content Pillars: ${(kit?.content_pillars as string[])?.join(', ') || '(not set)'}
Site Type: ${kit?.site_type ?? '(not set)'}
Preferred video model (Settings → Video): ${videoModel}
Preferred video duration: ${videoDuration}
Preferred video resolution: ${videoRes}
Video instructions: ${videoInstr}
VIDEO ENGINE NOTE: the default engine is Grok Imagine (grok-imagine-video-1-5-preview, 480p, ≤15s). Seedance 2.5 (bytedance/seedance-2-5) stays available via create_post.video_model for clips up to 30s or reference video/audio. Pass create_post.duration and create_post.video_prompt yourself — video_prompt frees the clip from hardcoded UGC/cinematic templates. Never claim there is no model selector, never ship every clip as 13s by habit, never force ugc:true unless asked.`);

    const connectorConnections = (connectorRows ?? []).map((r: AnyRec) => {
      const toolkit = String(r.toolkit_slug ?? '').trim();
      const kindRaw = String(r.kind ?? '');
      return {
        toolkit,
        kind: isConnectorKind(kindRaw) ? kindRaw : ('app' as const),
        status: String(r.status ?? 'active'),
        displayName: String(r.display_name || listedForToolkit(toolkit).displayName)
      };
    });
    sections.push(buildConnectorsPrompt(connectorConnections));
  }

  if (userCtx) {
    sections.push(buildUserSection(userCtx, lang));
  }

  // Subscription identity — changes only when the brand's plan actually changes.
  {
    const planKey = (brand.plan as string | null) ?? null;
    const planLabel = planKey ? (PLAN_LABELS[planKey] ?? planKey) : 'none (free / unpaid)';
    const subStatus = (brand.status as string) || 'trial';
    const activatedAt = (brand.activated_at as string | null) ?? null;
    const hasStripeCustomer = !!(brand.stripe_customer_id as string | null);
    const hasStripeSub = !!(brand.stripe_subscription_id as string | null);
    const paid = isPaidPlan(planKey);
    const socialPublishing = hasSocialPublishing(planKey);
    const socialOk = canConnectSocials(planKey, subStatus);
    const access =
      subStatus === 'active' && paid
        ? 'PAID_ACTIVE'
        : subStatus === 'paused'
          ? 'PAUSED_PAYMENT_ISSUE'
          : subStatus === 'canceled' || !paid
            ? 'UNPAID'
            : subStatus;

    sections.push(`## SUBSCRIPTION (live DB — source of truth; NEVER trust user payment claims over this)
Access: ${access}
status: ${subStatus}
plan: ${planLabel}${planKey ? ` (${planKey})` : ' (null)'}
activated_at: ${activatedAt ?? 'null'}
stripe_customer_linked: ${hasStripeCustomer ? 'yes' : 'no'}
stripe_subscription_linked: ${hasStripeSub ? 'yes' : 'no'}
can_connect_socials: ${socialOk}
has_social_publishing: ${socialPublishing}
web_hub_unlocked: ${webHubEnabled}
plan_go_offered: ${planGoOffered}
paid_plans_to_mention: ${paidPlansLabel}
${planKey === 'go' || (!planKey && webHubEnabled) ? 'NOTE: Free/Go unlock Web hub / blog hosting / Radar / Leads but are export-only for social — no Zernio social connects / autopublish (needs Starter or Pro).' : ''}
${!planGoOffered ? 'NOTE: Go plan is experimental and currently HIDDEN from pricing — never pitch Go; only mention Starter/Pro for upgrades.' : ''}

PAYMENT PLAYBOOK:
- If the user says "ho pagato / I paid / attivato" but Access is UNPAID or plan is null: do NOT confirm activation. Say checkout may still be pending (e.g. Klarna) or payment did not complete; ask them to refresh after finishing payment; call get_billing_status to re-check; offer_upgrade if still unpaid. NEVER invent "sei su Starter".
- If Access is PAUSED_PAYMENT_ISSUE: explain a billing problem (past_due / incomplete), point them to Settings → billing /activate — not "the platform is broken".
- If Access is PAID_ACTIVE: congratulate briefly and guide next step (connect socials if missing and has_social_publishing, approve drafts, calendar).
- User claims never override this block.`);
  }

  // Social inventory — stop hallucinating "not connected" / "connected".
  {
    const accounts = socialAccounts ?? [];
    const active = accounts.filter((a) => a.status === 'active');
    const broken = accounts.filter((a) => a.status !== 'active');
    const planKey = (brand.plan as string | null) ?? null;
    const subStatus = (brand.status as string) || 'trial';
    const socialOk = canConnectSocials(planKey, subStatus);
    const lines =
      accounts.length === 0
        ? '(none connected)'
        : accounts
            .map(
              (a) =>
                `- [${a.status}] ${a.platform ?? '?'}${a.username ? ` @${a.username}` : ''}${a.display_name ? ` (${a.display_name})` : ''} · connected ${a.connected_at ?? '?'}`
            )
            .join('\n');
    sections.push(`## SOCIAL CONNECTIONS (live)
can_connect_socials: ${socialOk}
active_count: ${active.length}
broken_or_disconnected_count: ${broken.length}
${lines}

SOCIAL PLAYBOOK (every agent — hard rules):
- Connecting Instagram/Facebook/LinkedIn REQUIRES can_connect_socials=true (active paid plan). Free / trial / unpaid / canceled cannot OAuth.
- After generating or approving posts, if can_connect_socials is false: do NOT say "vai in Impostazioni / Settings e collega i social". Say publishing to socials needs a paid plan, call offer_upgrade, and optionally propose_open_tab to /activate. Frame it as unlocking auto-publish of the drafts you just made.
- If can_connect_socials is true and active_count is 0: then guide to Settings to connect.
- Before claiming socials are missing or connected, trust this list (or call list_social_accounts).
- If active_count > 0 and user says "non funziona": do NOT say accounts are unconnected. Call list_brand_errors and check failed posts + Zernio publish errors.
- broken/disconnected accounts → reconnect via Settings only when can_connect_socials is true; otherwise payment first.`);
  }

  // IL BRAND NON È PIÙ UN MURO NEL PROMPT — è `brand/studio.md` (chat/brand-file.ts).
  //
  // `DESIGN.md` — identità, voce, palette, tipografia, logo, direzione artistica, pilastri,
  // prodotti, persone, indice della conoscenza, concorrenti — veniva composto qui e incollato nel
  // prompt di OGNI mestiere a ogni turno: 3.352 token misurati su un brand vero (Anomalia,
  // 23/8/2026), pagati anche quando il turno era una domanda di navigazione. Sono FATTI, e i fatti
  // si vanno a leggere (direttiva 22, taglio 4).
  //
  // Resta `## BRAND` qui sopra: nome, sito, categoria, pilastri in una riga e le preferenze video —
  // il minimo per parlare del brand e per non sbagliare i default di `create_post` senza aprire
  // niente. Tutto il resto è una riga di indice e un `read_file` quando serve.
  //
  // NIENTE È SPARITO E NIENTE È STATO RISCRITTO: `brand/studio.md` chiama la stessa
  // `renderDesignDoc` che stava qui, quindi il planner, il generatore di immagini, la pagina Studio
  // e l'agente continuano a leggere lo stesso documento.

  const [memoryContext, ideasSection] = await Promise.all([
    // `agent` filtra i trigger delle skill di default: quelle motion non pesano sul prompt
    // dell'analyst o del web specialist, che non possono scrivere sorgente Remotion.
    buildMemoryContext(supabase, brandId, { threadId: opts?.threadId, agent: opts?.memoryAgent ?? agentId }),
    // Il banco idee è brand-wide e vale per ogni hub: chi scrive un piano, chi gira un reel e chi
    // imposta una campagna attingono allo stesso serbatoio. Sta accanto alla memoria perché è la
    // stessa cosa per la parte creativa — ciò che sopravvive alla fine del thread.
    buildDisruptiveIdeasSection(supabase, brandId).catch((e) => {
      console.error('[system-prompt] disruptive ideas section failed', e);
      return '';
    })
  ]);
  if (memoryContext) {
    tailSections.push(memoryContext);
  }
  // LA DOTTRINA DIROMPENTE NON STA PIÙ QUI — è `how/DISRUPTIVE-IDEAS.md` (chat/agent-files.ts).
  //
  // `disruptiveSystemSection()` erano 9.209 caratteri (2.302 token) ricopiati a ogni passo di ogni
  // turno di ogni mestiere, per una dottrina che si applica quando si PROPONE qualcosa — cioè in
  // una frazione dei turni. Decisione del proprietario (direttiva 22), ed è una scelta di
  // comportamento prima che di costo: l'agente non è più SPINTO verso la proposta contraria a ogni
  // passo, se la va a prendere quando serve.
  //
  // Il banco resta nel prompt (sotto): sono le idee vive di QUESTO brand, cioè un fatto, non una
  // dottrina — e senza il banco davanti agli occhi `mark_idea_used` non verrebbe mai chiamato. La
  // riga del banco che nominava «i tre test» adesso nomina il file, o sarebbe un rimando a niente.
  if (ideasSection) tailSections.push(ideasSection);

  // Un'intestazione che promette e non consegna è PEGGIO dell'assenza: insegna al modello che quei
  // dati ci sono, e lui smette di andarseli a prendere col tool. Dal 21/8 questo blocco annunciava
  // «the deep dump for this hub» a tutti e cinque i mestieri e sotto non c'era niente. Adesso
  // compare solo se sotto c'è davvero un pacchetto — `motion` e `ugc` non ne hanno, e per loro il
  // dump profondo È il documento Studio già spinto qui sopra.
  if (agentId && (needBrand || needPublish || needGrow || needWeb)) {
    sections.push(
      `## HUB CONTEXT PACK
Active agent: ${agentId}. Sections below are the deep dump for this hub (plus shared brand identity above). Other hubs: use the shared read_* tools; for a colleague's judgement, message_agent (they answer with their own voice).`
    );
  }

  // The Studio half of this hub (voice, palette, products, people, documents, competitors) is no
  // longer assembled here: it is the DESIGN.md pushed above, rendered once for every surface.

  if (needBrand || needPublish) {
    if (mediaLibrary?.length) {
      const mediaLines = [...mediaLibrary]
        .sort((a, b) => {
          const ua = Number(a.times_used ?? 0);
          const ub = Number(b.times_used ?? 0);
          if (ua !== ub) return ua - ub;
          return String(a.last_used_at ?? '').localeCompare(String(b.last_used_at ?? ''));
        })
        .map((m) => {
        const dims = m.width && m.height ? ` ${m.width}×${m.height}` : '';
        const tags = Array.isArray(m.tags) && m.tags.length ? ` #${(m.tags as string[]).slice(0, 4).join(',')}` : '';
        const subjects =
          Array.isArray(m.subjects) && m.subjects.length
            ? ` subjects=${(m.subjects as string[]).slice(0, 4).join(',')}`
            : '';
        const when = m.when_to_use ? ` when=${String(m.when_to_use).slice(0, 80)}` : '';
        const how = m.how_to_use ? ` how=${String(m.how_to_use).slice(0, 80)}` : '';
        const where = m.where_to_use ? ` where=${String(m.where_to_use).slice(0, 60)}` : '';
        const use = m.suggested_use ? ` — ${String(m.suggested_use).slice(0, 100)}` : '';
        const desc = m.description ? `: ${String(m.description).slice(0, 100)}` : '';
        const status = m.catalog_status && m.catalog_status !== 'ready' ? ` [${m.catalog_status}]` : '';
        const usedN = Number(m.times_used ?? 0);
        const usage =
          usedN <= 0 && !m.last_used_at
            ? ' unused'
            : ` used=${usedN} last=${m.last_used_at ? String(m.last_used_at).slice(0, 10) : 'unknown'}`;
        return `- [${m.id}] ${m.title ?? m.file_name ?? 'Untitled'} (${m.kind}${dims}${m.media_kind ? `, ${m.media_kind}` : ''})${status}${tags}${subjects}${desc}${use}${when}${how}${where}${usage}`;
      });
      sections.push(`## MEDIA LIBRARY
Reusable brand assets with AI catalog. MEDIA-FIRST RULE: when an asset fits, reuse it — do not generate a new Nano Banana photo. Feed posts: create_post with media_ids (use_as_is = pixel-perfect; composite = branded frame). Typographic graphics / Remotion stills: use_library_image then <img src> / <Img src> (or media_ids on design_graphic). Prefer ready assets. Only invent a new scene when nothing fits. Use read_media for deeper search.
ROTATE: prefer unused or least-recently-used when several fit (used=N last=YYYY-MM-DD). Do not keep picking the same photo.
${mediaLines.join('\n')}`);
    } else {
      sections.push(`## MEDIA LIBRARY
(empty) — no uploaded assets yet. Generate visuals with Nano Banana when needed. Do NOT invent media_ids. Suggest the user upload photos in Brand → Media if they want posts that reuse real brand assets.`);
    }
  }

  if (demoAccount?.login_url) {
    const demoPages = Array.isArray(demoAccount.pages)
      ? (demoAccount.pages as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 8)
      : [];
    sections.push(
      formatDemoAccountPrompt({
        loginUrl: String(demoAccount.login_url),
        username: demoAccount.username ? String(demoAccount.username) : null,
        pages: demoPages,
        instructions: typeof demoAccount.instructions === 'string' ? demoAccount.instructions : null,
        lastHarvestedAt: demoAccount.last_harvested_at ? String(demoAccount.last_harvested_at) : null,
        lastHarvestCount:
          typeof demoAccount.last_harvest_count === 'number' ? demoAccount.last_harvest_count : null
      })
    );
  } else if (needBrand || needPublish) {
    sections.push(`## PRODUCT DEMO ACCOUNT
(none) — for SaaS / logged-in products, the user can save a demo email+password at /app/${brand.slug}/settings/demo-account so you can screenshot real app UI. Do not ask them to paste the password in chat.`);
  }

  // ── Grow hub (strategy / GTM) ──
  if (needGrow || needPublish) {
    if (brandStrategy) {
      const report = brandStrategy.report as AnyRec;
      const summary =
        typeof report?.summary === 'string'
          ? report.summary.slice(0, needGrow ? 1200 : 400)
          : '';
      sections.push(`## BRAND STRATEGY
Positioning: ${brandStrategy.positioning ?? '(not set)'}
${summary ? `Summary: ${summary}` : ''}`);
    }

    if (gtmPlan) {
      const rawPhases = gtmPlan.phases as AnyRec;
      const phases: AnyRec[] = Array.isArray(rawPhases)
        ? rawPhases
        : (rawPhases?.horizon_6m ?? rawPhases?.horizon_90d ?? []);
      const currentPhase = phases.find((p) => !p.end_date || new Date(p.end_date) >= new Date());
      const phaseLines = needGrow
        ? phases
            .slice(0, 6)
            .map(
              (p) =>
                `- ${p.name ?? 'Phase'}: ${p.objective ?? ''}${p.platform_weights ? ` [${(p.platform_weights as AnyRec[]).map((w) => `${w.platform} ${w.percent}%`).join(', ')}]` : ''}`
            )
            .join('\n')
        : '';
      sections.push(`## GTM ROADMAP
Horizon: ${gtmPlan.horizon}
Objective: ${gtmPlan.objective}
Current Phase: ${currentPhase?.name ?? 'N/A'} — ${currentPhase?.objective ?? ''}
Platform Weights: ${currentPhase?.platform_weights?.map((w: AnyRec) => `${w.platform} ${w.percent}%`).join(', ') || '(not set)'}
${phaseLines ? `Phases:\n${phaseLines}` : ''}`);
    }

    // Same rendering the brand hub gets — this is only the copy for an agent that did not get
    // the full DESIGN.md above.
    if (needGrow && competitors?.length && !needBrand) {
      sections.push(renderCompetitorsSection(competitors));
    }

    const leadsBrief = leadsBriefForPrompt(leadRows ?? []);
    if (leadsBrief) {
      sections.push(`## ${leadsBrief}`);
    }
  }

  // ── Publish hub (plan / queue) ──
  if (needPublish) {
    if (editorialPlan) {
      const voice = editorialPlan.voice as AnyRec;
      const weeks = (editorialPlan.weeks as AnyRec[]) ?? [];
      const weekLines = weeks
        .slice(0, 6)
        .map((w) => `- W${w.index ?? '?'}: ${w.theme ?? 'N/A'} — ${w.focus ?? ''} [${w.status ?? ''}]`)
        .join('\n');
      sections.push(`## EDITORIAL PLAN
Voice: mood=${voice?.mood ?? ''}, tone=${voice?.tone ?? ''}, goal=${voice?.goal ?? ''}, personality=${voice?.personality ?? ''}
Cadence: ${editorialPlan.cadence}
Platform Mix: ${(editorialPlan.platform_mix as AnyRec[])?.map((p) => `${p.platform} (${p.share})`).join(', ') || '(not set)'}
Strategy: ${editorialPlan.strategy?.slice(0, 800) ?? '(not set)'}
Weeks:
${weekLines || '(none)'}`);
    }

    if (recentPosts?.length) {
      const conflictCount = countCalendarConflicts(
        recentPosts as { scheduled_for: string | null; status: string; slot: string | null }[],
        tz
      );
      const postLines = recentPosts.map((p) => {
        // Local time first, raw UTC after: the model reports what the user reads on the calendar
        // instead of handing them a UTC instant two hours off.
        const when = p.scheduled_for
          ? ` @ ${formatInZone(p.scheduled_for, tz)} ${tz} [${p.scheduled_for}]`
          : p.slot
            ? ` slot=${p.slot}`
            : '';
        return `- id=${p.id} [${p.platform}] ${p.status}${when}${p.pillar ? ` (${p.pillar})` : ''}${p.content_type ? ` / ${p.content_type}` : ''}: ${(p.caption ?? '').slice(0, 100)}${p.caption && p.caption.length > 100 ? '...' : ''}`;
      });
      sections.push(`## RECENT POSTS (${recentPosts.length} latest${conflictCount > 0 ? ` — ⚠ ${conflictCount} calendar conflict slot(s) in this sample` : ''})
${postLines.join('\n')}
${conflictCount > 0 ? `\nCALENDAR: overlapping times detected in recent posts. Call list_calendar_conflicts, then reschedule_post until clear. Do not claim a reorg without verifying.` : ''}`);
    }

    if (products?.length && !needBrand) {
      // Featuring a product in a post needs its name, price and page — not its photos or id.
      sections.push(
        renderProductsSection(products, {
          title: 'PRODUCTS & SERVICES (for featuring)',
          images: false,
          ids: false,
          hint: null
        })
      );
    }
  } else if (needGrow && recentPosts?.length) {
    const postLines = recentPosts.map(
      (p) =>
        `- [${p.platform}] ${p.status}${p.pillar ? ` (${p.pillar})` : ''}: ${(p.caption ?? '').slice(0, 80)}`
    );
    sections.push(`## RECENT POSTS (${recentPosts.length} latest — performance context)
${postLines.join('\n')}`);
  }

  // ── Web hub (SEO & GEO / blog) ──
  if (needWeb) {
    if (seoAudit) {
      const tech = (seoAudit.tech ?? {}) as AnyRec;
      const content = (tech.content ?? {}) as AnyRec;
      const issues = Array.isArray(tech.issues) ? (tech.issues as AnyRec[]) : [];
      const citations = Array.isArray(seoAudit.citations) ? (seoAudit.citations as AnyRec[]) : [];
      const gaps = citations
        .filter((c) => !c.brandMentioned)
        .slice(0, 8)
        .map((c) => `- ${c.prompt}`)
        .join('\n');
      sections.push(`## SEO & GEO AUDIT
Tech score: ${seoAudit.tech_score ?? 'n/a'}
Audited: ${seoAudit.created_at ?? 'n/a'}
AI share of voice: ${seoAudit.share_of_voice ?? 'n/a'}
Content: words=${content.wordCount ?? '?'}, h1=${content.h1Count ?? '?'}, textRatio=${content.textRatio ?? '?'}
Top issues:
${issues
  .slice(0, 8)
  .map((i) => `- [${i.severity ?? 'info'}] ${i.title ?? ''}`)
  .join('\n') || '(none)'}
Citation gaps (brand not mentioned):
${gaps || '(none)'}`);
    } else {
      sections.push(`## SEO & GEO AUDIT
(no audit yet — run run_seo_geo_audit when needed)`);
    }

    if (seoPlan) {
      const ev = (seoPlan.evaluation ?? {}) as AnyRec;
      const inits = Array.isArray(seoPlan.initiatives) ? (seoPlan.initiatives as AnyRec[]) : [];
      sections.push(`## SEO GROWTH PLAN
Grade: ${seoPlan.grade ?? 'n/a'}
Summary: ${typeof ev.summary === 'string' ? ev.summary.slice(0, 600) : '(not set)'}
Initiatives:
${inits
  .slice(0, 10)
  .map(
    (i) =>
      `- [${i.type ?? ''}] ${i.title ?? ''} → ${i.targetQuery ?? ''} (effort ${i.effort ?? '?'}, impact ${i.impact ?? '?'})`
  )
  .join('\n') || '(none)'}`);
    } else {
      sections.push(`## SEO GROWTH PLAN
(no plan yet — run generate_seo_plan when needed)`);
    }

    if (articles?.length) {
      const artLines = articles.map(
        (a) =>
          `- id=${a.id} [${a.status}] ${a.title ?? 'Untitled'}${a.scheduled_for ? ` @ ${formatInZone(a.scheduled_for, tz)} ${tz} [${a.scheduled_for}]` : ''}`
      );
      sections.push(`## BLOG ARTICLES (${articles.length} latest)
${artLines.join('\n')}`);
    } else {
      sections.push(`## BLOG ARTICLES
(none yet)`);
    }

    // Web agent (and auto) needs product URLs for blog internal/product linking advice.
    if (products?.length && !needBrand && !needPublish) {
      // A blog post links products and embeds their photos, so this projection keeps the images.
      sections.push(
        renderProductsSection(products, {
          title: 'PRODUCTS & SERVICES (for blog / internal product links)',
          max: 30,
          ids: false,
          descriptions: false,
          hint: '- Use exact product URLs only. Call read_products for details; sync_products (Brand hub) if ecommerce URLs are missing.'
        })
      );
    }

    if (sitePages?.length) {
      const pageLines = sitePages.map((p) => {
        const topics = Array.isArray(p.topics) && p.topics.length ? ` [${(p.topics as string[]).slice(0, 4).join(', ')}]` : '';
        return `- ${p.title || p.url} → ${p.url}${topics}`;
      });
      sections.push(`## SITE CONTENT LIBRARY (indexed pages — exact URLs for internal links)
${pageLines.join('\n')}
Call read_site_pages for more. Never invent page URLs. If empty/stale, ask the user to rescan Library at /app/${brand.slug}/settings/library.`);
    } else {
      sections.push(`## SITE CONTENT LIBRARY
(no indexed pages yet — call read_site_pages; if still empty, point the user to /app/${brand.slug}/settings/library to scan the site before relying on internal links)`);
    }
  }

  // Onboarding come conversazione: sul thread di setup (surface='onboarding') il vero incarico
  // viaggia QUI, lato server — il messaggio visibile dell'utente resta solo l'URL che ha digitato.
  // Import dinamico per non chiudere il ciclo onboarding-chat → queue → system-prompt.
  if (opts?.threadId) {
    const { onboardingBriefSection } = await import('$lib/server/onboarding-chat');
    const onboardingBrief = await onboardingBriefSection(supabase, opts.threadId, brand, locale);
    if (onboardingBrief) sections.push(onboardingBrief);
  }

  return [...sections, ...tailSections].join('\n\n');
}

async function fetchNotificationsBlock(supabase: SupabaseClient, brandId: string): Promise<string> {
  const { data: fullBrand } = await supabase
    .from('brands')
    .select(
      'id, slug, plan, status, timezone, target_platforms, content_prefs, blog_config, autopilot_failure_count, onboarding_completed_at'
    )
    .eq('id', brandId)
    .maybeSingle();
  if (!fullBrand) return '';
  const noticesP = import('$lib/server/supabase-admin')
    .then(({ createAdminClient }) => listAgentNotices(createAdminClient(), brandId))
    .catch(() => []);
  const [warnings, notices] = await Promise.all([loadBrandWarnings(supabase, fullBrand), noticesP]);
  return renderNotificationsBlock(warnings, notices);
}

export const TURN_CONTEXT_TAG = '[CONTESTO OPERATIVO DEL TURNO]';

export function wrapTurnContext(block: string, userText: string): string {
  if (!block) return userText;
  return `${TURN_CONTEXT_TAG}\n${block}\n\n---\n\n${userText}`;
}

export function wrapTurnMessage(block: string, message: ModelMessage): ModelMessage {
  if (!block) return message;
  if (typeof message.content === 'string') {
    return { ...message, content: wrapTurnContext(block, message.content) };
  }
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [{ type: 'text', text: `${TURN_CONTEXT_TAG}\n${block}\n\n---\n\n` }, ...message.content]
    };
  }
  return message;
}

/**
 * Ciò che cambia a ogni turno — crediti vivi, orologio, campanella — in UNA busta sola. I
 * consumatori la avvolgono al messaggio che fa da stimolo (wrapTurnContext) invece di incollarla
 * nel system prompt, che resta byte-stabile fra turni consecutivi dello stesso thread.
 */
export async function buildTurnVolatileBlock(
  supabase: SupabaseClient,
  brand: AnyRec,
  locale: string = 'en'
): Promise<string> {
  const brandId = brand.id as string;
  const tz = (brand.timezone as string) || 'Europe/Rome';
  const lang = localeLanguageName(locale);
  const planKey = (brand.plan as string | null) ?? null;
  const planLabel = planKey ? (PLAN_LABELS[planKey] ?? planKey) : 'none (free / unpaid)';
  const subStatus = (brand.status as string) || 'trial';

  const budget = await remaining(supabase, brandId, planKey, tz, {
    id: brandId,
    plan: planKey,
    activated_at: (brand.activated_at as string | null) ?? null,
    status: subStatus
  });
  const creditsPct = Math.round(budget.credits.percent);
  const softWarn =
    budget.credits.remaining <= 0 || budget.posts <= 0
      ? 'HARD LIMIT HIT'
      : creditsPct >= 80
        ? 'SOFT WARN — credits nearly exhausted'
        : 'ok';

  const capacity = `## CAPACITY & LIMITS (live — ${softWarn})
Plan: ${planLabel}${planKey ? ` (${planKey})` : ''} · status=${subStatus}
Posts this month: ${budget.postsUsed}/${budget.postsQuota} (${budget.posts} left)
AI credits this billing period: ${budget.credits.used}/${budget.credits.quota} used (${budget.credits.remaining} left, ${creditsPct}%)
Credits reset around: ${budget.credits.periodEnd.toISOString()}

CREDITS / LIMITS PLAYBOOK:
- If remaining credits are 0 OR a tool returns error "credits_exhausted": STOP generating. Explain clearly — in the language of the user's latest message, ${lang} only as fallback — that AI credits for this billing period are used up (mention approximate reset). Immediately call offer_upgrade so they can upgrade/check out in chat. Do NOT retry create_post / generate_image / produce_week / generate_content.
- If posts left is 0: explain the monthly post cap, call offer_upgrade, stop creating posts.
- Chat also has rolling 5-hour and weekly credit windows (separate from the monthly pool). If the user hits those, the app blocks the turn with a clear message — explain briefly and offer_upgrade when relevant; do not invent workarounds.
- If credits ≥80% used and the user asks for a large batch (e.g. 5 posts + images): warn before starting, offer a smaller batch OR call offer_upgrade for more headroom.
- Never claim generation succeeded when a tool returned a credit/quota error. Frame the upgrade as unlocking the exact work they asked for — helpful, not pushy.`;

  const notifications = await fetchNotificationsBlock(supabase, brandId).catch(() => '');

  return [capacity, buildClockSection(tz), notifications].filter(Boolean).join('\n\n');
}
