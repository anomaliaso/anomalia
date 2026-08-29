import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Your agents can now write to your custom agents',
  items: [
    'Agents can send DMs to your custom agents by name — no ids to look up.',
    'Custom agents without scheduled tasks are reachable too: their identity is enough.'
  ]
} satisfies ChangelogEntry;
