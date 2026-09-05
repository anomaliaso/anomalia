import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-05',
  title: 'AI visibility now tracks the assistants people actually ask',
  items: [
    'AI visibility measures six engines — ChatGPT, Claude, Gemini, Grok, Perplexity and Exa — each answering with its own live web search.',
    'DeepSeek and Bing are no longer measured: neither offers a web search we can read reliably, and an engine that cannot be measured honestly is worse than one fewer.',
    'Your share-of-voice score may shift at the next audit even if nothing about your brand changed — it is now averaged over a different set of engines. Past audits keep their per-engine detail, so old and new runs can still be compared engine by engine.'
  ]
} satisfies ChangelogEntry;
