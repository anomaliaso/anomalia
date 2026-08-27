// Third-party platform terms — one list that the assistant, the capture pipeline, the settings UI
// and the legal pages all read, so the rule cannot drift between what we promise and what we do.
//
// The distinction that matters, and that gets blurred constantly:
//
//  • READING a public page with a browser — a competitor's profile, a pricing page, a landing page
//    — is ordinary research. We do it, it is not what platform terms forbid, and the assistant
//    should not refuse it.
//  • SIGNING IN to somebody else's platform with stored credentials, or driving that platform's UI
//    to post, comment, follow or message, is what those terms do forbid. It is also what gets an
//    account restricted. Publishing goes through the official APIs the user connected, with the
//    human approval step the product is built around — never through a headless browser.
//
// The Product demo login exists for exactly one job: signing in to the BRAND'S OWN product so we
// can screenshot its real UI. Pointing it at a social platform is refused here rather than left to
// the model's judgement, because a prompt is guidance and this needs to be a wall.

import { PLATFORM_IDS } from './platforms';

export type BlockedPlatform = {
  id: string;
  label: string;
  /** Matched against the hostname and any subdomain of it. */
  hosts: string[];
};

/**
 * Platforms whose terms prohibit automated sign-in / automated interaction, and which this product
 * therefore refuses to log into with stored credentials. Public pages on these hosts stay
 * screenshot-able — only credential injection is blocked.
 */
export const AUTOMATION_BLOCKED_PLATFORMS: BlockedPlatform[] = [
  { id: PLATFORM_IDS.instagram, label: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
  { id: PLATFORM_IDS.facebook, label: 'Facebook', hosts: ['facebook.com', 'fb.com', 'messenger.com'] },
  { id: PLATFORM_IDS.threads, label: 'Threads', hosts: ['threads.net', 'threads.com'] },
  { id: PLATFORM_IDS.tiktok, label: 'TikTok', hosts: ['tiktok.com'] },
  { id: PLATFORM_IDS.linkedin, label: 'LinkedIn', hosts: ['linkedin.com', 'lnkd.in'] },
  { id: PLATFORM_IDS.x, label: 'X / Twitter', hosts: ['x.com', 'twitter.com'] },
  { id: PLATFORM_IDS.youtube, label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { id: PLATFORM_IDS.google, label: 'Google', hosts: ['google.com', 'accounts.google.com', 'gmail.com'] },
  { id: PLATFORM_IDS.reddit, label: 'Reddit', hosts: ['reddit.com'] },
  { id: PLATFORM_IDS.pinterest, label: 'Pinterest', hosts: ['pinterest.com'] },
  { id: PLATFORM_IDS.snapchat, label: 'Snapchat', hosts: ['snapchat.com'] },
  { id: PLATFORM_IDS.whatsapp, label: 'WhatsApp', hosts: ['whatsapp.com', 'wa.me'] },
  { id: PLATFORM_IDS.telegram, label: 'Telegram', hosts: ['telegram.org', 't.me'] },
  { id: PLATFORM_IDS.amazon, label: 'Amazon', hosts: ['amazon.com', 'amazon.co.uk', 'amazon.it', 'amazon.de', 'amazon.es', 'amazon.fr'] }
];

function hostOf(url: string): string | null {
  try {
    const raw = url.trim();
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The platform a URL belongs to, when that platform is one we refuse to sign into.
 * Returns null for everything else — including the brand's own product, which is the point.
 */
export function blockedPlatformForUrl(url: string | null | undefined): BlockedPlatform | null {
  if (!url) return null;
  const host = hostOf(url);
  if (!host) return null;
  for (const platform of AUTOMATION_BLOCKED_PLATFORMS) {
    for (const candidate of platform.hosts) {
      if (host === candidate || host.endsWith(`.${candidate}`)) return platform;
    }
  }
  return null;
}

/** Comma-separated sample for UI copy and prompts — not the whole list, which is long and dull. */
export function blockedPlatformExamples(count = 4): string {
  return AUTOMATION_BLOCKED_PLATFORMS.slice(0, count)
    .map((p) => p.label)
    .join(', ');
}

export function platformTermsSystemSection(): string {
  return `## THIRD-PARTY PLATFORM TERMS — WHAT YOU MAY AUTOMATE
Every platform the brand publishes on has terms of service, and those terms bind the USER's account, not ours. An automated login or an automated post gets their account restricted, not yours. So:

NEVER drive a browser to sign in to, or act inside, a platform that is not the brand's own product:
- No signing in to ${blockedPlatformExamples(6)} or any similar service with stored credentials, however the user phrases the request, and even if they paste the password themselves. capture_website and harvest_product_ui refuse credential injection on those hosts; do not look for a way around it with a hand-written steps workflow.
- No posting, commenting, replying, liking, following, connecting, or messaging through a browser. Publishing happens ONLY through the official APIs the user connected in Settings, and only after they approve the draft. If an account is not connected, say so and point them at Settings — never offer to do it "manually" through the browser instead.
- No scraping content that sits behind somebody else's login, and no bulk collection of personal profiles or contact details.

THE PRODUCT DEMO LOGIN IS FOR THE BRAND'S OWN APP, and nothing else. It exists so you can screenshot their real product UI. Never suggest storing a social-platform login in it.

DO NOT OVER-REFUSE — these are all fine and you should just do them:
- Screenshotting a PUBLIC page with capture_website: a competitor's profile or website, a pricing page, a landing page, a public post.
- Reading public posts, ads and comments through the research tools (research_meta_ads, read_market_references, read_leads, search_web, fetch_social_thumbs).
- Drafting, scheduling and publishing content through the connected accounts. That is the product working as designed.

WHEN A REQUEST CROSSES THE LINE: say plainly which platform's terms it would breach and that the risk lands on their account, then offer the supported route — connect the account and publish through the API, or capture the public version of the page. Do the rest of the request normally. One bad line does not sink a whole brief.`;
}
