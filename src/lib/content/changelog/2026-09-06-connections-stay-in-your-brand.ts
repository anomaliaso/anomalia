import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-06',
  title: 'Connections stay in your brand',
  items: [
    'A connected app, a knowledge source, a social account and a trigger now belong to exactly one brand, so the same connection can never be claimed by two.',
    'Webhook endpoints are checked again at delivery time, against the address the name really resolves to, so we only ever call a host that is genuinely public.',
    'A queued chat turn now runs only on a thread that belongs to its own brand.'
  ]
} satisfies ChangelogEntry;
