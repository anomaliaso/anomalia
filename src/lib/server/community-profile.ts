import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient } from './brand-context';
import { aiStructured } from './ai-text';
import { outcomeDigestFor } from './lead-outcomes';

// ── Community profiles: the memory the Radar was missing ────────────────────────────────────────
//
// The drafter used to write every reply knowing only the brand and the thread in front of it. That
// is why replies read as generically competent: r/smallbusiness and r/entrepreneur look alike from
// outside and the people in them are nothing alike, and a reply written in the register of the
// wrong one lands nowhere.
//
// So we keep one living profile per monitored community, rebuilt from the items the Radar has
// ALREADY collected (zero extra fetching, zero extra scraping cost — only the write-up call): who
// is in there, the exact phrases they use, what they already tried, what gets upvoted, what the
// mods remove, how a post there is shaped. Everything downstream reads it.
//
// It is also the single most useful thing the owner can read: a live document about the few
// thousand people who might buy from them, written from what those people actually said.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type CommunityProfile = {
  id?: string;
  platform: string;
  community: string;
  demographics?: string | null;
  psychographics?: string | null;
  vocabulary?: string[] | null;
  tried_and_failed?: string[] | null;
  what_lands?: string | null;
  rules?: string | null;
  tone?: string | null;
  items_seen?: number | null;
  changelog?: Array<{ date: string; note: string }> | null;
  updated_at?: string | null;
};

/**
 * Which profile an item belongs to. Reddit is per-subreddit (the whole point: two subs about the
 * same topic are two different rooms). Threads/X/LinkedIn items arrive from keyword searches with
 * no stable community behind them, so they get one profile per platform — still worth having,
 * because "how people phrase this on LinkedIn" is itself a register.
 */
export function communityKeyOf(sourceName: string, url: string): { platform: string; community: string } | null {
  const name = String(sourceName ?? '').trim();
  const u = String(url ?? '').toLowerCase();
  if (name.startsWith('r/')) return { platform: 'reddit', community: name.split(/\s/)[0] };
  if (u.includes('reddit.com')) {
    const sub = u.match(/reddit\.com\/r\/([^/]+)/)?.[1];
    return sub ? { platform: 'reddit', community: `r/${sub}` } : null;
  }
  if (u.includes('threads.net') || u.includes('threads.com')) return { platform: 'threads', community: 'threads' };
  if (u.includes('linkedin.com')) return { platform: 'linkedin', community: 'linkedin' };
  if (u.includes('x.com') || u.includes('twitter.com')) return { platform: 'x', community: 'x' };
  return null;
}

export const profileKey = (p: { platform: string; community: string }): string => `${p.platform}|${p.community}`;

export async function loadCommunityProfiles(
  admin: SupabaseClient,
  brandId: string
): Promise<Map<string, CommunityProfile>> {
  const { data } = await admin
    .from('brand_community_profiles')
    .select('id, platform, community, demographics, psychographics, vocabulary, tried_and_failed, what_lands, rules, tone, items_seen, changelog, updated_at')
    .eq('brand_id', brandId);
  return new Map((data ?? []).map((p) => [profileKey(p as CommunityProfile), p as CommunityProfile]));
}

/** Compact prompt block. Capped: this rides in every draft call, next to the thread itself. */
export function renderCommunityProfile(p: CommunityProfile | undefined): string {
  if (!p) return '';
  const lines: string[] = [];
  const add = (label: string, v: unknown) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (s) lines.push(`- ${label}: ${s.slice(0, 400)}`);
  };
  add('Who is in here', p.demographics);
  add('What they want / fear', p.psychographics);
  if (p.vocabulary?.length) lines.push(`- THEIR WORDS (use these, not synonyms): ${p.vocabulary.slice(0, 12).map((v) => `"${String(v).slice(0, 80)}"`).join(', ')}`);
  if (p.tried_and_failed?.length) lines.push(`- Already tried and burned by: ${p.tried_and_failed.slice(0, 6).map((v) => String(v).slice(0, 90)).join('; ')}`);
  add('What lands here / what gets buried', p.what_lands);
  add('Rules — what gets removed', p.rules);
  add('Tone and shape of a post here', p.tone);
  if (!lines.length) return '';
  return `COMMUNITY PROFILE — ${p.community} (built from what these people actually said; match it):\n${lines.join('\n')}`;
}

/** One line per community: the vocabulary only. Cheap enough to ride in the relevance judge. */
export function renderVocabularyDigest(profiles: Map<string, CommunityProfile>, cap = 900): string {
  const lines = [...profiles.values()]
    .filter((p) => p.vocabulary?.length)
    .map((p) => `- ${p.community}: ${p.vocabulary!.slice(0, 8).map((v) => `"${String(v).slice(0, 60)}"`).join(', ')}`);
  if (!lines.length) return '';
  return `HOW THESE COMMUNITIES PHRASE THE PROBLEM (catch these phrasings, not only the obvious ones):\n${lines.join('\n')}`.slice(0, cap);
}

const PROFILE_SCHEMA = {
  type: 'object' as const,
  properties: {
    demographics: { type: 'string' as const, description: 'Rough age range, where they are, what they do for money, what stage they are at. Infer it from what people say about themselves and MARK anything you are guessing as (guess). Empty if the evidence does not support any claim.' },
    psychographics: { type: 'string' as const, description: 'What they want, what they are afraid of, how they see themselves, who they do not want to be associated with, what they are embarrassed about.' },
    vocabulary: { type: 'array' as const, items: { type: 'string' as const }, description: 'The EXACT phrases these people use — for the problem, for the solution, for the things they tried. Quote them verbatim from the items, never paraphrase. 5-12 entries.' },
    tried_and_failed: { type: 'array' as const, items: { type: 'string' as const }, description: 'What they have already tried and what they said about why it did not work. Up to 6.' },
    what_lands: { type: 'string' as const, description: 'What gets attention here and what dies, with concrete examples from the items.' },
    rules: { type: 'string' as const, description: 'What gets removed, what the mods are strict about, whether links and self-promotion are tolerated. Say "unknown" rather than guessing hard rules.' },
    tone: { type: 'string' as const, description: 'How long posts usually are, how personal, whether they use headers, how people open a post.' },
    change_note: { type: 'string' as const, description: 'ONE short line for the changelog: what changed versus the previous profile and why. "no change" when the new items add nothing.' }
  },
  required: ['demographics', 'psychographics', 'vocabulary', 'tried_and_failed', 'what_lands', 'rules', 'tone', 'change_note']
};

// A profile is only worth rewriting when there is new evidence, and only so often — this is one AI
// call per community per run.
const MIN_ITEMS_TO_REFRESH = 5;
const REFRESH_AFTER_HOURS = 20;
/** Communities rewritten per run. 4 radar ticks a day → up to 12 communities refreshed daily. */
const MAX_PROFILES_PER_RUN = 3;
const ITEMS_PER_PROFILE = 60;

/**
 * Rebuild the stalest community profiles from the items collected since the last rewrite.
 * Best-effort: never throws, and a failure on one community never blocks the others.
 * Returns how many profiles were rewritten.
 */
export async function refreshCommunityProfiles(
  admin: SupabaseClient,
  brand: { id: string; name: string }
): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data: items } = await admin
    .from('brand_news_items')
    .select('title, snippet, url, source_name, status, skip_reason, intent, created_at')
    .eq('brand_id', brand.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(600);
  if (!items?.length) return 0;

  const buckets = new Map<string, { platform: string; community: string; rows: AnyRec[] }>();
  for (const it of items) {
    const key = communityKeyOf(String(it.source_name ?? ''), String(it.url ?? ''));
    if (!key) continue; // news/RSS items have no community behind them
    const k = profileKey(key);
    let b = buckets.get(k);
    if (!b) { b = { ...key, rows: [] }; buckets.set(k, b); }
    b.rows.push(it);
  }
  if (!buckets.size) return 0;

  const existing = await loadCommunityProfiles(admin, brand.id);
  const cutoff = Date.now() - REFRESH_AFTER_HOURS * 3600 * 1000;
  const due = [...buckets.entries()]
    .filter(([k, b]) => {
      if (b.rows.length < MIN_ITEMS_TO_REFRESH) return false;
      const prev = existing.get(k);
      if (!prev?.updated_at) return true;
      return Date.parse(prev.updated_at) < cutoff;
    })
    // Stalest first, so no community is starved by a chattier one.
    .sort(([ka], [kb]) => (Date.parse(existing.get(ka)?.updated_at ?? '') || 0) - (Date.parse(existing.get(kb)?.updated_at ?? '') || 0))
    .slice(0, MAX_PROFILES_PER_RUN);
  if (!due.length) return 0;

  const ai = genaiClient();
  let written = 0;
  for (const [k, bucket] of due) {
    try {
      const prev = existing.get(k);
      const evidence = bucket.rows.slice(0, ITEMS_PER_PROFILE).map((r, i) => {
        const skipped = r.status === 'skipped' && r.skip_reason ? ` [we passed on this: ${String(r.skip_reason).slice(0, 80)}]` : '';
        return `${i + 1}. ${String(r.title ?? '').slice(0, 160)}${r.snippet ? ` — ${String(r.snippet).replace(/\s+/g, ' ').slice(0, 300)}` : ''}${skipped}`;
      }).join('\n');

      const prevBlock = prev
        ? `PREVIOUS PROFILE (only change something when the new activity CONTRADICTS or ADDS to it — do not rewrite for the sake of rewriting):\n${renderCommunityProfile(prev) || '(empty)'}\n`
        : '';

      // Qui il loop si chiude. "Cosa viene premiato e cosa sepolto" smette di essere dedotto dai
      // titoli dei thread e diventa cosa è successo ai NOSTRI commenti in questa stanza — upvote,
      // risposte, rimozioni. Vuoto finché nessun lead di questa community è stato controllato.
      const outcomes = await outcomeDigestFor(admin, brand.id, bucket.community).catch((error) => { swallow('outcome digest', error); return ''; });

      const result = await aiStructured<AnyRec>(
        ai,
        `You are keeping a living profile of ${bucket.community} — a real community of people, studied from what they actually posted. This profile is read before every reply we write there, so it has to describe THESE people, not the topic in general.

${prevBlock}
RECENT ACTIVITY IN ${bucket.community} (${bucket.rows.length} items seen in the last 14 days):
${evidence}
${outcomes ? `\n${outcomes}\n` : ''}
Write the profile from the evidence above.${outcomes ? ' Gli esiti dei nostri commenti pesano più di qualunque deduzione: se qualcosa è stato rimosso, la sezione sulle regole deve dirlo, e se un tipo di risposta ha preso upvote, deve finire in cosa funziona qui.' : ''} Quote their exact words wherever you can. Never invent a demographic, a rule or a phrase that is not supported by what you see — an honest "unknown" is worth more than a plausible guess, and anything you infer must be marked (guess).`,
        PROFILE_SCHEMA,
        'You study online communities the way a good ethnographer does: from what people said, in their words, without flattering the brand paying you.',
        'return_community_profile'
      );

      const note = String(result?.change_note ?? '').trim();
      const changelog = [
        ...(prev?.changelog ?? []),
        ...(note && !/^no change$/i.test(note) ? [{ date: new Date().toISOString().slice(0, 10), note: note.slice(0, 240) }] : [])
      ].slice(-30);

      await admin.from('brand_community_profiles').upsert(
        {
          brand_id: brand.id,
          platform: bucket.platform,
          community: bucket.community,
          demographics: String(result?.demographics ?? '').slice(0, 2000) || null,
          psychographics: String(result?.psychographics ?? '').slice(0, 2000) || null,
          vocabulary: (Array.isArray(result?.vocabulary) ? result.vocabulary : []).map((v: unknown) => String(v).slice(0, 120)).slice(0, 20),
          tried_and_failed: (Array.isArray(result?.tried_and_failed) ? result.tried_and_failed : []).map((v: unknown) => String(v).slice(0, 200)).slice(0, 10),
          what_lands: String(result?.what_lands ?? '').slice(0, 2000) || null,
          rules: String(result?.rules ?? '').slice(0, 1200) || null,
          tone: String(result?.tone ?? '').slice(0, 1200) || null,
          items_seen: bucket.rows.length,
          changelog,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'brand_id,platform,community' }
      );
      written++;
    } catch (e) {
      console.warn('[radar] community profile failed for', k, e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  return written;
}
