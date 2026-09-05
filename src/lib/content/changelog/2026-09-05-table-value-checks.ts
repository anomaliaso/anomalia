import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Your brand data can no longer be saved broken',
  items: [
    'Brand kit, products, posts, articles, plans, people and competitors now refuse malformed values instead of storing them: a colour has to be a colour, a website has to be a link, a status has to be one the product actually understands.',
    'A value the system cannot use is now rejected the moment you save it, rather than turning up later as an empty page or a feed that finds nothing.'
  ]
} satisfies ChangelogEntry;
