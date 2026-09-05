import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'The chat is gone — your own AI agent runs Anomalia now',
  items: [
    'Connect Claude, Cursor, ChatGPT or any MCP client to your brand and ask it there. It reads and writes everything the chat could: posts, plans, captions, approvals, SEO, blog articles, connections.',
    'Opening a brand now lands on the workbench — the overview with your queue, gauges and what needs review — instead of a chat composer.',
    'Thread history, the thread list in the sidebar, message search in ⌘K, and the chat settings page are gone with it. ⌘K still finds every page and setting.',
    'The `anomalia ai` command is gone from the CLI. Ask your own agent instead, or use the specific commands — `anomalia approve`, `anomalia post … edit`, `anomalia plan` — which do the same work deterministically.',
    'Every generator stays exactly where it was: media generator, motion video, UGC, article and cover generation, and post regeneration with your feedback and reference images.'
  ]
} satisfies ChangelogEntry;
