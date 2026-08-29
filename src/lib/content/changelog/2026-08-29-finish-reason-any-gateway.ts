import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Agent replies no longer fail when a provider skips its end-of-stream signal',
  items: [
    'Chat turns now complete on every OpenAI-compatible provider when the response text has already arrived but the end signal is missing. Truly empty responses still surface as errors.'
  ]
} satisfies ChangelogEntry;
