import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'One model pipe for all chat text',
  items: [
    'Chat text now always resolves through the LLM gateway. Legacy per-provider settings (CHAT_PROVIDER, HARNESS_PROVIDER, per-provider model lists) are no longer read.',
    'Kie keys are only used for images, video clips, voice-over and GEO probes — never for chat text.'
  ]
} satisfies ChangelogEntry;
