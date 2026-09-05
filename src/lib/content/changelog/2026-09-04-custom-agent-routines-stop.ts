import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Scheduled custom agents no longer run on their own',
  items: [
    'Custom agents you set to run every few days have stopped firing. Their setup is still saved, but nothing starts it on a schedule any more.',
    'Recurring work now belongs to your own agent: connect it over MCP and let it schedule the runs, so the cadence lives where the rest of your automation already does.',
    'The built-in weekly routines — recap, radar, SEO, AI visibility — are unaffected and keep running as before.'
  ]
} satisfies ChangelogEntry;
