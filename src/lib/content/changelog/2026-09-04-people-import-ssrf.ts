import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: '2026-09-04',
  title: 'Team photos found on your site are imported more carefully',
  items: [
    'When onboarding picks up a photo of someone from your website, the download now refuses any address that is not on the public internet, and keeps checking as the link forwards along.',
    'An oversized photo is turned away while it downloads instead of after, so one bad link no longer slows the rest of the step down.'
  ]
};

export default entry;
