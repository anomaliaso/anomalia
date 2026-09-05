import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Agents can find every tool Anomalia has',
  items: [
    'Ask an agent to change an image you already have and it edits that image, instead of drawing a new one from scratch.',
    'Agents can now query your data directly — one call for a count or a table nothing else exposes.',
    'Ad remixes are documented, credit cost included, so an agent knows what it spends before it spends it.',
    'An image render is one shot with no automatic retry, and the agent instructions now say so instead of promising a quality check that no longer runs.'
  ]
} satisfies ChangelogEntry;
