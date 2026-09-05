import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Your brand data can no longer be saved broken',
  items: [
    'Brand kit, products, posts, articles, plans, people and competitors now refuse malformed values instead of storing them: a colour has to be a colour, a website has to be a link, a status has to be one the product understands.',
    'Typing your social handle where the website goes now files it under your brand handles instead of saving an address that opens nothing — and the handles already saved that way have been moved across.',
    'Re-researching your competitors now actually saves them: the write was failing silently, so the chat reported competitors it had not stored.',
    'Competitor handles found by research now show up on the competitors page: they were being saved in a shape no screen could read.',
    'Posts filed through the API by an external agent keep working: the new checks were about to reject every one of them.'
  ]
} satisfies ChangelogEntry;
