import { platformsOf, stateOf, summarise, type PostRow } from './posts/post-state';

export type DashboardFacts = {
  pending: number;
  scheduled: number;
  published: number;
  accounts: number;
  hasEditorialPlan: boolean;
  lastRunError: string | null;
};

export type Todo = {
  id: string;
  title: string;
  detail: string;
  action: { label: string; href: string } | null;
};

export type UpcomingRow = {
  id: string;
  day: string;
  platform: string;
  title: string;
  state: ReturnType<typeof stateOf>;
};

const UPCOMING_SHOWN = 5;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * La sola tabella di cosa il brand deve alla dashboard. Una condizione, un titolo, e un posto
 * dove andare quando esiste — `null` quando la superficie che risolverebbe il problema non è
 * ancora stata costruita, perché un bottone che non porta da nessuna parte è peggio del silenzio.
 */
const ATTENTION: {
  id: string;
  when: (f: DashboardFacts) => boolean;
  title: (f: DashboardFacts) => string;
  detail: (f: DashboardFacts) => string;
  action: ((slug: string) => { label: string; href: string }) | null;
}[] = [
  {
    id: 'approvals',
    when: (f) => f.pending > 0,
    title: (f) => (f.pending === 1 ? '1 post to approve' : `${f.pending} posts to approve`),
    detail: () => 'Nothing goes out until you say yes.',
    action: (slug) => ({ label: 'Review', href: `/v2/${slug}/posts?status=pending_user` })
  },
  {
    id: 'channels',
    when: (f) => f.accounts === 0,
    title: () => 'No channel connected',
    detail: () => 'Posts get written, but they have nowhere to go out.',
    action: null
  },
  {
    id: 'plan',
    when: (f) => !f.hasEditorialPlan,
    title: () => 'No editorial plan',
    detail: () => 'Without one, production follows the fallback cadence.',
    action: null
  },
  {
    id: 'last-run',
    when: (f) => Boolean(f.lastRunError),
    title: () => 'The last automation run failed',
    detail: (f) => f.lastRunError as string,
    action: null
  }
];

export function todos(facts: DashboardFacts, slug: string): Todo[] {
  return ATTENTION.filter((rule) => rule.when(facts)).map((rule) => ({
    id: rule.id,
    title: rule.title(facts),
    detail: rule.detail(facts),
    action: rule.action ? rule.action(slug) : null
  }));
}

export function attentionLine(count: number): string {
  if (count === 0) {
    return 'Nothing needs you right now.';
  }

  return count === 1 ? '1 thing needs your attention' : `${count} things need your attention`;
}

function dueAt(post: PostRow): number {
  if (post.scheduled_for) {
    return Date.parse(post.scheduled_for);
  }

  const day = post.slot?.match(ISO_DATE)?.[0];
  return day ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
}

function dayIn(at: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit'
  }).format(new Date(at));
}

/** Le prossime uscite: quelle con una data futura e non ancora pubblicate, dalla più vicina. */
export function upcoming(
  posts: PostRow[],
  timezone: string,
  now: number = Date.now()
): UpcomingRow[] {
  return posts
    .filter((post) => post.status !== 'published')
    .map((post) => ({ post, at: dueAt(post) }))
    .filter(({ at }) => Number.isFinite(at) && at > now)
    .sort((a, b) => a.at - b.at)
    .slice(0, UPCOMING_SHOWN)
    .map(({ post, at }) => ({
      id: post.id,
      day: dayIn(at, timezone),
      platform: platformsOf(post).join(' · ') || 'post',
      title: summarise(post),
      state: stateOf(post.status)
    }));
}
