import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Video failures now say what went wrong',
  items: [
    'When a clip cannot be made, your agent is told why instead of just that it failed — so it can fix the request rather than retry the same one.',
    'Asking for a duration a model cannot film is now refused with the nearest it accepts, instead of being quietly rounded up and billed for.'
  ]
} satisfies ChangelogEntry;
