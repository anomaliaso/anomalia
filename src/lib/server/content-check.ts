/**
 * Runs the checks Anomalia already runs on its own copy against a spec somebody else wrote.
 *
 * Every rule here belongs to another module and is called, never restated: the platform
 * requirements to `platform-limits.ts`, the caption soundness to `prepublish-check.ts` and
 * `proof-discipline.ts`, the score to `content-quality.ts`, the double-booking to `schedule.ts`,
 * the hashtag hygiene to `platform-hygiene.ts`. What this file owns is the composition — which of
 * those verdicts blocks and which only warns — and the version of that composition.
 *
 * No model, ever. A verdict that costs a model call cannot be run before every draft, and one that
 * moves when a model is swapped is not a verdict.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { assemblePlatformCaptions, captionFor, publishBlockers } from '$lib/platform-limits';
import { normalizePlatforms } from '$lib/manual-posting-captions';
import { findBrandMediaByIds } from '$lib/server/brand-media';
import { getPosts } from '$lib/server/cli-queries';
import { CONTENT_SCORER_VERSION, scoreContentQuality } from '$lib/server/content-quality';
import { isPlaceholderCaption } from '$lib/server/prepublish-check';
import { needMarkers } from '$lib/server/proof-discipline';
import { reachChasingHashtags } from '$lib/server/platform-hygiene';
import { datetimeInputToUtc, earliestScheduleMs, listCalendarConflicts } from '$lib/server/schedule';

/** Bump when a rule is added, removed, or moves between blocking and warning. */
export const CONTENT_CHECK_RULES_VERSION = 1;

const RECENT_CAPTIONS = 20;
const CANDIDATE_ID = 'the-content-being-checked';

export type ContentIssue = { code: string; field: string; detail: string };

export type PlatformScore = {
  platform: string;
  index: number;
  checks: { id: string; value: number; weight: number; note: string }[];
};

export type ContentSpec = {
  platforms: string[];
  caption: string;
  platformCaptions?: Record<string, string>;
  mediaIds?: string[];
  title?: string;
  scheduledFor?: string;
};

export type ContentCheckReport = {
  ok: boolean;
  errors: ContentIssue[];
  warnings: ContentIssue[];
  scores: PlatformScore[];
  versions: { rules: number; scorer: number };
};

// Il predicato di ognuna vive nel modulo che la governa: qui c'è solo quali bloccano.
const CAPTION_RULES: { code: string; blocking: (caption: string) => string | null }[] = [
  {
    code: 'caption_empty',
    blocking: (caption) => (caption ? null : 'The caption has no text')
  },
  {
    code: 'caption_placeholder',
    blocking: (caption) =>
      caption && isPlaceholderCaption(caption)
        ? 'The caption is a placeholder or carries no words of its own'
        : null
  },
  {
    code: 'caption_needs_proof',
    blocking: (caption) => {
      const needs = needMarkers(caption);
      return needs.length
        ? `Supply the facts these markers are waiting for, never delete them: ${needs.slice(0, 3).join('; ')}`
        : null;
    }
  }
];

function captionErrors(caption: string): ContentIssue[] {
  const out: ContentIssue[] = [];
  for (const rule of CAPTION_RULES) {
    const detail = rule.blocking(caption);
    if (detail) out.push({ code: rule.code, field: 'caption', detail });
  }
  return out;
}

type ResolvedMedia = { hasMedia: boolean; hasVideo: boolean; missing: string[] };

async function resolveMedia(
  supabase: SupabaseClient,
  brandId: string,
  ids: string[]
): Promise<ResolvedMedia> {
  if (!ids.length) return { hasMedia: false, hasVideo: false, missing: [] };
  const owned = await findBrandMediaByIds(supabase, brandId, ids);
  const byId = new Map(owned.map((row) => [row.id, row]));
  return {
    hasMedia: owned.length > 0,
    hasVideo: owned.some((row) => row.kind === 'video'),
    missing: ids.filter((id) => !byId.has(id))
  };
}

function scheduleIssues(
  scheduledFor: string | undefined,
  timezone: string,
  calendar: Parameters<typeof listCalendarConflicts>[0]
): { errors: ContentIssue[]; warnings: ContentIssue[] } {
  if (!scheduledFor) return { errors: [], warnings: [] };

  const instant = datetimeInputToUtc(scheduledFor, timezone);
  if (!instant) {
    return {
      errors: [{ code: 'invalid_scheduled_for', field: 'scheduled_for', detail: `Not a datetime: ${scheduledFor}` }],
      warnings: []
    };
  }
  if (new Date(instant).getTime() < earliestScheduleMs()) {
    return {
      errors: [
        {
          code: 'too_soon',
          field: 'scheduled_for',
          detail: `${instant} is in the past or too close to now to be honoured`
        }
      ],
      warnings: []
    };
  }

  const candidate = { id: CANDIDATE_ID, scheduled_for: instant, status: 'pending_user', slot: null };
  const clash = listCalendarConflicts([...calendar, candidate], timezone).find((group) =>
    group.posts.some((p) => p.id === CANDIDATE_ID)
  );
  if (!clash) return { errors: [], warnings: [] };

  const neighbours = clash.posts.filter((p) => p.id !== CANDIDATE_ID).map((p) => p.id ?? p.platform ?? 'a post');
  return {
    errors: [],
    warnings: [
      {
        code: 'calendar_conflict',
        field: 'scheduled_for',
        detail: `${clash.at} is already taken by ${neighbours.join(', ')}`
      }
    ]
  };
}

export async function checkContent(opts: {
  supabase: SupabaseClient;
  brandId: string;
  timezone: string;
  spec: ContentSpec;
}): Promise<ContentCheckReport> {
  const { spec } = opts;
  const platforms = normalizePlatforms(spec.platforms);
  const caption = String(spec.caption ?? '').trim();
  const assembled = assemblePlatformCaptions(caption, spec.platformCaptions ?? {}, platforms);

  const media = await resolveMedia(opts.supabase, opts.brandId, spec.mediaIds ?? []);
  const recent = await getPosts(opts.supabase, opts.brandId);

  const errors: ContentIssue[] = [];
  const warnings: ContentIssue[] = [];

  if (!platforms.length) {
    errors.push({
      code: 'no_platforms',
      field: 'platforms',
      detail: `None of ${spec.platforms.join(', ') || '(none given)'} is a platform Anomalia publishes to`
    });
  }
  if (media.missing.length) {
    errors.push({
      code: 'media_not_found',
      field: 'media_ids',
      detail: `Not in this brand library: ${media.missing.join(', ')}`
    });
  }
  errors.push(...captionErrors(caption));
  errors.push(
    ...publishBlockers({
      platforms,
      caption: assembled.caption,
      platformCaptions: assembled.platform_captions,
      hasMedia: media.hasMedia,
      hasVideo: media.hasVideo,
      title: spec.title
    }).map(({ code, field, detail }) => ({ code, field, detail }))
  );

  const schedule = scheduleIssues(spec.scheduledFor, opts.timezone, recent);
  errors.push(...schedule.errors);
  warnings.push(...schedule.warnings);

  const chasing = reachChasingHashtags(assembled.caption);
  if (chasing.length) {
    warnings.push({
      code: 'reach_chasing_hashtags',
      field: 'caption',
      detail: `Tags that buy impressions and no readers: ${chasing.join(' ')}`
    });
  }

  const recentCaptions = recent.map((post) => post.caption).slice(0, RECENT_CAPTIONS);
  const scores = platforms.map((platform) => {
    const quality = scoreContentQuality({
      caption: captionFor(assembled.caption, assembled.platform_captions, platform),
      platform,
      recentCaptions
    });
    return {
      platform,
      index: quality.index,
      checks: quality.checks.map(({ id, value, weight, note }) => ({ id, value, weight, note }))
    };
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    scores,
    versions: { rules: CONTENT_CHECK_RULES_VERSION, scorer: CONTENT_SCORER_VERSION }
  };
}
