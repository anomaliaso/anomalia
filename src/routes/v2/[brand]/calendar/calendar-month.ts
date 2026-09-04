export type CalendarPost = {
  id: string;
  platform: string | null;
  caption: string | null;
  media_url: string | null;
  scheduled_for: string | null;
  status: string;
  slot: string | null;
  isDraft?: boolean;
};

export type MonthDay = {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
  posts: CalendarPost[];
};

export type PostState = {
  label: string;
  tone: 'default' | 'secondary' | 'outline' | 'destructive';
  canEdit: boolean;
  canApprove: boolean;
};

const WEEK_LENGTH = 7;
const WEEKS_SHOWN = 6;
const MONDAY_INDEX = 1;
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const POST_STATES: Record<string, PostState> = {
  pending_user: { label: 'Pending review', tone: 'default', canEdit: true, canApprove: true },
  approved: { label: 'Approved', tone: 'secondary', canEdit: true, canApprove: false },
  scheduled: { label: 'Scheduled', tone: 'secondary', canEdit: true, canApprove: false },
  published: { label: 'Published', tone: 'outline', canEdit: false, canApprove: false },
  failed: { label: 'Failed', tone: 'destructive', canEdit: true, canApprove: false }
};

export function stateOf(status: string): PostState {
  return POST_STATES[status] ?? { label: status, tone: 'outline', canEdit: false, canApprove: false };
}

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

export function momentInZone(iso: string, timezone: string): string {
  const stamp = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso));

  return `${stamp} (${timezone})`;
}

export function distributionNote(
  post: CalendarPost,
  timezone: string,
  now: number = Date.now()
): string {
  const at = post.scheduled_for ? Date.parse(post.scheduled_for) : Number.NaN;

  if (Number.isFinite(at) && at > now) {
    return `It goes out on ${momentInZone(post.scheduled_for as string, timezone)}.`;
  }

  return 'This post has no future date, so it goes out at the next slot Anomalia can use — possibly right away.';
}

function dayKeyOf(post: CalendarPost, timezone: string): string | null {
  if (post.scheduled_for) {
    return dayInZone(post.scheduled_for, timezone);
  }

  return post.slot?.match(ISO_DATE)?.[0] ?? null;
}

function byScheduledTime(a: CalendarPost, b: CalendarPost): number {
  return (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? '');
}

export function buildMonthGrid(
  year: number,
  month: number,
  posts: CalendarPost[],
  timezone: string
): { weeks: MonthDay[][]; undated: CalendarPost[] } {
  const byDay = new Map<string, CalendarPost[]>();
  const undated: CalendarPost[] = [];

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
