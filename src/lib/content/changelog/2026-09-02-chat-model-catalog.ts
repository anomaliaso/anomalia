import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-02',
  title: 'Choose the model your chat runs on',
  items: [
    'The model menu in chat now lists the real catalogue — Claude, GPT, Gemini, Grok, DeepSeek, Qwen, Kimi, Llama, Mistral and more — with each model\'s context window and price shown next to it.',
    'Settings → Chat sets which model new conversations start on; inside a chat you can still switch per conversation, and the choice follows you across devices.',
    'Picking "Pro", "DeepSeek Pro" or "GPT Sol" used to run the same single model, and "GPT Terra" ran a different one entirely. The menu now runs what it says.'
  ]
} satisfies ChangelogEntry;
