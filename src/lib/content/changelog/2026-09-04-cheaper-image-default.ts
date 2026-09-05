import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Images cost less by default',
  items: [
    'Images generated from a prompt alone now use the lighter, cheaper model — the same one already used when you give a reference photo.',
    'Blog article images are unchanged, and if you have pinned your own image model in Settings, your choice still wins.'
  ]
} satisfies ChangelogEntry;
