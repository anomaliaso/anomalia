import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Chat attachments no longer disappear while the composer loads',
  items: [
    'The attachment picker now becomes available only when the composer is ready, so selected images reliably appear in the preview strip and reach the turn.'
  ]
} satisfies ChangelogEntry;
