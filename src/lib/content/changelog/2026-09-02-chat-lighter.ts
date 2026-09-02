import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Long conversations feel lighter',
  items: [
    'While a job runs in the background, the chat now asks the server only for what changed instead of re-downloading the whole conversation every few seconds.',
    'Long histories redraw faster: text already on screen is no longer re-rendered from scratch, and the browser skips the turns you have scrolled past.',
    'Opening a conversation no longer loads your thread list three times over.'
  ]
} satisfies ChangelogEntry;
