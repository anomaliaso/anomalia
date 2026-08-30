import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Sub-agent task indicators can no longer hang',
  items: [
    'When a turn recovers from a mid-task failure, a delegated task no longer stays stuck as "running" forever — it is now marked honestly as failed, and the page picks up the correction without a refresh.'
  ]
} satisfies ChangelogEntry;
