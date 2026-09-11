import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-06',
  title: 'Agents can write a row in any table, not only the ones with a tool',
  items: [
    'Agents connected over MCP can now add a row to any table with `insert_row` and change one with `update_row`, so a competitor, a note, an idea or a blog term no longer needs a tool of its own.',
    'A change only touches the fields it sends: editing one detail of your brand kit can no longer blank the rest of it.',
    'Writing runs with your own permissions, never a shortcut around them, and it can never delete — deleting still has its own named tools.',
    'A rejected write now says what would be accepted: which values a field allows, which row you collided with, which fields your account may set.'
  ]
} satisfies ChangelogEntry;
