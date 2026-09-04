export type MediaRow = {
  id: string;
  kind: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  signed_url: string | null;
  created_at: string;
};

const MEDIA_KINDS: Record<string, string> = {
  image: 'Images',
  video: 'Videos'
};

export const KIND_FILTERS = [
  { value: 'all', label: 'Everything' },
  ...Object.entries(MEDIA_KINDS).map(([value, label]) => ({ value, label }))
];

export function kindFor(kind: string | null): string {
  return kind && kind in MEDIA_KINDS ? kind : 'all';
}

export function ofKind(media: MediaRow[], kind: string): MediaRow[] {
  return kind === 'all' ? media : media.filter((m) => m.kind === kind);
}

export function labelOf(item: MediaRow): string {
  const title = (item.title ?? '').trim();
  return title || (item.mime ?? item.kind);
}

export function shapeOf(item: MediaRow): string | null {
  return item.width && item.height ? `${item.width}×${item.height}` : null;
}

export function addedOn(item: MediaRow, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(item.created_at));
}
