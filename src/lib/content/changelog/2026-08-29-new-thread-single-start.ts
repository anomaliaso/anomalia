import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'A brand-new chat responds faster',
  items: [
    'A brand-new conversation no longer pays for a second cold start when the first one is just slow to boot — it answers in a single attempt instead of waiting through two.',
    'The log that blamed a “reused session” for a slow first reply is gone: a new thread has nothing to reuse, so it no longer reports one.'
  ]
} satisfies ChangelogEntry;
