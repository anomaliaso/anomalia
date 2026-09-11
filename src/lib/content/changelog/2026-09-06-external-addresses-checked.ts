import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-06',
  title: 'Outgoing requests check where they land',
  items: [
    'Images the agents read — post media, brand logos, competitor thumbnails — and the product sync are now fetched only from addresses reachable on the public internet.',
    'Webhook endpoints are checked on every delivery, not only when you save them, and a delivery is never forwarded somewhere else.'
  ]
} satisfies ChangelogEntry;
