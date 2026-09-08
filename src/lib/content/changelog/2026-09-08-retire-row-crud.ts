import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-08',
  title: 'Four fewer tools for agents to choose between',
  items: [
    'Agents connected over MCP now correct a product, a person or a competitor with `insert_row` and `update_row`, the same two tools that write every other row — four narrower ones that did nothing more are gone.',
    'A competitor website without `https://` is now refused with the reason instead of being silently rewritten, so what gets saved is what you sent.'
  ]
} satisfies ChangelogEntry;
