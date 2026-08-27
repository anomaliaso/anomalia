import type { SupabaseClient } from '@supabase/supabase-js';
import { siteUrl } from '$lib/seo';
import type { Locale } from '$lib/i18n/locale';
import { digestEmailSubject, digestEmailHtml, digestEmailText, type DigestPost } from './email';
import { notifyBrandContacts, type BrandNotifyContact } from './brand-notify';

// Daily "published yesterday" digest. Runs once a day (08:00 UTC cron) and emails the brand's
// contacts a short recap of what went live the previous UTC day. Zero posts → no email, so
// brands that published nothing never create noise.

export type DailyDigest = {
  posts: DigestPost[];
  count: number;
};

// UTC calendar-day window for the target day. `day` is 'yesterday' (the previous UTC day) or an
// explicit 'YYYY-MM-DD' (tests, backfills). Exported so the tick and tests share the same math.
export function digestDayWindow(day: string, now: Date = new Date()): { start: string; end: string } {
  let target: Date;
  if (day === 'yesterday') {
    target = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    target = new Date(`${day}T00:00:00Z`);
  } else {
    throw new Error(`Invalid digest day: ${day}`);
  }
  const start = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60 * 1000).toISOString()
  };
}

// Posts of `brandId` published (status='published') inside the target UTC day, oldest first.
// Captions are truncated to 160 chars so the email stays compact.
export async function buildDailyDigest(
  admin: SupabaseClient,
  brandId: string,
  opts: { day?: string } = {}
): Promise<DailyDigest> {
  const { start, end } = digestDayWindow(opts.day ?? 'yesterday');
  const { data, error } = await admin
    .from('posts')
    .select('id, platform, caption, media_url, published_url, slot')
    .eq('brand_id', brandId)
    .eq('status', 'published')
    .gte('published_at', start)
    .lt('published_at', end)
    .order('published_at', { ascending: true });

  if (error) throw new Error(`buildDailyDigest: ${error.message}`);

  const posts: DigestPost[] = (data ?? []).map((p) => ({
    id: String(p.id),
    platform: p.platform ? String(p.platform) : null,
    caption: p.caption ? String(p.caption).slice(0, 160) : null,
    media_url: p.media_url ? String(p.media_url) : null,
    published_url: p.published_url ? String(p.published_url) : null,
    slot: p.slot ? String(p.slot) : null
  }));
  return { posts, count: posts.length };
}

// Fan the digest out to every contact (owner first, then collaborators), each in their own
// locale, plus a push to the calendar. Returns the number of emails actually sent.
// `digest` may be prebuilt (the tick already built it to check count>0) — when omitted it is
// built here, and zero posts still means no send (never email silence).
export async function sendDailyDigest(
  admin: SupabaseClient,
  brand: { id: string; name: string; slug: string; org_id: string },
  contacts: BrandNotifyContact[],
  digest?: DailyDigest
): Promise<number> {
  const d = digest ?? (await buildDailyDigest(admin, brand.id));
  if (d.count === 0 || contacts.length === 0) return 0;

  const calendarUrl = `${siteUrl()}/app/${brand.slug}/calendar`;
  return notifyBrandContacts(admin, contacts, {
    logPrefix: '[publish-digest]',
    buildEmail: (locale: Locale, to: string) => ({
      to,
      subject: digestEmailSubject(locale, brand.name, d.count),
      html: digestEmailHtml(locale, brand, d.posts),
      text: digestEmailText(locale, brand, d.posts)
    }),
    push: { url: calendarUrl, tag: `daily-digest-${brand.id}` }
  });
}
