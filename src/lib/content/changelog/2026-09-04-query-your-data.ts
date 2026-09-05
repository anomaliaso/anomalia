import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Ask your agent anything about your data, not just what we built a button for',
  items: [
    'Claude, ChatGPT and Cursor can now read your Anomalia data directly — "how many posts went out per platform in the last 90 days, and which one got the best engagement" is one question now, instead of three separate reads and mental arithmetic.',
    'It reads as you: the same permissions you have when you open the app, decided by the database itself, so an agent can never see a brand you cannot see.',
    'It can only read. There is no way for it to change or delete anything, by construction rather than by rule.',
    'The agent now gets the list of tables it can ask for, so it stops guessing names and wasting a turn on a table that does not exist.'
  ]
} satisfies ChangelogEntry;
