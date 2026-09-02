import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Every page starts faster',
  items: [
    'The app now downloads 12% less code before it can draw anything, and the very first file it needs is 78% smaller — error reporting loads quietly afterwards instead of standing in the way.'
  ]
} satisfies ChangelogEntry;
