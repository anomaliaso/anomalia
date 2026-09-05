import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your AI can point Radar at new places',
  items: [
    'Claude, Cursor and any connected AI client can now see where Radar looks for your brand — which platforms are on and which news queries, feeds, subreddits and searches it watches — and add or remove them.',
    'Your AI is told up front which sources your plan allows and how many you have left, so it stops proposing sources you cannot use.',
    'Adding a source you already have no longer looks like a failure: nothing changes and it says so.',
    'Removing a source now works whether you write a subreddit as “r/coffee” or “coffee” — before, only one of the two forms matched what was saved.'
  ]
} satisfies ChangelogEntry;
