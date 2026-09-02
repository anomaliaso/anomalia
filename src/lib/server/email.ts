import { env } from '$env/dynamic/private';
import { tEmail } from './email-i18n';
import { senderEmailDomain } from './support-config';
import type { Locale } from '$lib/i18n/locale';
import type { Stage } from './lifecycle';
import { siteUrl } from '$lib/seo';

// Sender address. The domain must be verified in Resend, otherwise Resend rejects delivery to
// anyone but the account owner. Override EMAIL_FROM entirely, or just EMAIL_DOMAIN to change only
// the domain while keeping the default local-part and display name.
const EMAIL_DOMAIN = env.EMAIL_DOMAIN || senderEmailDomain();
const FROM = env.EMAIL_FROM || `Anomalia <noreply@${EMAIL_DOMAIN}>`;

// Brand accent (matches --accent in app.css). Used for the wordmark's "2" in email headers.
const ACCENT = '#7c5cff';

// Always send a plain-text part alongside the HTML: a missing text/plain alternative is a strong
// spam signal, so this materially improves inbox placement (and degrades gracefully everywhere).
export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<void> {
  // La posta è l'unica cosa che arriva a una PERSONA. La suite gira col `.env` di chi la lancia,
  // quindi da qui partivano davvero: ops ha ricevuto incidenti con dentro thread e run finti. Si
  // ferma qui e non nei mock dei singoli file, perché basta un file che se ne dimentica.
  if (process.env.VITEST) return;

  const key = env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');

  // Bounded on purpose: several callers send mail on a teardown path that is already close to the
  // function wall, so an unbounded Resend call can eat the seconds the caller still needs. Resend
  // answers in well under a second normally — anything past this is a failure, not slow delivery.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text, ...(opts.headers ? { headers: opts.headers } : {}) }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// Escape user/brand-generated text before interpolating into the email HTML.
function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Header: the real Anomalia mark (hosted PNG, reliable across clients) + the wordmark in the
// current brand accent. If the image is blocked, the wordmark still reads as the brand.
function header(origin?: string): string {
  const logo = `${siteUrl(origin)}/icon-192.png`;
  return `<div style="font-size:20px;font-weight:600;line-height:24px;margin-bottom:6px;"><img src="${logo}" width="22" height="22" alt="" style="vertical-align:-5px;border-radius:6px;margin-right:8px;" />Anomalia</div>`;
}

function shell(origin: string | undefined, inner: string): string {
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1d1d1f;padding:8px;">${header(origin)}${inner}</div>`;
}

type PreviewPost = { platform: string | null; caption: string | null; media_url?: string | null };

// One post: its generated image thumbnail (when present) beside the platform + caption.
function postRow(p: PreviewPost): string {
  const platform = esc((p.platform ?? '').toUpperCase());
  const caption = esc((p.caption ?? '').slice(0, 140));
  const thumb = p.media_url
    ? `<td width="68" valign="top" style="padding:0 12px 0 0;"><img src="${esc(p.media_url)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid #e3e3e6;" /></td>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 14px;"><tr>${thumb}<td valign="top" style="font-size:14px;line-height:1.45;color:#1d1d1f;"><div style="color:#86868b;font-size:11px;font-weight:600;letter-spacing:0.04em;margin-bottom:3px;">${platform}</div>${caption}</td></tr></table>`;
}

function cta(approveUrl: string, label: string): string {
  return `<a href="${approveUrl}" style="display:inline-block;background:#1d1d1f;color:#fff;padding:13px 26px;border-radius:980px;text-decoration:none;font-weight:600;margin-top:6px;">${label}</a>`;
}

export function approvalEmailSubject(locale: Locale, brandName: string, count: number): string {
  return tEmail(locale, 'approval.subject', { brand: brandName, count });
}

export function approvalEmailHtml(
  locale: Locale,
  brandName: string,
  count: number,
  approveUrl: string,
  preview: PreviewPost[],
  origin?: string
): string {
  // Show EVERY pending post (with its image), not a truncated sample — the owner approves them all.
  const items = preview.map(postRow).join('');
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'approval.heading', { brand: brandName, count })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 18px;">${tEmail(locale, 'approval.intro')}</p>
    ${items}
    ${cta(approveUrl, tEmail(locale, 'approval.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'approval.footer')}</p>`
  );
}

// Plain-text alternative (deliverability + accessibility).
export function approvalEmailText(
  locale: Locale,
  brandName: string,
  count: number,
  approveUrl: string,
  preview: PreviewPost[]
): string {
  const lines = preview.map((p) => `- ${(p.platform ?? '').toUpperCase()}: ${(p.caption ?? '').slice(0, 140)}`).join('\n');
  return [
    tEmail(locale, 'approval.heading', { brand: brandName, count }),
    '',
    tEmail(locale, 'approval.intro'),
    '',
    lines,
    '',
    `${tEmail(locale, 'approval.cta')} ${approveUrl}`,
    '',
    tEmail(locale, 'approval.footer')
  ].join('\n');
}

// ── Password reset ─────────────────────────────────────────────────────────────────────────────
// Sent when a user requests a password reset from /login. The link points at /auth/confirm, which
// verifies the recovery token (verifyOtp) and forwards to /auth/reset-password to set a new password.
// We mint and send this ourselves via Resend — Supabase's built-in mailer is never used.
export function passwordResetEmailSubject(locale: Locale): string {
  return tEmail(locale, 'auth.reset.subject');
}

export function passwordResetEmailHtml(locale: Locale, resetUrl: string, origin?: string): string {
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'auth.reset.heading')}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 18px;">${tEmail(locale, 'auth.reset.intro')}</p>
    ${cta(resetUrl, tEmail(locale, 'auth.reset.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'auth.reset.footer')}</p>`
  );
}

export function passwordResetEmailText(locale: Locale, resetUrl: string): string {
  return [
    tEmail(locale, 'auth.reset.heading'),
    '',
    tEmail(locale, 'auth.reset.intro'),
    '',
    `${tEmail(locale, 'auth.reset.cta')} ${resetUrl}`,
    '',
    tEmail(locale, 'auth.reset.footer')
  ].join('\n');
}

// ── Onboarding recap ───────────────────────────────────────────────────────────────────────────
// Sent once, when the background onboarding generation finishes. Unlike the approval emails this is
// NOT a one-tap action — there's nothing to approve yet — it just announces what Anomalia generated
// (posts, competitors analysed, a multi-week editorial plan + strategy) and links to the proof page
// where the user reviews everything and continues to activation. No token: the proof page is behind
// the user's normal login (they created the account during onboarding).
export type RecapCounts = { posts: number; competitors: number; weeks: number };

export function onboardingRecapEmailSubject(locale: Locale, brandName: string, posts: number): string {
  return tEmail(locale, 'recap.subject', { brand: brandName, count: posts });
}

export function onboardingRecapEmailHtml(
  locale: Locale,
  brandName: string,
  counts: RecapCounts,
  continueUrl: string,
  preview: PreviewPost[],
  origin?: string
): string {
  const items = preview.map(postRow).join('');
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'recap.heading', { brand: brandName })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 18px;">${tEmail(locale, 'recap.intro', { posts: counts.posts, competitors: counts.competitors, weeks: counts.weeks })}</p>
    ${items}
    ${cta(continueUrl, tEmail(locale, 'recap.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'recap.footer')}</p>`
  );
}

export function onboardingRecapEmailText(
  locale: Locale,
  brandName: string,
  counts: RecapCounts,
  continueUrl: string,
  preview: PreviewPost[]
): string {
  const lines = preview.map((p) => `- ${(p.platform ?? '').toUpperCase()}: ${(p.caption ?? '').slice(0, 140)}`).join('\n');
  return [
    tEmail(locale, 'recap.heading', { brand: brandName }),
    '',
    tEmail(locale, 'recap.intro', { posts: counts.posts, competitors: counts.competitors, weeks: counts.weeks }),
    '',
    lines,
    '',
    `${tEmail(locale, 'recap.cta')} ${continueUrl}`,
    '',
    tEmail(locale, 'recap.footer')
  ].join('\n');
}

// Sent once when onboarding research finishes (strategy report + proposed editorial plan). Users can
// leave the long market-study step; this email is how they learn it's ready to review.
export function strategyPlanReadyEmailSubject(locale: Locale, brandName: string): string {
  return tEmail(locale, 'strategy_plan.subject', { brand: brandName });
}

export function strategyPlanReadyEmailHtml(
  locale: Locale,
  brandName: string,
  weeks: number,
  continueUrl: string,
  origin?: string
): string {
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'strategy_plan.heading')}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 18px;">${tEmail(locale, 'strategy_plan.intro', { brand: brandName, weeks })}</p>
    ${cta(continueUrl, tEmail(locale, 'strategy_plan.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'strategy_plan.footer')}</p>`
  );
}

export function strategyPlanReadyEmailText(
  locale: Locale,
  brandName: string,
  weeks: number,
  continueUrl: string
): string {
  return [
    tEmail(locale, 'strategy_plan.heading'),
    '',
    tEmail(locale, 'strategy_plan.intro', { brand: brandName, weeks }),
    '',
    `${tEmail(locale, 'strategy_plan.cta')} ${continueUrl}`,
    '',
    tEmail(locale, 'strategy_plan.footer')
  ].join('\n');
}

// Recurring-autopilot variant of the approval email. Same one-tap flow and signed token as
// approvalEmailHtml (stateless — the token IS the authorization, no DB row, 3-day expiry), so
// /approve/[token] handles it identically. Only the copy changes: this batch came from the
// recurring planner running on the brand's cadence, not a one-off click. We keep no per-post
// preview here because the recurring email is unsolicited (cron-triggered) and we want it short;
// the owner reviews details on the Approvals page if they don't trust the one-tap link.
export function schedulerEmailSubject(locale: Locale, brandName: string, count: number): string {
  return tEmail(locale, 'scheduler.subject', { brand: brandName, count });
}

export function schedulerApprovalEmailHtml(
  locale: Locale,
  brandName: string,
  count: number,
  approveUrl: string,
  origin?: string
): string {
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'scheduler.heading', { brand: brandName, count })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 16px;">${tEmail(locale, 'scheduler.intro', { count })}</p>
    ${cta(approveUrl, tEmail(locale, 'scheduler.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'scheduler.footer')}</p>`
  );
}

export function schedulerApprovalEmailText(locale: Locale, brandName: string, count: number, approveUrl: string): string {
  return [
    tEmail(locale, 'scheduler.heading', { brand: brandName, count }),
    '',
    tEmail(locale, 'scheduler.intro', { count }),
    '',
    `${tEmail(locale, 'scheduler.cta')} ${approveUrl}`,
    '',
    tEmail(locale, 'scheduler.footer')
  ].join('\n');
}

// ── Brand invite email ──────────────────────────────────────────────────────
// Sent when an owner shares a brand from Settings → Team. The link lands on the
// invitee's /app?view=invites section, where the accept happens behind their login
// (the invite is matched to their account email, so the email itself carries no secret).

export function brandInviteEmailSubject(locale: Locale, brandName: string, inviter: string): string {
  return tEmail(locale, 'invite.subject', { brand: brandName, inviter });
}

export function brandInviteEmailHtml(locale: Locale, brandName: string, inviter: string, toEmail: string, acceptUrl: string, origin?: string): string {
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'invite.heading', { brand: esc(brandName) })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 18px;">${tEmail(locale, 'invite.intro', { brand: esc(brandName), inviter: esc(inviter) })}</p>
    ${cta(acceptUrl, tEmail(locale, 'invite.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'invite.footer', { email: esc(toEmail) })}</p>`
  );
}

export function brandInviteEmailText(locale: Locale, brandName: string, inviter: string, toEmail: string, acceptUrl: string): string {
  return [
    tEmail(locale, 'invite.heading', { brand: brandName }),
    '',
    tEmail(locale, 'invite.intro', { brand: brandName, inviter }),
    '',
    `${tEmail(locale, 'invite.cta')} ${acceptUrl}`,
    '',
    tEmail(locale, 'invite.footer', { email: toEmail })
  ].join('\n');
}

// ── Calendar conflict email ─────────────────────────────────────────────────
// Sent when the brand's calendar has 2+ posts double-booked on the same minute. Nudges the user to
// let the AI rebalance the schedule. CTA lands on the calendar, whose banner opens the AI chat.

export function calendarConflictEmailSubject(locale: Locale, brandName: string, count: number): string {
  return tEmail(locale, 'conflict.subject', { brand: brandName, count });
}

export function calendarConflictEmailHtml(locale: Locale, brandName: string, count: number, calendarUrl: string, origin?: string): string {
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'conflict.heading', { brand: brandName, count })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 16px;">${tEmail(locale, 'conflict.intro', { count })}</p>
    ${cta(calendarUrl, tEmail(locale, 'conflict.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'conflict.footer')}</p>`
  );
}

export function calendarConflictEmailText(locale: Locale, brandName: string, count: number, calendarUrl: string): string {
  return [
    tEmail(locale, 'conflict.heading', { brand: brandName, count }),
    '',
    tEmail(locale, 'conflict.intro', { count }),
    '',
    `${tEmail(locale, 'conflict.cta')} ${calendarUrl}`,
    '',
    tEmail(locale, 'conflict.footer')
  ].join('\n');
}

// ── Weekly recap email ──────────────────────────────────────────────────────
// Sent every Monday morning with the brand's weekly performance snapshot: post activity,
// engagement metrics, trends, AI suggestions, and action items. The richest email Anomalia sends.

export type RecapData = {
  brandName: string;
  brandSlug: string;
  weekLabel: string; // e.g. "16 giu – 23 giu"
  postsPublished: number;
  postsPending: number;
  postsScheduled: number;
  totalEngagement: number; // likes + comments + shares
  totalImpressions: number; // reach / views (from Zernio + scrapecreators)
  totalSaves: number;
  engagementDeltaPct: number | null;
  // Previous week numbers (0 when no data)
  prevEngagement: number;
  prevImpressions: number;
  prevPosts: number;
  topPostCaption: string | null;
  topPostPlatform: string | null;
  platformStats: { platform: string; posts: number; engagement: number }[];
  trends: { topic: string; relevance: string; sourceUrl?: string; imageUrl?: string }[];
  suggestions: { type: string; message: string }[];
  actionItems: { label: string; url?: string }[];
  dashboardUrl: string;
  connectedAccounts: { platform: string; username: string | null }[];
  /** Organic-growth remediation — null/empty when brand data is complete. */
  growth: {
    ready: boolean;
    blockingCount: number;
    warningCount: number;
    fixes: { key: string; blocking: boolean; url?: string }[];
  } | null;
  /** Click path (post → traffico misurabile): post_links clicks (redirect + landing) in the
   *  last 7 days. Optional — the section renders only when present and > 0. */
  linkClicks?: number;
  /** Visual insights (P2 learning loop): top buckets vs the brand mean, best |delta| first.
   *  Optional — the section renders (3 rows max) only when present. */
  visualInsights?: { dimension: string; value: string; n: number; erAvg: number; delta: number }[];
  /** Web/rank KPIs (P4): tracked keywords and their movement. Optional — the section renders
   *  only when present and tracked > 0. */
  webKpis?: { tracked: number; improved: number; worsened: number; improvedList: string[] };
};

function sectionTitle(text: string): string {
  return `<h3 style="font-size:14px;font-weight:700;color:#1d1d1f;margin:24px 0 10px;letter-spacing:0.02em;text-transform:uppercase;">${esc(text)}</h3>`;
}

function statBlock(label: string, value: string | number, subtext?: string): string {
  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;color:#86868b;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:2px;">${esc(label)}</div>
    <div style="font-size:28px;font-weight:700;color:#1d1d1f;line-height:1;">${esc(String(value))}</div>
    ${subtext ? `<div style="font-size:12px;color:#6e6e73;margin-top:3px;">${esc(subtext)}</div>` : ''}
  </div>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #e3e3e6;margin:18px 0;" />`;
}

function recapPlatformRow(platform: string, posts: number, engagement: number): string {
  return `<tr>
    <td style="padding:8px 0;font-size:13px;font-weight:600;text-transform:capitalize;">${esc(platform)}</td>
    <td style="padding:8px 0;font-size:13px;color:#6e6e73;text-align:center;">${posts} post</td>
    <td style="padding:8px 0;font-size:13px;color:#1d1d1f;text-align:right;font-weight:600;">${engagement} eng</td>
  </tr>`;
}

function recapTrendRow(topic: string, relevance: string, sourceUrl?: string, imageUrl?: string): string {
  const imageHtml = imageUrl
    ? `<div style="margin-top:10px;"><img src="${esc(imageUrl)}" alt="" style="width:100%;max-width:480px;height:auto;border-radius:8px;display:block;" /></div>`
    : '';
  let sourceHtml = '';
  if (sourceUrl) {
    try {
      const domain = new URL(sourceUrl).hostname;
      sourceHtml = `<div style="margin-top:6px;">
        <a href="${esc(sourceUrl)}" style="font-size:11px;color:${ACCENT};text-decoration:none;" target="_blank" rel="noopener">${esc(domain)} ↗</a>
      </div>`;
    } catch {
      sourceHtml = `<div style="margin-top:6px;"><a href="${esc(sourceUrl)}" style="font-size:11px;color:${ACCENT};text-decoration:none;" target="_blank" rel="noopener">Fonte ↗</a></div>`;
    }
  }
  return `<div style="margin-bottom:12px;padding:10px 14px;background:#f9f9fb;border-radius:8px;">
    <div style="font-size:13px;font-weight:600;color:#1d1d1f;">${esc(topic)}</div>
    <div style="font-size:12px;color:#6e6e73;line-height:1.4;margin-top:3px;">${esc(relevance)}</div>
    ${imageHtml}
    ${sourceHtml}
  </div>`;
}

function recapSuggestionRow(message: string, idx: number): string {
  return `<div style="margin-bottom:10px;padding:10px 14px;background:#f5f3ff;border-radius:8px;border-left:3px solid ${ACCENT};">
    <div style="font-size:13px;color:#1d1d1f;line-height:1.5;">${esc(message)}</div>
  </div>`;
}

function recapActionRow(label: string, url?: string): string {
  const text = esc(label);
  return url
    ? `<div style="margin-bottom:8px;font-size:13px;"><a href="${esc(url)}" style="color:${ACCENT};text-decoration:none;font-weight:600;">→ ${text}</a></div>`
    : `<div style="margin-bottom:8px;font-size:13px;color:#1d1d1f;">• ${text}</div>`;
}

// Visual insights (P2): one line per bucket, 3 rows max. Renders nothing when absent.
function visualInsightsSectionHtml(locale: Locale, data: RecapData): string {
  const rows = [...(data.visualInsights ?? [])]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  if (!rows.length) return '';
  const items = rows
    .map((r) => {
      const d = Math.round(r.delta);
      return `<div style="font-size:13px;color:#1d1d1f;line-height:1.5;margin-bottom:6px;">${esc(r.dimension)}: ${esc(r.value)} ${d > 0 ? '+' : ''}${d}% ER vs avg (n=${r.n})</div>`;
    })
    .join('');
  return `${sectionTitle(tEmail(locale, 'recap_weekly.visual_insights'))}${items}`;
}

// Web/rank KPIs (P4): tracked/improved/worsened + top improved keywords. Renders nothing when
// the brand tracks no keywords or has no rank data.
function webKpisSectionHtml(locale: Locale, data: RecapData): string {
  const k = data.webKpis;
  if (!k || k.tracked <= 0) return '';
  const top = k.improvedList.length
    ? `<div style="margin-top:8px;">
        <div style="font-size:11px;color:#86868b;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px;">${tEmail(locale, 'recap_weekly.webkpis.top_movers')}</div>
        ${k.improvedList.map((kw) => `<div style="font-size:13px;color:#16a34a;line-height:1.5;">▲ ${esc(kw)}</div>`).join('')}
      </div>`
    : '';
  return `${sectionTitle(tEmail(locale, 'recap_weekly.webkpis.title'))}
    <div style="font-size:14px;font-weight:600;color:#1d1d1f;">${esc(tEmail(locale, 'recap_weekly.webkpis.summary', { tracked: k.tracked, improved: k.improved, worsened: k.worsened }))}</div>
    ${top}`;
}

function growthSectionHtml(locale: Locale, data: RecapData): string {
  const g = data.growth;
  if (!g || (!g.blockingCount && !g.warningCount)) return '';
  const status = g.blockingCount
    ? tEmail(locale, 'recap_weekly.growth.blocked', { n: g.blockingCount })
    : tEmail(locale, 'recap_weekly.growth.warn', { n: g.warningCount });
  const lede = g.blockingCount
    ? tEmail(locale, 'recap_weekly.growth.lede_blocked')
    : tEmail(locale, 'recap_weekly.growth.lede_warn');
  const bg = g.blockingCount ? '#fff8f0' : '#f8fafc';
  const border = g.blockingCount ? '#fde68a' : '#e2e8f0';
  const titleColor = g.blockingCount ? '#92400e' : '#334155';
  const rows = g.fixes
    .map((f) => {
      const label = tEmail(locale, `recap_weekly.growth.check.${f.key}`);
      const link = f.url
        ? `<a href="${esc(f.url)}" style="color:${ACCENT};text-decoration:none;font-weight:600;white-space:nowrap;">${tEmail(locale, 'recap_weekly.growth.fix')}</a>`
        : '';
      const badge = f.blocking
        ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#b45309;margin-right:6px;">${tEmail(locale, 'recap_weekly.growth.required')}</span>`
        : '';
      return `<div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:8px 0;border-top:1px solid ${border};font-size:13px;color:#1d1d1f;line-height:1.4;">
        <div>${badge}${esc(label)}</div>
        ${link}
      </div>`;
    })
    .join('');
  return `${sectionTitle(tEmail(locale, 'recap_weekly.growth.title'))}
    <div style="padding:14px 16px;background:${bg};border-radius:10px;border:1px solid ${border};margin:0 0 8px;">
      <div style="font-size:13px;font-weight:700;color:${titleColor};">${esc(status)}</div>
      <div style="font-size:12px;color:${titleColor};margin-top:4px;line-height:1.5;">${esc(lede)}</div>
      <div style="margin-top:8px;">${rows}</div>
    </div>`;
}

function accountBadge(platform: string, username: string | null): string {
  return `<span style="display:inline-block;background:#f0f0f3;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;color:#1d1d1f;margin:0 4px 4px 0;">${esc(platform)}${username ? ` @${esc(username)}` : ''}</span>`;
}

export function weeklyRecapEmailSubject(locale: Locale, brandName: string, weekLabel: string): string {
  return tEmail(locale, 'recap_weekly.subject', { brand: brandName, week: weekLabel });
}

export function weeklyRecapEmailHtml(locale: Locale, data: RecapData, origin?: string): string {
  const delta = data.engagementDeltaPct;
  const deltaText = delta !== null
    ? (delta >= 0 ? `+${delta}%` : `${delta}%`)
    : null;
  const deltaColor = delta !== null ? (delta >= 0 ? '#16a34a' : '#dc2626') : '#86868b';

  const platformRows = data.platformStats.map((p) => recapPlatformRow(p.platform, p.posts, p.engagement)).join('');
  const trendRows = data.trends.map((t) => recapTrendRow(t.topic, t.relevance, t.sourceUrl, t.imageUrl)).join('');
  const suggestionRows = data.suggestions.map((s, i) => recapSuggestionRow(s.message, i)).join('');
  const actionRows = data.actionItems.map((a) => recapActionRow(a.label, a.url)).join('');
  const accountBadges = data.connectedAccounts.map((a) => accountBadge(a.platform, a.username)).join('');

  // Social accounts section
  const accountsSection = data.connectedAccounts.length > 0
    ? `${sectionTitle(tEmail(locale, 'recap_weekly.connected_accounts'))}
       <div style="margin-bottom:8px;">${accountBadges}</div>
       <p style="font-size:12px;color:#6e6e73;margin:4px 0 0;">${tEmail(locale, 'recap_weekly.accounts_note')}</p>`
    : `<div style="padding:14px 16px;background:#fff8f0;border-radius:10px;border:1px solid #fde68a;margin:16px 0;">
        <div style="font-size:13px;font-weight:600;color:#92400e;">${tEmail(locale, 'recap_weekly.no_accounts_title')}</div>
        <div style="font-size:12px;color:#92400e;margin-top:4px;line-height:1.5;">${tEmail(locale, 'recap_weekly.no_accounts_desc')}</div>
       </div>`;

  // Top post
  const topPostSection = data.topPostCaption
    ? `${sectionTitle(tEmail(locale, 'recap_weekly.top_post'))}
       <div style="padding:12px 16px;background:#f9f9fb;border-radius:10px;">
        <div style="font-size:11px;color:#86868b;font-weight:600;letter-spacing:0.04em;margin-bottom:4px;">${(data.topPostPlatform ?? '').toUpperCase()}</div>
        <div style="font-size:13px;color:#1d1d1f;line-height:1.5;">${esc((data.topPostCaption ?? '').slice(0, 280))}</div>
       </div>`
    : '';

  // Trends
  const trendsSection = trendRows
    ? `${sectionTitle(tEmail(locale, 'recap_weekly.trends'))}${trendRows}`
    : '';

  // Suggestions
  const suggestionsSection = suggestionRows
    ? `${sectionTitle(tEmail(locale, 'recap_weekly.suggestions'))}${suggestionRows}`
    : '';

  // Actions
  const actionsSection = actionRows
    ? `${sectionTitle(tEmail(locale, 'recap_weekly.actions'))}${actionRows}`
    : '';

  // Previous week comparison line
  const comparisonLine = deltaText
    ? `<div style="font-size:13px;color:${deltaColor};font-weight:600;margin-top:6px;">${tEmail(locale, 'recap_weekly.delta_label')}: ${deltaText}</div>`
    : `<div style="font-size:12px;color:#86868b;margin-top:6px;">${tEmail(locale, 'recap_weekly.no_prev_data')}</div>`;

  // Prev week subtexts
  const engSubtext = data.prevEngagement > 0
    ? `${tEmail(locale, 'recap_weekly.prev_week')}: ${data.prevEngagement}`
    : undefined;
  const impSubtext = data.prevImpressions > 0
    ? `${tEmail(locale, 'recap_weekly.prev_week')}: ${data.prevImpressions}`
    : undefined;

  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 4px;">${tEmail(locale, 'recap_weekly.heading', { brand: data.brandName })}</h2>
    <p style="color:#86868b;font-size:14px;margin:0 0 24px;">${tEmail(locale, 'recap_weekly.subheading', { week: data.weekLabel })}</p>

    ${accountsSection}

    ${growthSectionHtml(locale, data)}

    ${divider()}
    ${sectionTitle(tEmail(locale, 'recap_weekly.stats_title'))}

    ${statBlock(tEmail(locale, 'recap_weekly.stat_published'), data.postsPublished, data.postsScheduled > 0 ? `${data.postsScheduled} ${tEmail(locale, 'recap_weekly.scheduled')}` : undefined)}
    ${statBlock(tEmail(locale, 'recap_weekly.stat_engagement'), data.totalEngagement, engSubtext)}
    ${statBlock(tEmail(locale, 'recap_weekly.stat_impressions'), data.totalImpressions, impSubtext)}
    ${data.totalSaves > 0 ? statBlock(tEmail(locale, 'recap_weekly.saves'), data.totalSaves) : ''}
    ${(data.linkClicks ?? 0) > 0 ? statBlock(tEmail(locale, 'recap_weekly.stat_link_clicks'), data.linkClicks!) : ''}
    ${comparisonLine}

    ${visualInsightsSectionHtml(locale, data)}
    ${webKpisSectionHtml(locale, data)}

    ${data.postsPending > 0 ? `<div style="margin-top:12px;padding:10px 14px;background:#fff8f0;border-radius:8px;border:1px solid #fde68a;font-size:13px;color:#92400e;font-weight:600;">${tEmail(locale, 'recap_weekly.pending_posts', { count: data.postsPending })}</div>` : ''}

    ${topPostSection}

    ${platformRows ? `
    ${divider()}
    ${sectionTitle(tEmail(locale, 'recap_weekly.by_platform'))}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      ${platformRows}
    </table>` : ''}

    ${trendsSection}
    ${suggestionsSection}
    ${actionsSection}

    ${divider()}
    <div style="margin-top:20px;text-align:center;">
      ${cta(data.dashboardUrl, tEmail(locale, 'recap_weekly.cta'))}
    </div>
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'recap_weekly.footer')}</p>`
  );
}

export function weeklyRecapEmailText(locale: Locale, data: RecapData): string {
  const delta = data.engagementDeltaPct;
  const deltaText = delta !== null ? (delta >= 0 ? `+${delta}%` : `${delta}%`) : tEmail(locale, 'recap_weekly.no_prev_data');

  const lines = [
    tEmail(locale, 'recap_weekly.heading', { brand: data.brandName }),
    tEmail(locale, 'recap_weekly.subheading', { week: data.weekLabel }),
    ''
  ];

  if (data.connectedAccounts.length) {
    lines.push(tEmail(locale, 'recap_weekly.connected_accounts'));
    lines.push(data.connectedAccounts.map((a) => `${a.platform}${a.username ? ` @${a.username}` : ''}`).join(', '));
    lines.push('');
  } else {
    lines.push(tEmail(locale, 'recap_weekly.no_accounts_title'));
    lines.push(tEmail(locale, 'recap_weekly.no_accounts_desc'));
    lines.push('');
  }

  if (data.growth && (data.growth.blockingCount || data.growth.warningCount)) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.growth.title')} —`);
    lines.push(
      data.growth.blockingCount
        ? tEmail(locale, 'recap_weekly.growth.blocked', { n: data.growth.blockingCount })
        : tEmail(locale, 'recap_weekly.growth.warn', { n: data.growth.warningCount })
    );
    lines.push(
      data.growth.blockingCount
        ? tEmail(locale, 'recap_weekly.growth.lede_blocked')
        : tEmail(locale, 'recap_weekly.growth.lede_warn')
    );
    for (const f of data.growth.fixes) {
      const label = tEmail(locale, `recap_weekly.growth.check.${f.key}`);
      const tag = f.blocking ? `[${tEmail(locale, 'recap_weekly.growth.required')}] ` : '';
      lines.push(`  → ${tag}${label}${f.url ? ` ${f.url}` : ''}`);
    }
    lines.push('');
  }

  lines.push(`— ${tEmail(locale, 'recap_weekly.stats_title')} —`);
  lines.push(`${tEmail(locale, 'recap_weekly.stat_published')}: ${data.postsPublished}${data.postsScheduled > 0 ? ` (${data.postsScheduled} ${tEmail(locale, 'recap_weekly.scheduled')})` : ''}`);
  lines.push(`${tEmail(locale, 'recap_weekly.stat_engagement')}: ${data.totalEngagement}${data.prevEngagement > 0 ? ` (${tEmail(locale, 'recap_weekly.prev_week')}: ${data.prevEngagement})` : ''}`);
  lines.push(`${tEmail(locale, 'recap_weekly.stat_impressions')}: ${data.totalImpressions}${data.prevImpressions > 0 ? ` (${tEmail(locale, 'recap_weekly.prev_week')}: ${data.prevImpressions})` : ''}`);
  if (data.totalSaves > 0) lines.push(`${tEmail(locale, 'recap_weekly.saves')}: ${data.totalSaves}`);
  if ((data.linkClicks ?? 0) > 0) lines.push(`${tEmail(locale, 'recap_weekly.stat_link_clicks')}: ${data.linkClicks}`);
  lines.push(`${tEmail(locale, 'recap_weekly.delta_label')}: ${deltaText}`);
  if (data.postsPending > 0) lines.push(`⚠ ${tEmail(locale, 'recap_weekly.pending_posts', { count: data.postsPending })}`);
  lines.push('');

  if (data.visualInsights?.length) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.visual_insights')} —`);
    for (const v of [...data.visualInsights].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3)) {
      const d = Math.round(v.delta);
      lines.push(`  ${v.dimension}: ${v.value} ${d > 0 ? '+' : ''}${d}% ER vs avg (n=${v.n})`);
    }
    lines.push('');
  }

  if (data.webKpis && data.webKpis.tracked > 0) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.webkpis.title')} —`);
    lines.push(`  ${tEmail(locale, 'recap_weekly.webkpis.summary', { tracked: data.webKpis.tracked, improved: data.webKpis.improved, worsened: data.webKpis.worsened })}`);
    if (data.webKpis.improvedList.length) {
      lines.push(`  ${tEmail(locale, 'recap_weekly.webkpis.top_movers')}: ${data.webKpis.improvedList.join(', ')}`);
    }
    lines.push('');
  }

  if (data.topPostCaption) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.top_post')} (${data.topPostPlatform}) —`);
    lines.push(data.topPostCaption.slice(0, 200));
    lines.push('');
  }

  if (data.platformStats.length) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.by_platform')} —`);
    for (const p of data.platformStats) {
      lines.push(`  ${p.platform}: ${p.posts} post, ${p.engagement} eng`);
    }
    lines.push('');
  }

  if (data.trends.length) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.trends')} —`);
    for (const t of data.trends) {
      lines.push(`  • ${t.topic}: ${t.relevance}`);
    }
    lines.push('');
  }

  if (data.suggestions.length) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.suggestions')} —`);
    for (const s of data.suggestions) {
      lines.push(`  • ${s.message}`);
    }
    lines.push('');
  }

  if (data.actionItems.length) {
    lines.push(`— ${tEmail(locale, 'recap_weekly.actions')} —`);
    for (const a of data.actionItems) {
      lines.push(`  → ${a.label}${a.url ? ` ${a.url}` : ''}`);
    }
    lines.push('');
  }

  lines.push(`${tEmail(locale, 'recap_weekly.cta')} ${data.dashboardUrl}`, '', tEmail(locale, 'recap_weekly.footer'));
  return lines.join('\n');
}

// ── Daily digest email ────────────────────────────────────────────────────────
// Sent every morning (08:00 UTC cron) with what went live the previous UTC day: one row per
// published post — platform, truncated caption, thumbnail, link to the post itself (or the
// brand calendar when no per-post URL exists). Never sent when nothing was published, so a
// quiet day produces zero noise.

export type DigestPost = {
  id?: string;
  platform: string | null;
  caption: string | null;
  media_url?: string | null;
  published_url?: string | null;
  slot?: string | null;
};

export function digestEmailSubject(locale: Locale, brandName: string, count: number): string {
  return tEmail(locale, 'digest.subject', { brand: brandName, count });
}

// One digest post: thumbnail (when present) beside the platform + caption, the whole row linking
// to the live post or, as a fallback, the brand calendar.
function digestPostRow(p: DigestPost, fallbackUrl: string): string {
  const platform = esc((p.platform ?? '').toUpperCase());
  const caption = esc((p.caption ?? '').slice(0, 160)) || platform;
  const href = esc(p.published_url || fallbackUrl);
  const thumb = p.media_url
    ? `<td width="68" valign="top" style="padding:0 12px 0 0;"><a href="${href}"><img src="${esc(p.media_url)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid #e3e3e6;" /></a></td>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 14px;"><tr>${thumb}<td valign="top" style="font-size:14px;line-height:1.45;color:#1d1d1f;"><div style="color:#86868b;font-size:11px;font-weight:600;letter-spacing:0.04em;margin-bottom:3px;">${platform}</div><a href="${href}" style="color:#1d1d1f;text-decoration:none;">${caption}</a></td></tr></table>`;
}

export function digestEmailHtml(
  locale: Locale,
  brand: { name: string; slug: string },
  posts: DigestPost[],
  origin?: string
): string {
  const calendarUrl = `${siteUrl(origin)}/app/${brand.slug}/calendar`;
  const items = posts.map((p) => digestPostRow(p, calendarUrl)).join('');
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'digest.heading', { brand: esc(brand.name), count: posts.length })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 18px;">${tEmail(locale, 'digest.intro', { brand: esc(brand.name) })}</p>
    ${items}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'digest.footer')}</p>`
  );
}

export function digestEmailText(
  locale: Locale,
  brand: { name: string; slug: string },
  posts: DigestPost[]
): string {
  const calendarUrl = `${siteUrl()}/app/${brand.slug}/calendar`;
  const lines = posts.map((p) => {
    const url = p.published_url || calendarUrl;
    return `- ${(p.platform ?? '').toUpperCase()}: ${(p.caption ?? '').slice(0, 160)} (${url})`;
  });
  return [
    tEmail(locale, 'digest.heading', { brand: brand.name, count: posts.length }),
    '',
    tEmail(locale, 'digest.intro', { brand: brand.name }),
    '',
    lines.join('\n'),
    '',
    tEmail(locale, 'digest.footer')
  ].join('\n');
}

// ── Pre-publish hold (last-mile gate pulled a scheduled post back) ─────────────

export type PrepublishHeldPost = {
  platform: string | null;
  caption: string | null;
  media_url?: string | null;
  reason: string;
};

export function prepublishHeldEmailSubject(locale: Locale, brandName: string, count: number): string {
  return tEmail(locale, 'prepublish.subject', { brand: brandName, count });
}

export function prepublishHeldEmailHtml(
  locale: Locale,
  brand: { name: string; slug: string },
  posts: PrepublishHeldPost[],
  contentUrl: string,
  origin?: string
): string {
  const items = posts
    .map((p) => {
      const row = postRow(p);
      const reason = `<div style="color:#86868b;font-size:12px;margin:-8px 0 14px;">${esc(tEmail(locale, 'prepublish.reason', { reason: p.reason }))}</div>`;
      return row + reason;
    })
    .join('');
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'prepublish.heading', { brand: esc(brand.name), count: posts.length })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 18px;">${tEmail(locale, 'prepublish.intro')}</p>
    ${items}
    ${cta(contentUrl, tEmail(locale, 'prepublish.cta'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'prepublish.footer')}</p>`
  );
}

export function prepublishHeldEmailText(
  locale: Locale,
  brand: { name: string; slug: string },
  posts: Array<{ platform: string | null; caption: string | null; reason: string }>,
  contentUrl: string
): string {
  const lines = posts.map(
    (p) =>
      `- ${(p.platform ?? '').toUpperCase()}: ${(p.caption ?? '').slice(0, 160)}\n  ${tEmail(locale, 'prepublish.reason', { reason: p.reason })}`
  );
  return [
    tEmail(locale, 'prepublish.heading', { brand: brand.name, count: posts.length }),
    '',
    tEmail(locale, 'prepublish.intro'),
    '',
    lines.join('\n'),
    '',
    `${tEmail(locale, 'prepublish.cta')} ${contentUrl}`,
    '',
    tEmail(locale, 'prepublish.footer')
  ].join('\n');
}

// ── Credit warning email ───────────────────────────────────────────────────────

export function creditWarningEmailSubject(locale: Locale, brandName: string, percent: number): string {
  return tEmail(locale, 'credit_warning.subject', { brand: brandName, percent });
}

export function creditWarningEmailHtml(locale: Locale, opts: {
  percent: number; used: number; quota: number;
  resetDate: Date; brandName: string; dashboardUrl: string;
}): string {
  const resetStr = opts.resetDate.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-US', { day: 'numeric', month: 'long' });
  return shell(undefined, `
    <h2 style="font-size:18px;font-weight:600;margin:0 0 12px;">${tEmail(locale, 'credit_warning.heading')}</h2>
    <p style="font-size:15px;line-height:1.5;color:#1d1d1f;margin:0 0 16px;">
      ${tEmail(locale, 'credit_warning.intro', {
        brand: esc(opts.brandName),
        used: opts.used.toLocaleString(),
        quota: opts.quota.toLocaleString(),
        percent: opts.percent,
        resetDate: resetStr
      })}
    </p>
    <div style="background:#f5f5f7;border-radius:10px;padding:16px;margin:0 0 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:13px;color:#86868b;">${tEmail(locale, 'credit_warning.heading')}</span>
        <span style="font-size:14px;font-weight:600;">${opts.used.toLocaleString()} / ${opts.quota.toLocaleString()}</span>
      </div>
      <div style="background:#e5e5ea;border-radius:4px;height:8px;overflow:hidden;">
        <div style="background:${opts.percent >= 80 ? '#dc2626' : opts.percent >= 60 ? '#f59e0b' : '#16a34a'};height:100%;width:${Math.min(100, opts.percent)}%;border-radius:4px;"></div>
      </div>
    </div>
    ${cta(opts.dashboardUrl, tEmail(locale, 'credit_warning.cta'))}
    <p style="font-size:12px;color:#86868b;margin:16px 0 0;">${tEmail(locale, 'credit_warning.footer')}</p>
  `);
}

export function creditWarningEmailText(locale: Locale, opts: {
  percent: number; used: number; quota: number;
  resetDate: Date; brandName: string; dashboardUrl: string;
}): string {
  const resetStr = opts.resetDate.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-US', { day: 'numeric', month: 'long' });
  return [
    tEmail(locale, 'credit_warning.heading'),
    '',
    tEmail(locale, 'credit_warning.intro', {
      brand: opts.brandName,
      used: opts.used.toLocaleString(),
      quota: opts.quota.toLocaleString(),
      percent: opts.percent,
      resetDate: resetStr
    }),
    '',
    `${opts.used.toLocaleString()} / ${opts.quota.toLocaleString()} (${opts.percent}%)`,
    '',
    `${tEmail(locale, 'credit_warning.cta')} ${opts.dashboardUrl}`,
    '',
    tEmail(locale, 'credit_warning.footer')
  ].join('\n');
}

// ── Lifecycle drip ───────────────────────────────────────────────────────────────────────────
// Welcome (T+0), day-1 call-insist, and day-2/3 next-step nudges. Sent by api/v1/lifecycle/tick.
// The 6 welcome "next steps" mirror the in-app OnboardingChecklist (sidebar progress).
const WELCOME_STEPS: { key: string; path: string }[] = [
  { key: 'studio', path: 'studio' },
  { key: 'strategy', path: 'gtm' },
  { key: 'plan', path: 'plan' },
  { key: 'blog', path: 'site' },
  { key: 'radar', path: 'radar' },
  { key: 'seo', path: 'seo' }
];

export function welcomeEmailSubject(locale: Locale, brandName: string): string {
  return tEmail(locale, 'welcome.subject', { brand: brandName });
}

export function welcomeEmailHtml(
  locale: Locale,
  opts: { name: string; brandName: string; brandSlug: string; callUrl: string },
  origin?: string
): string {
  const base = `${siteUrl(origin)}/app/${opts.brandSlug}`;
  const steps = WELCOME_STEPS.map(
    (s) =>
      `<li style="margin:0 0 8px;"><a href="${base}/${s.path}" style="color:#7c5cff;text-decoration:none;">${tEmail(locale, `welcome.step.${s.key}`)}</a></li>`
  ).join('');
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'welcome.heading', { name: esc(opts.name) })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 14px;">${tEmail(locale, 'welcome.intro', { brand: esc(opts.brandName) })}</p>
    <p style="color:#1d1d1f;line-height:1.5;margin:0 0 14px;">${tEmail(locale, 'welcome.call_lead')}</p>
    ${cta(opts.callUrl, tEmail(locale, 'welcome.cta'))}
    <p style="color:#1d1d1f;font-weight:600;margin:22px 0 8px;">${tEmail(locale, 'welcome.steps_title', { brand: esc(opts.brandName) })}</p>
    <ol style="color:#1d1d1f;font-size:14px;line-height:1.5;padding-left:20px;margin:0 0 18px;">${steps}</ol>
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'welcome.footer')}</p>`
  );
}

export function welcomeEmailText(
  locale: Locale,
  opts: { name: string; brandName: string; brandSlug: string; callUrl: string },
  origin?: string
): string {
  const base = `${siteUrl(origin)}/app/${opts.brandSlug}`;
  const steps = WELCOME_STEPS.map((s, i) => `${i + 1}. ${tEmail(locale, `welcome.step.${s.key}`)} — ${base}/${s.path}`).join('\n');
  return [
    tEmail(locale, 'welcome.heading', { name: opts.name }),
    '',
    tEmail(locale, 'welcome.intro', { brand: opts.brandName }),
    '',
    tEmail(locale, 'welcome.call_lead'),
    `${tEmail(locale, 'welcome.cta')} ${opts.callUrl}`,
    '',
    tEmail(locale, 'welcome.steps_title', { brand: opts.brandName }),
    steps,
    '',
    tEmail(locale, 'welcome.footer')
  ].join('\n');
}

export function day1EmailSubject(locale: Locale, name: string, brandName: string): string {
  return tEmail(locale, 'lifecycle.day1.subject', { name, brand: brandName });
}

export function day1EmailHtml(
  locale: Locale,
  opts: { name: string; brandName: string; brandSlug: string; callUrl: string },
  origin?: string
): string {
  const selfUrl = `${siteUrl(origin)}/app/${opts.brandSlug}/settings/brand`;
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'lifecycle.day1.heading', { brand: esc(opts.brandName) })}</h2>
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 14px;">${tEmail(locale, 'lifecycle.day1.intro', { brand: esc(opts.brandName) })}</p>
    <p style="color:#1d1d1f;line-height:1.5;margin:0 0 14px;">${tEmail(locale, 'lifecycle.day1.body')}</p>
    ${cta(opts.callUrl, tEmail(locale, 'lifecycle.cta_call'))}
    <p style="color:#6e6e73;font-size:13px;margin-top:18px;">${tEmail(locale, 'lifecycle.or_self')} <a href="${selfUrl}" style="color:#7c5cff;text-decoration:none;">${selfUrl}</a></p>
    <p style="color:#86868b;font-size:12px;margin-top:18px;">${tEmail(locale, 'lifecycle.footer')}</p>`
  );
}

export function day1EmailText(
  locale: Locale,
  opts: { name: string; brandName: string; brandSlug: string; callUrl: string },
  origin?: string
): string {
  const selfUrl = `${siteUrl(origin)}/app/${opts.brandSlug}/settings/brand`;
  return [
    tEmail(locale, 'lifecycle.day1.heading', { brand: opts.brandName }),
    '',
    tEmail(locale, 'lifecycle.day1.intro', { brand: opts.brandName }),
    '',
    tEmail(locale, 'lifecycle.day1.body'),
    `${tEmail(locale, 'lifecycle.cta_call')} ${opts.callUrl}`,
    '',
    `${tEmail(locale, 'lifecycle.or_self')} ${selfUrl}`,
    '',
    tEmail(locale, 'lifecycle.footer')
  ].join('\n');
}

/**
 * Chi si iscrive col prodotto chiuso non ha un brand, quindi il drip di lifecycle — che pende dai
 * brand — non lo vede mai. Senza questa, uno che si registra e non prenota non riceve nulla:
 * prodotto chiuso e recupero spento insieme.
 */
export function pendingEmailSubject(locale: Locale): string {
  return tEmail(locale, 'pending.subject');
}

export function pendingEmailHtml(locale: Locale, opts: { callUrl: string }, origin?: string): string {
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'pending.heading')}</h2>
    <p style="color:#1d1d1f;line-height:1.5;margin:0 0 14px;">${tEmail(locale, 'pending.body')}</p>
    ${cta(opts.callUrl, tEmail(locale, 'lifecycle.cta_call'))}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${tEmail(locale, 'lifecycle.footer')}</p>`
  );
}

export function pendingEmailText(locale: Locale, opts: { callUrl: string }): string {
  return [
    tEmail(locale, 'pending.heading'),
    '',
    tEmail(locale, 'pending.body'),
    `${tEmail(locale, 'lifecycle.cta_call')} ${opts.callUrl}`,
    '',
    tEmail(locale, 'lifecycle.footer')
  ].join('\n');
}

export function stepEmailSubject(locale: Locale, brandName: string, stage: Stage): string {
  return tEmail(locale, 'lifecycle.step.subject', { brand: brandName, step: tEmail(locale, `lifecycle.step.title.${stage}`) });
}

export function stepEmailHtml(
  locale: Locale,
  opts: { name: string; brandName: string; stage: Stage; stepUrl: string; callUrl: string; day: 2 | 3 },
  origin?: string
): string {
  const title = tEmail(locale, `lifecycle.step.title.${opts.stage}`);
  const line = tEmail(locale, `lifecycle.step.line.${opts.stage}`, { brand: esc(opts.brandName) });
  const day3 = opts.day === 3 ? `<p style="color:#1d1d1f;font-weight:600;margin:0 0 8px;">${tEmail(locale, 'lifecycle.step.intro_day3')}</p>` : '';
  return shell(
    origin,
    `
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:14px 0 6px;">${tEmail(locale, 'lifecycle.step.heading', { brand: esc(opts.brandName) })}</h2>
    ${day3}
    <p style="color:#6e6e73;line-height:1.5;margin:0 0 16px;">${line}</p>
    ${cta(opts.stepUrl, title)}
    <p style="color:#6e6e73;font-size:13px;margin-top:18px;">${tEmail(locale, 'lifecycle.step.or_call')} <a href="${opts.callUrl}" style="color:#7c5cff;text-decoration:none;">${tEmail(locale, 'lifecycle.step.cta_call')}</a></p>
    <p style="color:#86868b;font-size:12px;margin-top:18px;">${tEmail(locale, 'lifecycle.footer')}</p>`
  );
}

export function stepEmailText(
  locale: Locale,
  opts: { name: string; brandName: string; stage: Stage; stepUrl: string; callUrl: string; day: 2 | 3 },
  origin?: string
): string {
  const title = tEmail(locale, `lifecycle.step.title.${opts.stage}`);
  const line = tEmail(locale, `lifecycle.step.line.${opts.stage}`, { brand: opts.brandName });
  return [
    tEmail(locale, 'lifecycle.step.heading', { brand: opts.brandName }),
    '',
    opts.day === 3 ? tEmail(locale, 'lifecycle.step.intro_day3') + '\n' : '',
    line,
    '',
    `${title}: ${opts.stepUrl}`,
    '',
    `${tEmail(locale, 'lifecycle.step.or_call')} ${opts.callUrl}`,
    '',
    tEmail(locale, 'lifecycle.footer')
  ].join('\n');
}

// ── Agent notification (chat tool `notify_user`) ────────────────────────────────────────────────
// Il corpo lo scrive l'agente, non noi: qui c'è solo la cornice (intestazione, occhiello, CTA,
// piede) e la conversione da testo a HTML. Nessuna copy fissa oltre a quella, altrimenti ogni
// notifica suonerebbe uguale a prescindere da cosa è successo.

/** Massimo che accettiamo di rendere: oltre, l'agente doveva pubblicare un artefatto e linkarlo. */
const AGENT_BODY_MAX = 4000;

/**
 * Testo dell'agente → HTML dell'email.
 *
 * Escape PRIMA di qualunque altra cosa: quel testo è generato da un modello che ha appena letto
 * pagine web, documenti caricati e risposte di API, quindi va trattato come input non fidato anche
 * quando "lo ha scritto l'AI". Dopo l'escape riconosciamo solo tre forme: righe che iniziano con
 * "- " (elenco), **grassetto**, e URL http(s) nudi (resi cliccabili).
 */
function agentBodyHtml(body: string): string {
  const safe = esc(body.slice(0, AGENT_BODY_MAX).trim());
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // L'href riusa il testo già escapato: i client decodificano &amp; da soli, e così nessuna
      // virgoletta grezza può uscire dall'attributo.
      .replace(
        /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g,
        '<a href="$1" style="color:#7c5cff;text-decoration:none;">$1</a>'
      );

  const blocks: string[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      `<ul style="margin:0 0 14px;padding-left:20px;color:#1d1d1f;font-size:15px;line-height:1.55;">${bullets
        .map((b) => `<li style="margin:0 0 6px;">${inline(b)}</li>`)
        .join('')}</ul>`
    );
    bullets = [];
  };

  for (const raw of safe.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushBullets();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1] ?? '');
      continue;
    }
    flushBullets();
    blocks.push(
      `<p style="color:#1d1d1f;font-size:15px;line-height:1.55;margin:0 0 14px;">${inline(line)}</p>`
    );
  }
  flushBullets();
  return blocks.join('');
}

export function agentNotifyEmailSubject(locale: Locale, brandName: string, subject: string): string {
  return tEmail(locale, 'agent.subject', { brand: brandName, subject: subject.trim().slice(0, 120) });
}

export function agentNotifyEmailHtml(
  locale: Locale,
  opts: {
    brandName: string;
    /** Titolo dentro l'email — la stessa frase dell'oggetto, senza il prefisso del brand. */
    heading: string;
    body: string;
    ctaUrl?: string | null;
    ctaLabel?: string | null;
  },
  origin?: string
): string {
  const button = opts.ctaUrl
    ? cta(opts.ctaUrl, esc(opts.ctaLabel?.trim() || tEmail(locale, 'agent.cta')))
    : '';
  return shell(
    origin,
    `
    <div style="color:#86868b;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;margin:14px 0 4px;">${esc(
      tEmail(locale, 'agent.eyebrow', { brand: opts.brandName })
    )}</div>
    <h2 style="font-size:22px;letter-spacing:-0.02em;margin:0 0 12px;">${esc(opts.heading.trim())}</h2>
    ${agentBodyHtml(opts.body)}
    ${button}
    <p style="color:#86868b;font-size:12px;margin-top:22px;">${esc(
      tEmail(locale, 'agent.footer', { brand: opts.brandName })
    )}</p>`
  );
}

export function agentNotifyEmailText(
  locale: Locale,
  opts: { brandName: string; heading: string; body: string; ctaUrl?: string | null; ctaLabel?: string | null }
): string {
  const lines = [
    tEmail(locale, 'agent.eyebrow', { brand: opts.brandName }),
    '',
    opts.heading.trim(),
    '',
    opts.body.slice(0, AGENT_BODY_MAX).trim()
  ];
  if (opts.ctaUrl) {
    lines.push('', `${opts.ctaLabel?.trim() || tEmail(locale, 'agent.cta')} ${opts.ctaUrl}`);
  }
  lines.push('', tEmail(locale, 'agent.footer', { brand: opts.brandName }));
  return lines.join('\n');
}
