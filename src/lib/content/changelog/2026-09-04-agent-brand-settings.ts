import type { ChangelogEntry } from './index';

export default {
  date: '2026-09-04',
  title: 'Your AI can set the posting timezone, platforms, hashtags and tone',
  items: [
    'Claude, Cursor and any connected AI client can now read and change how your brand works — posting timezone, which platforms it posts to, the hashtags allowed per platform, and the past posts it copies your tone from.',
    'Before it changes the timezone, your AI is told what that does: posts that already have a time keep going out at the same moment, so their local hour shifts. Nothing on your calendar is silently moved.',
    'Removing a platform no longer needs a warning from you: your AI knows it does not cancel posts already scheduled there.',
    'If you target a platform with no connected account, you now hear about it instead of finding out when a post never goes out.',
    'A timezone that is not a real timezone is refused, in the app as well as through your AI — it used to be saved and only break later.'
  ]
} satisfies ChangelogEntry;
