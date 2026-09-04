export type Totals = { views: number; likes: number; comments: number; shares: number };

export type PlatformRow = { platform: string; posts: number; totals: Totals };

export type ActivityRow = {
  id: string;
  post_id: string | null;
  platform: string | null;
  status: string;
  caption: string | null;
  error: string | null;
  created_at: string;
};

export type TopPost = {
  id: string;
  platform: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  url: string | null;
  published_at: string | null;
  metrics: Record<string, number>;
};

export type Reach = Totals & { posts: number };

export type Entry = { label: string; value: number | null | undefined };

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export const METRIC_LABELS: Array<{ key: keyof Totals; label: string }> = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' }
];

export function compact(value: number): string {
  return COMPACT.format(value);
}

export function reachOf(rows: PlatformRow[]): Reach {
  return rows.reduce<Reach>(
    (total, row) => ({
      posts: total.posts + (row.posts ?? 0),
      views: total.views + (row.totals?.views ?? 0),
      likes: total.likes + (row.totals?.likes ?? 0),
      comments: total.comments + (row.totals?.comments ?? 0),
      shares: total.shares + (row.totals?.shares ?? 0)
    }),
    { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 }
  );
}

export function failuresOf(rows: ActivityRow[]): ActivityRow[] {
  return rows.filter((row) => row.status === 'failed' || Boolean(row.error));
}

export function shown(entries: Entry[]): Array<{ label: string; value: string }> {
  return entries
    .filter((entry): entry is { label: string; value: number } => typeof entry.value === 'number')
    .map((entry) => ({ label: entry.label, value: compact(entry.value) }));
}
