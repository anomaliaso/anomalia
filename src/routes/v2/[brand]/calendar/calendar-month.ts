import type { PostRow } from '../post-state';

export type MonthDay = {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  posts: PostRow[];
};

const WEEK_LENGTH = 7;
const WEEKS_SHOWN = 6;
const MONDAY_INDEX = 1;
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function dayInZone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));
}

export function timeInZone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso));
}

function dayKeyOf(post: PostRow, timezone: string): string | null {
  if (post.scheduled_for) {
    return dayInZone(post.scheduled_for, timezone);
  }

  return post.slot?.match(ISO_DATE)?.[0] ?? null;
}

function byScheduledTime(a: PostRow, b: PostRow): number {
  return (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? '');
}

export function buildMonthGrid(
  year: number,
  month: number,
  posts: PostRow[],
  timezone: string
): { weeks: MonthDay[][]; undated: PostRow[] } {
  const byDay = new Map<string, PostRow[]>();
  const undated: PostRow[] = [];

  for (const post of posts) {
    const key = dayKeyOf(post, timezone);
    if (!key) {
      undated.push(post);
      continue;
    }

    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }

  for (const dayPosts of byDay.values()) {
    dayPosts.sort(byScheduledTime);
  }

  const firstOfMonth = Date.UTC(year, month - 1, 1);
  const leading = (new Date(firstOfMonth).getUTCDay() + WEEK_LENGTH - MONDAY_INDEX) % WEEK_LENGTH;

  const weeks: MonthDay[][] = [];

  for (let w = 0; w < WEEKS_SHOWN; w++) {
    const week: MonthDay[] = [];

    for (let d = 0; d < WEEK_LENGTH; d++) {
      const at = new Date(firstOfMonth + (w * WEEK_LENGTH + d - leading) * DAY_MS);
      const date = at.toISOString().slice(0, 10);

      week.push({
        date,
        dayOfMonth: at.getUTCDate(),
        inMonth: at.getUTCMonth() === month - 1,
        posts: byDay.get(date) ?? []
      });
    }

    weeks.push(week);
  }

  return { weeks, undated };
}
