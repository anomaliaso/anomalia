/**
 * Deterministic article editing. No model runs here and no credit is spent: every field the
 * caller sends is stored as it arrived, and every field it did not send is left untouched.
 *
 * ARTICLE_EDIT_RULES is the only place that says what a status allows. Adding a status is a row,
 * not another `if` scattered over the chat tool, the web editor and the API.
 */
export const ARTICLE_STATUSES = ['draft', 'planned', 'approved', 'published'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

const SCHEDULE_REFUSALS = ['article_published', 'planned_needs_slot'] as const;
export type ScheduleRefusal = (typeof SCHEDULE_REFUSALS)[number];

type ScheduleOutcome = ArticleStatus | 'keep' | ScheduleRefusal;

const ARTICLE_EDIT_RULES: Record<
  ArticleStatus,
  { edit: 'allow' | ScheduleRefusal; schedule: ScheduleOutcome; unschedule: ScheduleOutcome }
> = {
  draft: { edit: 'allow', schedule: 'approved', unschedule: 'draft' },
  planned: { edit: 'allow', schedule: 'keep', unschedule: 'planned_needs_slot' },
  approved: { edit: 'allow', schedule: 'approved', unschedule: 'draft' },
  published: { edit: 'article_published', schedule: 'article_published', unschedule: 'article_published' }
};

const isScheduleRefusal = (value: string): value is ScheduleRefusal =>
  (SCHEDULE_REFUSALS as readonly string[]).includes(value);

const rulesFor = (status: string) => ARTICLE_EDIT_RULES[status as ArticleStatus] ?? ARTICLE_EDIT_RULES.draft;

export function articleEditRefusal(status: string): ScheduleRefusal | null {
  const outcome = rulesFor(status).edit;
  return outcome === 'allow' ? null : outcome;
}

export type SchedulePatch = { scheduled_for: string | null; status?: ArticleStatus };

export function articleScheduleChange(
  status: string,
  when: string | null
): { ok: true; patch: SchedulePatch } | { ok: false; reason: ScheduleRefusal } {
  const outcome = when ? rulesFor(status).schedule : rulesFor(status).unschedule;
  if (isScheduleRefusal(outcome)) return { ok: false, reason: outcome };
  return {
    ok: true,
    patch: outcome === 'keep' ? { scheduled_for: when } : { scheduled_for: when, status: outcome }
  };
}
