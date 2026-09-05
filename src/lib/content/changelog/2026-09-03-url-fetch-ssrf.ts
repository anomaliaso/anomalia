import type { ChangelogEntry } from './index';

const entry: ChangelogEntry = {
  date: '2026-09-03',
  title: 'Pictures brought in from a link are checked more carefully',
  items: [
    'Importing a picture from a link — a logo, a style reference, a post we archive for you — now refuses any address that is not on the public internet, and keeps checking as the link forwards you along.',
    'An oversized file is now turned away while it downloads instead of after, so a bad link can no longer slow the rest of your work down.',
    'Links that still start with http keep working, so logos taken from an older brand site import as they always did.'
  ]
};

export default entry;
