import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'Your files stay inside your own space',
  items: [
    'Every upload is now checked against the account and the brand it belongs to, so a file can only ever land in a space you own.',
    'Image uploads accept the formats a browser draws as pictures — JPEG, PNG, WebP, GIF, HEIC — and refuse SVG, which a browser can also run as code.'
  ]
} satisfies ChangelogEntry;
