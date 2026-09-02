import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { EDITOR_POST_COLS } from '$lib/server/post-editing';
import { remaining } from '$lib/server/usage';
import { isShowableMediaUrl, MAX_CHAT_MEDIA } from '$lib/chat-media';
import { withBrandContext } from '$lib/server/ai-log';
import { resolveWorkbenchPath } from '$lib/server/chat/workbench-path';
import { readPostsResult } from '$lib/server/chat/read-posts-count';
import type { ChatToolCtx } from './shared';
import { startLongToolJob, type AnyRec } from './shared';
import { noteRead } from '$lib/server/chat/read-guards';

// ── READ tools ──────────────────────────────────────────────────────────


function gtmCurrentPhase(raw: unknown): AnyRec | undefined {
  const phases: AnyRec[] = Array.isArray(raw)
    ? (raw as AnyRec[])
    : ((raw as AnyRec)?.horizon_6m ?? (raw as AnyRec)?.horizon_90d ?? []);
  return phases.find((p) => !p.end_date || new Date(p.end_date) >= new Date());
}

/** Focused reads hand the model the real post images; a long browse stays text-only. */
const READ_POSTS_VISION_MAX = 5;
/**
 * fetchImagePart accepts anything under 6MB, so five full-resolution post images could put ~40MB of
 * base64 into a single tool result — repeated on every step of the run, which kills the turn. Stop
 * attaching once this much has been gathered.
 */
const READ_POSTS_VISION_BYTES = 4_000_000;

export function readTools(ctx: ChatToolCtx) {
  const { supabase, brandId, tz, userId, origin, locale, threadId } = ctx;
  return {
    read_brand_kit: tool({
      description: 'Read the full brand kit: identity, audience, colors, fonts, AI character, content pillars, visual style, and brand context brief.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const { data } = await supabase.from('brand_kit').select('*').eq('brand_id', brandId).maybeSingle();
        if (!data) return { error: 'No brand kit found' };
        const { ai_context, visual_style, ...rest } = data;
        return {
          ...rest,
          ai_context: ai_context ? ai_context.slice(0, 2000) + (ai_context.length > 2000 ? '...' : '') : null,
          visual_style: visual_style ? visual_style.slice(0, 500) : null
        };
      }
    }),

    show_setup_checklist: tool({
      description: 'Show the brand SETUP CHECKLIST inline in the chat — the todo list of what is still missing to complete the brand (studio, strategy, editorial plan, blog, radar, SEO). Call it when the user asks about setup status / what is left to do, or when it helps steer them to the next step. The checklist renders as an interactive card; do NOT restate every item in text — just introduce it briefly.',
      inputSchema: z.object({}),
      execute: async () => {
        const { buildSetupChecklist } = await import('$lib/server/setup-checklist');
        return buildSetupChecklist(supabase, brandId);
      }
    }),

    get_billing_status: tool({
      description:
        'Read the brand subscription from the DB (source of truth). Call when the user says they paid / asks if they are activated / complains features are locked. NEVER confirm payment from chat alone — trust this result. If unpaid, explain and call offer_upgrade.',
      inputSchema: z.object({}),
      execute: async () => {
        const { canConnectSocials, hasSocialPublishing, hasWebHub, isPaidPlan } = await import('$lib/plans');
        const { PLAN_LABELS } = await import('$lib/server/plans');
        const { isPlanGoEnabled } = await import('$lib/server/feature-flags');
        const { data: b } = await supabase
          .from('brands')
          .select('plan, status, activated_at, stripe_customer_id, stripe_subscription_id, timezone')
          .eq('id', brandId)
          .maybeSingle();
        if (!b) return { error: 'Brand not found' };
        const plan = (b.plan as string | null) ?? null;
        const status = (b.status as string) || 'trial';
        const paid = isPaidPlan(plan);
        const webHub = hasWebHub(plan);
        const planGoOffered = isPlanGoEnabled();
        const access =
          status === 'active' && paid
            ? 'PAID_ACTIVE'
            : status === 'paused'
              ? 'PAUSED_PAYMENT_ISSUE'
              : 'UNPAID';
        const budget = await remaining(supabase, brandId, plan, b.timezone ?? tz, {
          id: brandId,
          plan,
          activated_at: b.activated_at ?? null,
          status
        });
        return {
          access,
          status,
          plan,
          plan_label: plan ? (PLAN_LABELS[plan] ?? plan) : null,
          activated_at: b.activated_at ?? null,
          stripe_customer_linked: !!b.stripe_customer_id,
          stripe_subscription_linked: !!b.stripe_subscription_id,
          can_connect_socials: canConnectSocials(plan, status),
          has_social_publishing: hasSocialPublishing(plan),
          web_hub_unlocked: webHub,
          plan_go_offered: planGoOffered,
          paid_plans_to_mention: planGoOffered ? 'Go, Starter, or Pro' : 'Starter or Pro',
          posts_remaining: budget.posts,
          credits_remaining: budget.credits.remaining,
          credits_reset: budget.credits.periodEnd.toISOString(),
          hint:
            access === 'PAID_ACTIVE'
              ? 'Payment confirmed in DB. Guide next steps (socials, drafts, calendar).'
              : access === 'PAUSED_PAYMENT_ISSUE'
                ? 'Subscription paused / past_due. Do not say activation succeeded. Point to billing /activate.'
                : 'NOT paid/activated in DB. Web hub / Radar / Leads are still unlocked (free matches Go). Autopublish + social connects need Starter/Pro — call offer_upgrade when they ask to connect or publish.'
        };
      }
    }),

    list_social_accounts: tool({
      description:
        'List connected social accounts for this brand (platform, username, status). Call before claiming accounts are missing or connected, and when the user says publishing / Instagram / the platform is broken.',
      inputSchema: z.object({}),
      execute: async () => {
        const { canConnectSocials } = await import('$lib/plans');
        const [{ data: accounts }, { data: b }] = await Promise.all([
          supabase
            .from('social_accounts')
            .select('id, platform, username, display_name, status, connected_at, profile_url')
            .eq('brand_id', brandId)
            .order('connected_at', { ascending: false })
            .limit(30),
          supabase.from('brands').select('plan, status').eq('id', brandId).maybeSingle()
        ]);
        const rows = accounts ?? [];
        const active = rows.filter((a) => a.status === 'active');
        const broken = rows.filter((a) => a.status !== 'active');
        return {
          can_connect_socials: canConnectSocials(b?.plan, b?.status),
          active_count: active.length,
          broken_count: broken.length,
          accounts: rows,
          hint:
            active.length > 0
              ? 'Accounts are connected. If publishing fails, call list_brand_errors — do not say socials are missing.'
              : canConnectSocials(b?.plan, b?.status)
                ? 'No active socials — guide user to Settings to connect (paid plan allows OAuth).'
                : 'UNPAID / free trial: cannot connect socials. Call offer_upgrade or propose_open_tab /activate. NEVER say "go to Settings and connect".'
        };
      }
    }),

    list_brand_errors: tool({
      description:
        'Brand-scoped diagnostics: recent failed posts (with publish/Zernio error text), publish_logs failures, failed chat jobs, and open incidents (schedule/Zernio mismatches). Call when the user says the platform does not work, posts fail, or something is broken — cite concrete errors, do not guess.',
      inputSchema: z.object({
        limit: z.number().min(1).max(30).optional().describe('Max items per category (default 10)')
      }),
      execute: async ({ limit = 10 }: { limit?: number }) => {
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const [{ data: failedPosts }, { data: pubLogs }, { data: failedJobs }] = await Promise.all([
          supabase
            .from('posts')
            .select('id, platform, status, caption, attention_reason, scheduled_for, created_at')
            .eq('brand_id', brandId)
            .eq('status', 'failed')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(limit),
          supabase
            .from('publish_logs')
            .select('id, post_id, platform, status, error, created_at')
            .eq('brand_id', brandId)
            .eq('status', 'failed')
            .not('error', 'is', null)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(limit),
          supabase
            .from('chat_jobs')
            .select('id, tool_name, status, error, created_at, completed_at')
            .eq('brand_id', brandId)
            .eq('status', 'failed')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(limit)
        ]);

        // Attach latest publish error onto failed posts (same pattern as content page).
        const errByPost = new Map<string, string>();
        for (const l of pubLogs ?? []) {
          if (l.post_id && l.error && !errByPost.has(l.post_id)) errByPost.set(l.post_id, l.error);
        }
        const posts = (failedPosts ?? []).map((p) => ({
          ...p,
          caption: (p.caption ?? '').slice(0, 100),
          last_error: errByPost.get(p.id) ?? null
        }));

        // Incidents are service_role-only RLS — read brand-scoped via admin.
        let incidents: AnyRec[] = [];
        try {
          const { createAdminClient } = await import('$lib/server/supabase-admin');
          const admin = createAdminClient();
          const { data } = await admin
            .from('incidents')
            .select('id, kind, severity, details, detected_at, resolved_at')
            .eq('brand_id', brandId)
            .is('resolved_at', null)
            .order('detected_at', { ascending: false })
            .limit(limit);
          incidents = (data ?? []).map((i) => ({
            id: i.id,
            kind: i.kind,
            severity: i.severity,
            detected_at: i.detected_at,
            details_summary:
              typeof i.details === 'object' && i.details
                ? JSON.stringify(i.details).slice(0, 400)
                : null
          }));
        } catch {
          /* admin optional in some envs */
        }

        const hasAny =
          posts.length > 0 || (pubLogs?.length ?? 0) > 0 || (failedJobs?.length ?? 0) > 0 || incidents.length > 0;

        return {
          window_days: 30,
          failed_posts: posts,
          publish_errors: (pubLogs ?? []).map((l) => ({
            id: l.id,
            post_id: l.post_id,
            platform: l.platform,
            error: (l.error ?? '').slice(0, 500),
            created_at: l.created_at
          })),
          failed_chat_jobs: (failedJobs ?? []).map((j) => ({
            id: j.id,
            tool_name: j.tool_name,
            error: (j.error ?? '').slice(0, 400),
            created_at: j.created_at
          })),
          open_incidents: incidents,
          hint: hasAny
            ? 'Cite specific errors to the user. Common fixes: reconnect social, edit caption & re-approve, wait for Klarna/payment sync, check media_url missing.'
            : 'No recent brand-scoped errors in DB. Re-check subscription + social accounts; ask what exact action failed.'
        };
      }
    }),

    offer_upgrade: tool({
      description:
        'Show an in-chat PRICING widget with the plan(s) the brand can upgrade to, with a real checkout button. ALWAYS call this when credits_exhausted / posts_quota_exhausted, when CAPACITY & LIMITS shows 0 remaining credits or posts, when the user wants more capacity than the current plan allows, or when they ask about plans/pricing. Introduce in ONE line naming what they unlock (more credits / posts / accounts); do NOT list prices/features in text (the card shows them). If already on the top plan, tell them so instead.',
      inputSchema: z.object({}),
      execute: async () => {
        const { plansAbove, isTopPlan, PLAN_LABELS } = await import('$lib/server/plans');
        const { data: brand } = await supabase.from('brands').select('slug, plan').eq('id', brandId).maybeSingle();
        const plan = (brand?.plan as string | null) ?? null;
        return {
          current_plan: plan,
          current_label: plan ? (PLAN_LABELS[plan] ?? plan) : null,
          is_top: isTopPlan(plan),
          offers: plansAbove(plan).map((p) => ({ key: p.key, label: p.label })),
          slug: brand?.slug ?? ''
        };
      }
    }),

    propose_open_tab: tool({
      description:
        'Propose switching the user to a dashboard page in the right workbench. Renders a confirm button — the user must click to open; you never navigate unilaterally. Use when they need to review/approve/continue on a specific page, or when answering about something on another tab. Check LIVE WORKBENCH first: if they are already on that page, do not propose. Introduce in one short sentence; the card shows the button.',
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            'Path under /app/{slug}. Examples: /strategy, /publish, /calendar, /plan, /campaigns, /studio, /motion-video, /voice, /rubrics, /gtm, /analytics, /radar, /leads, /agents, /seo, /geo, /site, /settings, /settings/connectors. Do not invent unknown segments.'
          ),
        reason: z
          .string()
          .max(160)
          .optional()
          .describe('One short line on the confirm card explaining why they should open it.')
      }),
      execute: async ({ path, reason }) => {
        const { data: brand } = await supabase.from('brands').select('slug').eq('id', brandId).maybeSingle();
        const slug = brand?.slug as string | undefined;
        if (!slug) return { error: 'Brand not found' };
        const resolved = resolveWorkbenchPath(path, slug);
        if (!resolved) return { error: 'Invalid or disallowed path', path };
        return {
          path: resolved.path,
          href: resolved.href,
          reason: reason?.trim() || null
        };
      }
    }),

    ask_user_questions: tool({
      description:
        'Present one or more multiple-choice questions as clickable option rows in the chat. The user answers by tapping a row (no typing). Prefer this whenever you need a clear choice (priority, tone, platform, yes/no, A/B options). CALLING THIS ENDS YOUR TURN: the run stops right after this step and only resumes when the user answers (or skips), so do it LAST — never in the same step as work you still have to finish, and never as a way to announce something. Put EVERY question you need in ONE call (up to 5): they become a single wizard the person walks through one question at a time, with Back to change an answer, a free-text option and a Skip — and all the answers come back together as one user message. Never ask them one card at a time. An answer you did not offer means they typed it; a (skipped) answer means they declined that question — decide it yourself and do not ask it again. Do NOT restate every option in your text; introduce briefly in one line and let the card carry the choices.',
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              id: z.string().describe('Stable id for this question (e.g. "priority")'),
              prompt: z.string().min(1).max(200).describe('Short question shown above the buttons'),
              options: z
                .array(
                  z.object({
                    id: z.string().describe('Stable option id'),
                    label: z
                      .string()
                      .min(1)
                      .max(80)
                      .describe('Option title — this exact text is what the user "says" when they click'),
                    description: z
                      .string()
                      .max(120)
                      .optional()
                      .describe(
                        'ALWAYS write this. One short line under the title saying what picking it MEANS or does ("Threads today, LinkedIn post on Sunday"). Without it the titles are bare words and the person picks at random.'
                      )
                  })
                )
                .min(2)
                .max(6)
            })
          )
          .min(1)
          .max(5)
      }),
      execute: async ({ questions }) => {
        const { normalizeQuestionsPayload } = await import('$lib/chat-questions');
        const normalized = normalizeQuestionsPayload({ questions });
        if (!normalized) return { error: 'Invalid questions payload' };
        return normalized;
      }
    }),

    read_strategy: tool({
      description: 'Read the brand strategy: competitive research report, positioning, active editorial plan summary, and active GTM plan summary.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const [
          { data: strategy },
          { data: editorial },
          { data: gtm }
        ] = await Promise.all([
          supabase.from('brand_strategy').select('report, positioning, benchmark').eq('brand_id', brandId).maybeSingle(),
          supabase.from('editorial_plans').select('strategy, voice, cadence, platform_mix, gtm, weeks').eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
          supabase.from('gtm_plans').select('horizon, objective, phases').eq('brand_id', brandId).eq('status', 'active').maybeSingle()
        ]);
        return {
          brand_strategy: strategy ? { positioning: strategy.positioning, report_summary: (strategy.report as AnyRec)?.summary ?? null } : null,
          editorial_plan: editorial ? { strategy: editorial.strategy?.slice(0, 800), voice: editorial.voice, cadence: editorial.cadence, platform_mix: editorial.platform_mix, weeks: (editorial.weeks as AnyRec[])?.map((w) => ({ theme: w.theme, focus: w.focus, status: w.status })) } : null,
          gtm_plan: gtm ? { horizon: gtm.horizon, objective: gtm.objective, current_phase: gtmCurrentPhase(gtm.phases)?.name ?? null } : null
        };
      }
    }),

    // ── SEO & GEO ───────────────────────────────────────────────────────────

    read_seo_geo_audit: tool({
      description: 'Read the latest SEO & GEO audit: technical score, top issues, on-page content summary, AI share-of-voice, and the category questions where the brand is NOT cited by AI answers (with which competitors ARE cited). Use before advising, or after run_seo_geo_audit finishes.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const { data } = await supabase.from('brand_geo_audits').select('tech_score, tech, share_of_voice, citations, created_at').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!data) return { error: 'No audit yet. Run run_seo_geo_audit first.' };
        const tech = (data.tech ?? {}) as AnyRec;
        const content = (tech.content ?? {}) as AnyRec;
        const citations = Array.isArray(data.citations) ? (data.citations as AnyRec[]) : [];
        return {
          tech_score: data.tech_score,
          top_issues: Array.isArray(tech.issues) ? (tech.issues as AnyRec[]).map((i) => ({ severity: i.severity, title: i.title, fix: i.fix })).slice(0, 10) : [],
          content: { words: content.wordCount, h1: content.h1Count, textRatio: content.textRatio, imagesWithoutAlt: content.imagesWithoutAlt },
          ai_share_of_voice: data.share_of_voice,
          citation_gaps: citations.filter((c) => !c.brandMentioned).map((c) => ({ query: c.prompt, competitors_cited: (c.competitors ?? []).slice(0, 5) })),
          audited_at: data.created_at
        };
      }
    }),

    read_seo_plan: tool({
      description: 'Read the latest SEO growth plan: the qualitative evaluation (grade, strengths, weaknesses) and the recommended initiatives (blog, landing pages, free tools, comparisons) with target query, effort and impact.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const { data } = await supabase.from('brand_seo_plans').select('grade, evaluation, initiatives, created_at').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!data) return { error: 'No SEO plan yet. Run generate_seo_plan first.' };
        const ev = (data.evaluation ?? {}) as AnyRec;
        const inits = Array.isArray(data.initiatives) ? (data.initiatives as AnyRec[]) : [];
        return {
          grade: data.grade, summary: ev.summary, strengths: ev.strengths, weaknesses: ev.weaknesses,
          initiatives: inits.map((i) => ({ id: i.id, type: i.type, title: i.title, target_query: i.targetQuery, effort: i.effort, impact: i.impact }))
        };
      }
    }),

    run_seo_geo_audit: tool({
      description: 'Run a fresh SEO & GEO audit of the brand website (technical crawl + on-page content + AI citation share-of-voice). Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. When the result lands, call read_seo_geo_audit to read the numbers.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => startLongToolJob(supabase, brandId, userId, 'seo_geo_audit', {}, threadId, opts.abortSignal, origin, locale)
    }),

    generate_seo_plan: tool({
      description: 'Generate the SEO growth plan: a qualitative evaluation + prioritized initiatives (blog, landing pages for specific queries, free tools, comparisons), grounded in the real search landscape. Run run_seo_geo_audit first for a site-grounded plan. Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn. Replaces the current plan.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => startLongToolJob(supabase, brandId, userId, 'seo_plan', {}, threadId, opts.abortSignal, origin, locale)
    }),

    add_seo_initiatives: tool({
      description: "Add MORE recommended SEO initiatives to the existing plan WITHOUT removing the current ones. Pass the user's direction if they told you what to focus on (e.g. 'target local searches', 'free tools for developers'). Runs in the BACKGROUND: it returns immediately with a job id and the result comes back to you as a NEW message when it lands, so say one line and end your turn.",
      inputSchema: z.object({ guidance: z.string().optional().describe("What the user wants to focus on, in their words. Optional.") }),
      execute: async ({ guidance }: { guidance?: string }, opts: ToolExecutionOptions<unknown>) => startLongToolJob(supabase, brandId, userId, 'seo_add_initiatives', { guidance: guidance ?? '' }, threadId, opts.abortSignal, origin, locale)
    }),

    read_backlink_network: tool({
      description:
        'Read the Anomalia cross-brand backlink network for this brand: whether it is opted in, outbound/inbound placements, and open give/receive opportunities. Free (no AI cost).',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>) => {
        const { loadBacklinkNetworkSummary } = await import('$lib/server/backlink-network');
        return loadBacklinkNetworkSummary(supabase, brandId);
      }
    }),

    generate_backlink_opportunities: tool({
      description:
        'Regenerate ranked give/receive backlink opportunities across the Anomalia network (partner articles to link to, and your posts partners may link). Requires Starter plan or above. Returns counts when done.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const { createAdminClient } = await import('$lib/server/supabase-admin');
        const { generateBacklinkOpportunities } = await import('$lib/server/backlink-network');
        const { hasBacklinkNetwork } = await import('$lib/plans');
        const { data: brand } = await supabase
          .from('brands')
          .select('id, name, website, content_prefs, blog_config, plan')
          .eq('id', brandId)
          .maybeSingle();
        if (!brand) return { error: 'Brand not found' };
        if (!hasBacklinkNetwork(brand.plan)) {
          return { error: 'Backlink network requires Starter or above', upgrade: 'starter' };
        }
        void opts;
        return generateBacklinkOpportunities(createAdminClient(), brand);
      }
    }),

    read_editorial_plan: tool({
      description: 'Read the active editorial plan in full detail: all 4 weeks with themes, focus, content mix, and briefs.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const { data } = await supabase.from('editorial_plans').select('*').eq('brand_id', brandId).eq('status', 'active').maybeSingle();
        if (!data) return { error: 'No active editorial plan found' };
        return {
          id: data.id,
          strategy: data.strategy,
          voice: data.voice,
          cadence: data.cadence,
          platform_mix: data.platform_mix,
          weeks: data.weeks
        };
      }
    }),

    read_posts: tool({
      description:
        'Read posts filtered by status (includes media_url / media_urls and media_origin). With status "published" (or no status) the result ALSO carries `published_on_socials`: what the brand published on its own connected accounts, which is not in the posts table — so "nothing published" is only true when both are empty. Each post is annotated with media_origin: typographic_graphic (editable HTML/TSX — patch with grep_source / read_source / replace_source; write_source only to rebuild; design_graphic for a high-level brief; new photos → generate_image then replace_source <img src>), ai_generated, user_uploaded, video, or none. Reading is SILENT: nothing is shown to the user unless you pass show_to_user: true.',
      inputSchema: z.object({
        status: z.enum(['pending_user', 'approved', 'scheduled', 'published', 'failed']).optional().describe('Filter by post status. Omit to get all recent posts.'),
        limit: z.number().min(1).max(50).optional().describe('Max posts to return (default 20). `count` nel risultato è quante ne ESISTONO col filtro chiesto, `returned` quante ne vedi qui'),
        show_to_user: z
          .boolean()
          .optional()
          .describe(
            'Default false. When true, the posts returned by THIS call also render as PostCard previews (image + caption) under your message. Set it only when you deliberately want the user to look at these posts; leave it out when you are just reading for context.'
          )
      }),
      execute: async ({ status, limit = 20 }: { status?: string; limit?: number }, opts: ToolExecutionOptions<unknown>) => {
        let query = supabase
          .from('posts')
          .select(`${EDITOR_POST_COLS}, pillar, first_comment`)
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (status) query = query.eq('status', status);
        // Il conteggio VERO, senza portarsi dentro una riga: `head: true` non trasferisce dati.
        // Senza, `count` era la lunghezza della pagina e l'agente rispondeva 20 dove erano 60.
        let counter = supabase
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', brandId);
        if (status) counter = counter.eq('status', status);
        const [{ data, error }, { count: total }] = await Promise.all([query, counter]);
        if (error) return { error: error.message };
        const posts = (data ?? []) as AnyRec[];
        // Ogni riga letta è un receipt: update_post su uno di questi id passa il gate finché la
        // riga non cambia di nuovo (updated_at arriva da EDITOR_POST_COLS).
        for (const p of posts) noteRead('post', String(p.id), p.updated_at);
        const failedIds = posts.filter((p) => p.status === 'failed').map((p) => p.id as string);
        if (failedIds.length) {
          const { data: errLogs } = await supabase
            .from('publish_logs')
            .select('post_id, error')
            .in('post_id', failedIds)
            .eq('status', 'failed')
            .not('error', 'is', null)
            .order('created_at', { ascending: false });
          const firstErr = new Map<string, string>();
          for (const l of errLogs ?? []) if (l.error && !firstErr.has(l.post_id)) firstErr.set(l.post_id, l.error);
          for (const p of posts) {
            const e = firstErr.get(p.id as string);
            if (e) p.last_error = e;
          }
        }
        const { latestGraphicsByPostIds, annotatePostMedia } = await import('$lib/server/media-origin');
        const graphics = await latestGraphicsByPostIds(
          supabase,
          posts.map((p) => String(p.id))
        );
        for (const p of posts) {
          const origin = annotatePostMedia(p, graphics.get(String(p.id)) ?? null);
          Object.assign(p, origin);
        }

        // Which of these are still waiting on a clip. Asked separately rather than added to
        // EDITOR_POST_COLS on purpose: that list warns that an unmigrated column in it breaks
        // every post read in the app, so a missing migration 0180 costs this annotation alone.
        // Without it the assistant reads a cover as finished media and tells the user the video
        // is ready — or worse, launches the render a second time.
        const { data: pending } = await supabase
          .from('posts')
          .select('id, video_render_status')
          .eq('brand_id', brandId)
          .in('id', posts.map((p) => String(p.id)))
          .eq('video_render_status', 'rendering');
        const renderingIds = new Set((pending ?? []).map((r) => String((r as AnyRec).id)));
        for (const p of posts) {
          if (renderingIds.has(String(p.id))) {
            p.video_render_status = 'rendering';
            p.video_note =
              'The clip for this post is still rendering. media_url is the cover frame, not the video — do not call it finished and do not start another render.';
          }
        }
        // ── LO STORICO CONTA COME PUBBLICATO ─────────────────────────────────────────────
        // L'Analyst diceva «non risultano post pubblicati» a un brand che ne aveva quattro
        // (eval del 24/8). Non mentiva: `posts` tiene solo quello che ha pubblicato QUESTO
        // prodotto, mentre ciò che il brand ha davvero pubblicato sui suoi account vive in
        // `social_post_history`. Chiunque chieda «cosa ho pubblicato» merita la risposta vera,
        // non la metà che ci siamo fatti noi — quindi la seconda sorgente si allega qui, dove
        // passano tutti i chiamanti, invece che in un tool nuovo che il modello deve scoprire.
        // Solo su 'published' (o senza filtro): su 'pending_user'/'scheduled' non c'entra nulla.
        if (!status || status === 'published') {
          const { loadOwnPostHistory } = await import('$lib/server/own-post-history');
          const history = await loadOwnPostHistory(supabase, brandId, { limit });
          if (history.length) {
            return {
              ...readPostsResult({ posts, total: total ?? null, limit }),
              published_on_socials: history,
              published_on_socials_note: `${history.length} post the brand actually published on its connected accounts (social_post_history), newest first. These are published too — count them when the question is "what did we publish". They have no post id here: they were not created in this product, so they cannot be edited or rescheduled.`
            };
          }
        }
        return readPostsResult({ posts, total: total ?? null, limit });
      },
      // media_url in the JSON is a link, and a link is invisible to the model — it would "review" a
      // post image it never looked at. Hand the actual pixels over on a focused read; a 20-post
      // browse stays text-only so listing does not drag megabytes of images into every turn.
      toModelOutput: async ({ output }) => {
        const value: Array<Record<string, unknown>> = [
          { type: 'text', text: JSON.stringify(output) }
        ];
        const posts = (output as { posts?: AnyRec[] })?.posts ?? [];
        if (posts.length && posts.length <= READ_POSTS_VISION_MAX) {
          const urls = posts
            .map((p) => String(p.media_url ?? ''))
            .filter((u) => /^https?:\/\//i.test(u))
            .slice(0, READ_POSTS_VISION_MAX);
          const { fetchImagePart } = await import('$lib/server/brand-context');
          const parts = (await Promise.all(urls.map((u) => fetchImagePart(u)))).filter(Boolean);
          let budget = READ_POSTS_VISION_BYTES;
          for (const part of parts) {
            const size = part!.inlineData.data.length;
            if (size > budget) break;
            budget -= size;
            // 'image-data', non 'file-data': Google li mappa entrambi su inlineData, ma il
            // provider OpenAI-compat (Luna via kie — il default della chat) mappa 'file-data' su
            // input_file (documento) e solo 'image-data' su input_image. Con 'file-data' il
            // modello "recensiva" immagini che non aveva mai visto.
            value.push({
              type: 'image-data',
              mediaType: part!.inlineData.mimeType,
              data: part!.inlineData.data
            });
          }
        }
        return { type: 'content', value } as never;
      }
    }),

    // Far vedere un media che NON è un post: un fotogramma tirato fuori da un video, tre varianti
    // fra cui scegliere, una clip appena generata da valutare. La lettura dei post è muta
    // (`read_posts` show_to_user), le anteprime dei post sono automatiche su ciò che si crea:
    // questa è la terza strada, e serve solo quando l'oggetto non è un post.
    show_media: tool({
      description:
        'SHOW one or more images/videos to the user in chat, as a block they can click to enlarge (videos play with controls). Use it for media that is NOT a post: a frame pulled out of a video, variants to choose between, a clip you just generated, a chart. Posts are shown with read_posts show_to_user instead, and what you create shows itself. ONLY media that lives in this project storage can be shown (post media_url, media library assets, generate_image / video outputs, artifact URLs) — any other URL is refused: publish it as an artifact first with publish_artifact.',
      inputSchema: z.object({
        media: z
          .array(
            z.object({
              url: z.string().describe('URL of an image or video in this project storage'),
              caption: z.string().optional().describe('One line saying why the user is looking at this')
            })
          )
          .min(1)
          .max(MAX_CHAT_MEDIA)
          .describe(`Up to ${MAX_CHAT_MEDIA} items. Photos and videos can be mixed in the same block.`)
      }),
      execute: async ({ media }: { media: Array<{ url: string; caption?: string }> }) => {
        const shown: Array<{ url: string; caption?: string }> = [];
        const refused: string[] = [];
        for (const m of media) {
          const url = String(m?.url ?? '').trim();
          if (isShowableMediaUrl(url)) shown.push({ url, ...(m.caption ? { caption: m.caption } : {}) });
          else if (url) refused.push(url.slice(0, 200));
        }
        if (!shown.length) {
          return {
            error:
              'Nothing shown: none of these URLs is ours. In chat you can only embed media that lives in this project storage — a post media_url, a media library asset, an image or video you generated, or an artifact URL. For anything else (a page you read, a third-party CDN), download it and hand it over with publish_artifact.',
            refused
          };
        }
        return {
          media: shown,
          count: shown.length,
          ...(refused.length
            ? {
                refused,
                note: `${refused.length} URL(s) were not shown: they are not in this project storage. Use publish_artifact for those.`
              }
            : {})
        };
      }
    }),

    read_products: tool({
      description: 'Read the products and services catalog for this brand (includes page URLs and image URLs when synced from Shopify/WooCommerce).',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const { data } = await supabase.from('products').select('id, title, description, pricing, kind, featured, url, images').eq('brand_id', brandId);
        return { products: data ?? [] };
      }
    }),

    read_site_pages: tool({
      description:
        'Read the brand Site Content Library — indexed website pages (url, title, topics, relevance) used for internal links in blog/SEO. Prefer these exact URLs; never invent page paths. If empty, tell the user to scan Library in settings.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe('Max pages to return (default 30)')
      }),
      execute: async ({ limit }: { limit?: number }) => {
        const { getBrandPages } = await import('$lib/server/content-library');
        const pages = await getBrandPages(supabase, brandId, limit ?? 30).catch(() => []);
        return {
          pages,
          count: pages.length,
          hint:
            pages.length === 0
              ? 'Library is empty — ask the user to open Settings → Library and scan the site.'
              : 'Use exact page URLs for internal links. Call again only if you need a fresh list.'
        };
      }
    }),

    read_people: tool({
      description:
        'Read brand people (real team + AI personas). Returns ids and signed preview URLs — pass people_ids into create_post / design_graphic / generate_image to use their photos as visual references or graphic image blocks.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>) => {
        const { data } = await supabase
          .from('people')
          .select('id, name, role, kind, description, attributes, images')
          .eq('brand_id', brandId);
        const { signPersonImages } = await import('$lib/server/people');
        const people = await Promise.all(
          (data ?? []).map(async (p) => {
            const imgs = Array.isArray(p.images) ? p.images : [];
            const urls = imgs.length ? await signPersonImages(supabase, imgs.slice(0, 3) as { path: string; label?: string }[]) : [];
            return {
              id: p.id,
              name: p.name,
              role: p.role,
              kind: p.kind,
              description: p.description,
              attributes: p.attributes,
              preview_url: urls[0] ?? null,
              image_count: imgs.length,
              image_urls: urls
            };
          })
        );
        return {
          people,
          hint: 'Pass people[].id as people_ids to create_post / design_graphic / generate_image.'
        };
      }
    }),

    read_talents: tool({
      description:
        'List AI talent library models (global photo models). Returns ids + signed preview URLs — pass talent_ids into create_post / design_graphic / generate_image as face/body references.',
      inputSchema: z.object({
        gender: z.string().optional().describe('Optional filter, e.g. female / male / nonbinary')
      }),
      execute: async ({ gender }: { gender?: string }) => {
        const talentMod = await import('$lib/server/talent');
        const g = gender?.trim().toLowerCase();
        const map: Record<string, import('$lib/server/talent').TalentGender> = {
          woman: 'woman',
          female: 'woman',
          man: 'man',
          male: 'man',
          nonbinary: 'nonbinary',
          trans_man: 'trans_man',
          trans_woman: 'trans_woman'
        };
        const filters: import('$lib/server/talent').TalentListFilters =
          g && map[g] ? { gender: map[g] } : {};
        const talents = await talentMod.listTalents(supabase, filters).catch(() => []);
        return {
          talents: talents.slice(0, 40).map((t) => ({
            id: t.id,
            slug: t.slug,
            name: t.name,
            gender: t.gender,
            age: t.age,
            body_type: t.body_type,
            ethnicity: t.ethnicity,
            summary: t.summary,
            preview_url: t.views.find((v) => v.url)?.url ?? null,
            view_count: t.views.length
          })),
          hint: 'Pass talents[].id as talent_ids to create_post / design_graphic / generate_image.'
        };
      }
    }),

    read_competitors: tool({
      description: 'Read competitor data: names, websites, rationale, benchmarks.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>, opts: ToolExecutionOptions<unknown>) => {
        const { data } = await supabase.from('competitors').select('id, name, website, kind, rationale, handles, benchmark').eq('brand_id', brandId);
        return { competitors: data ?? [] };
      }
    }),

    research_meta_ads: tool({
      description:
        'Fetch competitor creatives from the Meta (Facebook/Instagram) Ad Library via ScrapeCreators — NOT Zernio. Zernio only publishes/boosts OUR ads. Use before writing UGC scripts: long-running ACTIVE ads ≈ validated angles. Steal STRUCTURE (Hook→Problem→Demo→Proof→CTA), never clone copy or faces. Prefer company_name of a direct competitor, or a keyword query for the niche pain. Every ad ships a `urls[]` list where each url says what it is FOR: use=inspect_only (their mp4 — analyze with breakdown_reference_video, NEVER generate from it), use=open (the ad page, for the human). The brand’s own reusable references come back separately in `brand_reference_urls` (use=reference) — inspect theirs, generate with yours, and never ask the user to paste a url you were already handed.',
      inputSchema: z.object({
        company_name: z.string().optional().describe('Advertiser / company name in Meta Ad Library (preferred).'),
        query: z.string().optional().describe('Keyword search when company_name is unknown (e.g. niche pain phrase).'),
        country: z.string().optional().describe('2-letter country code (e.g. IT, US). Default ALL.'),
        limit: z.number().min(1).max(30).optional().describe('Max ads to return (default 12).')
      }),
      execute: async (
        {
          company_name,
          query,
          country,
          limit
        }: { company_name?: string; query?: string; country?: string; limit?: number },
        opts: ToolExecutionOptions<unknown>
      ) => {
        return withBrandContext(brandId, async () => {
          const {
            companyMetaAdLibrary,
            searchMetaAdLibrary,
            formatMetaAdsDigestForPlanner,
            metaAdLibraryUrl
          } = await import('$lib/server/meta-ad-library');
          // Il permesso viaggia con l'URL, non nella descrizione del tool: `inspect_only` per il
          // girato del competitor, `reference` per la roba del cliente, `open` per l'umano.
          const { inspectOnlyUrl, openUrl, listBrandReferenceUrls, AGENT_URL_POLICY } =
            await import('$lib/server/agent-urls');
          try {
            const ads = company_name?.trim()
              ? await companyMetaAdLibrary({
                  companyName: company_name.trim(),
                  country: country?.trim() || undefined,
                  limit: limit ?? 12
                })
              : query?.trim()
                ? await searchMetaAdLibrary(query.trim(), {
                    country: country?.trim() || undefined,
                    limit: limit ?? 12
                  })
                : [];
            if (!ads.length) {
              return {
                ads: [],
                digest: '',
                hint: company_name || query
                  ? 'No ads returned — try another company_name / query, or check SCRAPECREATORS_API_KEY.'
                  : 'Pass company_name or query.'
              };
            }
            const brandReferenceUrls = await listBrandReferenceUrls(supabase, brandId);
            return {
              ads: ads.map((a) => ({
                id: a.id,
                page: a.pageName,
                body: a.body,
                title: a.title,
                cta: a.ctaText,
                since: a.startDate,
                active: a.isActive,
                platforms: a.platforms,
                media: a.mediaType,
                // image_url / video_url restano per compatibilità; `urls` è quello che dice
                // cosa se ne può fare, ed è l'unico da cui partire.
                image_url: a.imageUrl,
                video_url: a.videoUrl,
                urls: [
                  ...(a.videoUrl
                    ? [inspectOnlyUrl(a.videoUrl, 'video', `competitor ad video — ${a.pageName || 'unknown page'}`)]
                    : []),
                  ...(a.imageUrl
                    ? [inspectOnlyUrl(a.imageUrl, 'image', `competitor ad still — ${a.pageName || 'unknown page'}`)]
                    : []),
                  openUrl(metaAdLibraryUrl(a.id), 'this ad on Meta Ad Library')
                ]
              })),
              brand_reference_urls: brandReferenceUrls,
              url_policy: AGENT_URL_POLICY,
              digest: formatMetaAdsDigestForPlanner(ads),
              source: 'scrapecreators_meta_ad_library',
              note: 'Zernio cannot fetch Ad Library — only ScrapeCreators. Use digest to rewrite UGC hooks around validated pains.'
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        });
      }
    }),

    fetch_social_thumbs: tool({
      description:
        'Fetch recent post thumbnails for ANY public social handle via ScrapeCreators (Instagram/TikTok/…), archive them, and return signed image_urls. Use for visual references of other brands / competitors before designing posts. Then pass image_urls into design_graphic / create_post(graphic_brief) or reference_image_urls into generate_image. Do not copy captions or recreate their creatives pixel-for-pixel.',
      inputSchema: z.object({
        platform: z.string().describe('instagram | tiktok | linkedin | youtube | facebook | x | threads'),
        handle: z.string().describe('Public handle without @')
      }),
      execute: async ({ platform, handle }: { platform: string; handle: string }) => {
        const { fetchSocialVisualRefs } = await import('$lib/server/design-visual-refs');
        const { thumbs, error } = await fetchSocialVisualRefs(platform, handle);
        if (error && !thumbs.length) return { error, thumbs: [] };
        return {
          platform: platform.trim().toLowerCase(),
          handle: handle.trim().replace(/^@/, '').toLowerCase(),
          thumbs: thumbs.map((t, i) => ({ index: i, image_url: t.url, label: t.label })),
          hint: 'Pass thumbs[].image_url as image_urls to design_graphic / create_post(graphic_brief) or reference_image_urls to generate_image.'
        };
      }
    }),

    read_leads: tool({
      description:
        'Read leads: real online conversations (Reddit/Threads/X) where the product/category is discussed, with AI-drafted comment/DM suggestions. Use to align content with audience questions, objections and language.',
      inputSchema: z.object({
        status: z
          .enum(['suggested', 'done', 'dismissed', 'all'])
          .optional()
          .describe('Filter by lead status (default all)'),
        limit: z.number().min(1).max(50).optional().describe('Max rows (default 25)')
      }),
      execute: async ({ status, limit }: { status?: 'suggested' | 'done' | 'dismissed' | 'all'; limit?: number }) => {
        const { readLeadsForAgent } = await import('$lib/server/strategy-agent-reads');
        return readLeadsForAgent(supabase, brandId, { status, limit });
      }
    }),

    read_documents: tool({
      description:
        'List brand image references, or legacy full-text for a single image kind. For notes/PDFs use search_knowledge + read_document instead.',
      inputSchema: z.object({
        kind: z.enum(['note', 'document', 'image']).optional().describe('Filter by document kind')
      }),
      execute: async ({ kind }: { kind?: string }, opts: ToolExecutionOptions<unknown>) => {
        // Prefer search tools for text; keep image listing here.
        if (kind === 'image' || !kind) {
          let query = supabase
            .from('brand_documents')
            .select('id, kind, title, file_name, summary, status, chunk_count')
            .eq('brand_id', brandId);
          if (kind) query = query.eq('kind', kind);
          else query = query.eq('kind', 'image');
          const { data } = await query.limit(40);
          return { documents: data ?? [] };
        }
        let query = supabase
          .from('brand_documents')
          .select('id, kind, title, summary, status, chunk_count, file_name')
          .eq('brand_id', brandId)
          .eq('kind', kind)
          .limit(40);
        const { data } = await query;
        return { documents: data ?? [], hint: 'Use search_knowledge(query) to retrieve chunk text.' };
      }
    }),

    search_knowledge: tool({
      description:
        'Hybrid search (keyword + semantic) over brand knowledge chunks (uploaded docs & notes). Returns the most relevant passages with document title and section path. Prefer this over dumping whole documents. On a large corpus, narrow it: pass `collection`, or `document_ids` picked from the BRAND DOCUMENTS index.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query'),
        limit: z.number().min(1).max(20).optional().describe('Max chunks (default 8)'),
        collection: z
          .enum(['brand', 'product', 'commercial', 'legal', 'operations', 'research'])
          .optional()
          .describe('Restrict to one collection'),
        document_ids: z
          .array(z.string().uuid())
          .optional()
          .describe('Restrict to specific documents (max 20)')
      }),
      execute: async ({
        query,
        limit,
        collection,
        document_ids
      }: {
        query: string;
        limit?: number;
        collection?: string;
        document_ids?: string[];
      }) => {
        const { searchKnowledge } = await import('$lib/server/knowledge');
        const hits = await searchKnowledge(supabase, brandId, query, {
          limit,
          collection,
          documentIds: document_ids
        });
        return { results: hits, count: hits.length };
      }
    }),

    read_document: tool({
      description:
        'Read one brand document by id. Optionally filter to a heading/section. Returns markdown (or a section slice) plus chunk index.',
      inputSchema: z.object({
        id: z.string().uuid().describe('brand_documents id'),
        section: z.string().optional().describe('Optional heading path substring to focus on')
      }),
      execute: async ({ id, section }: { id: string; section?: string }) => {
        const { data: doc } = await supabase
          .from('brand_documents')
          .select('id, kind, title, markdown, summary, status, chunk_count, updated_at')
          .eq('id', id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!doc) return { error: 'Document not found' };
        if (doc.kind === 'image') return { id: doc.id, kind: doc.kind, title: doc.title };
        noteRead('document', String(doc.id), doc.updated_at);

        let query = supabase
          .from('brand_doc_chunks')
          .select('idx, heading_path, content, tokens')
          .eq('document_id', id)
          .eq('brand_id', brandId)
          .order('idx', { ascending: true });
        const { data: chunks } = await query;
        let list = chunks ?? [];
        if (section) {
          const s = section.toLowerCase();
          list = list.filter(
            (c) =>
              (c.heading_path ?? '').toLowerCase().includes(s) ||
              String(c.content).toLowerCase().includes(s)
          );
        }
        return {
          id: doc.id,
          title: doc.title,
          summary: doc.summary,
          status: doc.status,
          markdown: section ? undefined : (doc.markdown as string | null)?.slice(0, 12_000),
          chunks: list.slice(0, 40).map((c) => ({
            idx: c.idx,
            heading_path: c.heading_path,
            content: String(c.content).slice(0, 2000)
          }))
        };
      }
    }),
  };
}
