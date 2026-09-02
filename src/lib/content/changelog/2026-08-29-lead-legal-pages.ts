import type { ChangelogEntry } from './index';

export default {
  date: '2026-08-29',
  title: 'Clearer legal pages about how Leads sources public conversations',
  items: [
    'The privacy policy now states exactly what Leads does: reads public third-party content on social platforms, keeps only a short summary and the post link, and deletes it on short schedules.',
    'The terms clarify that you are the only sender of any outreach: drafts are always human-reviewed, never automated.',
    'The Radar digest email now carries an unsubscribe link in the body, not just in the mail headers.'
  ]
} satisfies ChangelogEntry;
