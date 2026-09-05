import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your agent stops asking what your brand already told it',
  items: [
    'Claude, ChatGPT and Cursor can now read your brand memory — the voice, the constraints, the facts you confirmed, what earlier work learned — instead of rebuilding it every conversation.',
    'They can add what they learn, too. Your voice and your constraints stay yours: an agent cannot rewrite them, and a value that contradicts something you already recorded comes back for you to settle instead of silently replacing it.'
  ]
} satisfies ChangelogEntry;
