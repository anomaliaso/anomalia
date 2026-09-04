export type PostRow = {
  id: string;
  platform: string | null;
  platforms?: string[] | null;
  caption: string | null;
  media_url: string | null;
  slot: string | null;
  scheduled_for: string | null;
  status: string;
  published_url?: string | null;
  created_at?: string;
  isDraft?: boolean;
};

export type PostState = {
  label: string;
  tone: 'default' | 'secondary' | 'outline' | 'destructive';
  canEdit: boolean;
  canApprove: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const SUMMARY_MAX = 90;

const POST_STATES: Record<string, PostState> = {
  pending_user: { label: 'Pending review', tone: 'default', canEdit: true, canApprove: true },
  approved: { label: 'Approved', tone: 'secondary', canEdit: true, canApprove: false },
  scheduled: { label: 'Scheduled', tone: 'secondary', canEdit: true, canApprove: false },
  published: { label: 'Published', tone: 'outline', canEdit: false, canApprove: false },
  failed: { label: 'Failed', tone: 'destructive', canEdit: true, canApprove: false }
};

export const STATUS_FILTERS = [
  { value: 'all', label: 'Everything' },
  ...Object.entries(POST_STATES).map(([value, state]) => ({ value, label: state.label }))
];

export function stateOf(status: string): PostState {
  return (
    POST_STATES[status] ?? { label: status, tone: 'outline', canEdit: false, canApprove: false }
  );
}

export function filterFor(status: string | null): string {
  return status && status in POST_STATES ? status : 'all';
}

export function platformsOf(post: PostRow): string[] {
  if (post.platforms?.length) {
    return post.platforms;
  }

  return post.platform ? [post.platform] : [];
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

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(`${day}T00:00:00Z`));
}

export function whenLabel(post: PostRow, timezone: string): string {
  if (post.scheduled_for) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(post.scheduled_for));
  }

  const day = post.slot?.match(ISO_DATE)?.[0];
  if (day) {
    return `${dayLabel(day)}, no time yet`;
  }

  return 'No date';
}

export function summarise(post: PostRow): string {
  const copy = (post.caption ?? '').trim().replace(/\s+/g, ' ');
  if (!copy) {
    return 'Untitled';
  }

  return copy.length > SUMMARY_MAX ? `${copy.slice(0, SUMMARY_MAX)}…` : copy;
}

export function distributionNote(
  post: PostRow,
  timezone: string,
  now: number = Date.now()
): string {
  const at = post.scheduled_for ? Date.parse(post.scheduled_for) : Number.NaN;

  if (Number.isFinite(at) && at > now) {
    return `It goes out on ${momentInZone(post.scheduled_for as string, timezone)}.`;
  }

  return 'This post has no future date, so it goes out at the next slot Anomalia can use — possibly right away.';
}
