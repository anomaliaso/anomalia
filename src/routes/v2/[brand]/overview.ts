export type ScheduledPost = {
  id: string;
  platform: string | null;
  caption: string | null;
  scheduled_for: string | null;
  status: string;
};

export function nextOut(posts: ScheduledPost[], now: number = Date.now()): ScheduledPost | null {
  let soonest: ScheduledPost | null = null;
  let soonestAt = Number.POSITIVE_INFINITY;

  for (const post of posts) {
    const at = post.scheduled_for ? Date.parse(post.scheduled_for) : Number.NaN;
    if (!Number.isFinite(at) || at <= now || at >= soonestAt) {
      continue;
    }

    soonest = post;
    soonestAt = at;
  }

  return soonest;
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
